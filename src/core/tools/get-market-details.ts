import { z } from 'zod'

import { NOT_ADVICE } from '../config.js'
import { gql } from '../graphql/client.js'
import {
  MARKET_DETAILS,
  type ProductRow,
  type SnapshotResponse,
} from '../graphql/queries.js'
import { describeRow, finite } from './shared.js'

export const getMarketDetailsArgs = {
  productId: z
    .string()
    .min(1)
    .describe(
      'Exact productId from find_best_markets, e.g. ' +
        'aave:v3:ethereum:reserve:0x…:supply'
    ),
}

const Args = z.object(getMarketDetailsArgs)

/** Full picture of one market: registry entry, collaterals, and the APY breakdown. */
export async function getMarketDetails(raw: unknown) {
  const { productId } = Args.parse(raw)

  const data = await gql<{
    products: { items: ProductRow[] }
    latestSupplyApy: SnapshotResponse
    latestBorrowApy: SnapshotResponse
  }>(MARKET_DETAILS, { productId })

  const product = data.products.items[0]
  // A productId is either a supply or a borrow product; exactly one of these
  // carries a row. Taking only the supply side would flag every healthy borrow
  // market as a stalled pipeline.
  const snapshot =
    data.latestSupplyApy.items[0] ?? data.latestBorrowApy.items[0]

  if (!product) {
    return {
      productId,
      found: false,
      hint:
        'No product with that id. productIds are exact — take one from ' +
        'find_best_markets rather than composing it by hand.',
      disclaimer: NOT_ADVICE,
    }
  }

  return {
    found: true,
    product: {
      productId: product.id,
      kind: product.kind,
      asset: product.asset,
      protocol: {
        provider: product.protocol.provider,
        market: product.protocol.name,
        type: product.protocol.type,
        version: product.protocol.version,
        chain: product.protocol.chain,
        address: product.protocol.address,
        meta: product.protocol.meta,
      },
      collaterals: product.collaterals,
    },
    // A product with no reading in the last 6 hours has a stale or stalled
    // pipeline; report the absence rather than an old number.
    current: snapshot
      ? {
          ...describeRow(snapshot),
          rewardItems: (snapshot.apy.rewardItems ?? []).map((r) => ({
            token: r.token.symbol,
            apy: finite(r.apy),
            source: r.source,
            program: r.program,
          })),
        }
      : null,
    ...(snapshot
      ? {}
      : {
          warning:
            'No APY snapshot in the last 6 hours for this product — its data ' +
            'pipeline may have stalled. Do not assume a previous value still holds.',
        }),
    disclaimer: NOT_ADVICE,
  }
}
