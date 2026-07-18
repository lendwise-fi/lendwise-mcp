import { z } from 'zod'

import { NOT_ADVICE } from '../config.js'
import { gql } from '../graphql/client.js'
import {
  LATEST_SUPPLY_BY_PRODUCTS,
  type SnapshotResponse,
} from '../graphql/queries.js'
import {
  type Allocation,
  blendedApy,
  buildApyVector,
  mapAllocations,
  optimizeVaults,
} from '../optimizer.js'
import { finite } from './shared.js'

export const optimizeAllocationArgs = {
  amountUsd: z
    .number()
    .positive()
    .describe('Total amount to allocate, in USD.'),
  productIds: z
    .array(z.string().min(1))
    .min(2)
    .max(20)
    .describe(
      'Markets to allocate across, from find_best_markets. Order is not ' +
        'significant to you, but is preserved internally.'
    ),
  diversification: z
    .number()
    .min(0)
    .max(100)
    .default(80)
    .describe(
      'Target diversification score. 80 = highly diversified, 0 = concentrate ' +
        'everything in the highest yield.'
    ),
}

const Args = z.object(optimizeAllocationArgs)

/** Months of projected yield to report — matches the 6-month horizon the tool is for. */
const PROJECTION_MONTHS = 6

/**
 * Allocate `amountUsd` across the given markets via the solver.
 *
 * The solver speaks positions, not ids: we hand it `apy[]` and it hands back
 * `vault_index`. Both directions run off the single array built by
 * `buildApyVector`, so the index it returns cannot drift from the product it
 * meant. Getting this wrong would attribute real money to the wrong market and
 * nothing downstream would notice — hence the unit tests.
 */
export async function optimizeAllocation(raw: unknown) {
  const { amountUsd, productIds, diversification } = Args.parse(raw)

  // De-duplicate: the same product twice would occupy two positions and let the
  // solver "diversify" across what is really one market.
  const unique = [...new Set(productIds)]

  // ONE request for the whole batch, via the server-side productIds filter. A
  // request per product would spend up to 20 of the caller's 60 req/min budget
  // on a single optimize_allocation, and rate-limit the agent mid-flow.
  const data = await gql<{ latestSupplyApy: SnapshotResponse }>(
    LATEST_SUPPLY_BY_PRODUCTS,
    { productIds: unique, first: unique.length }
  )

  const latestApyByProduct = new Map<string, number>()
  for (const row of data.latestSupplyApy.items) {
    const net = finite(row.apy.net)
    if (net !== null) latestApyByProduct.set(row.productId, net)
  }

  const { apys, found, missing } = buildApyVector(unique, latestApyByProduct)

  if (found.length < 2) {
    return {
      error:
        'Need at least 2 markets with a current APY to allocate across. ' +
        `Only ${found.length} of ${unique.length} had a usable snapshot.`,
      missing,
      disclaimer: NOT_ADVICE,
    }
  }

  const response = await optimizeVaults(apys, diversification)

  // `found` is the array the apys were built from, so vault_index indexes it.
  const allocations: Allocation[] = mapAllocations(
    found,
    apys,
    response.allocations,
    amountUsd
  ).filter((a) => a.amountUsd > 0)

  const blended = blendedApy(allocations)

  return {
    amountUsd,
    diversification: response.resulting_diversification,
    allocations: allocations
      .sort((a, b) => b.amountUsd - a.amountUsd)
      .map((a) => ({
        productId: a.productId,
        amountUsd: Number(a.amountUsd.toFixed(2)),
        allocationPercent: a.allocationPercent,
        netApy: a.apy,
      })),
    blendedNetApy: blended,
    projected: {
      months: PROJECTION_MONTHS,
      // Simple pro-rata of the annual rate. The APYs are variable, so compounding
      // precision here would be false precision.
      yieldUsd: Number(
        (amountUsd * blended * (PROJECTION_MONTHS / 12)).toFixed(2)
      ),
      caveat:
        'Projection assumes today’s APYs hold for the whole period. They will ' +
        'not — check get_market_history for how much each one actually moves.',
    },
    ...(missing.length > 0
      ? {
          excluded: {
            productIds: missing,
            reason:
              'No current APY snapshot; excluded rather than assumed to be zero.',
          },
        }
      : {}),
    disclaimer: NOT_ADVICE,
  }
}
