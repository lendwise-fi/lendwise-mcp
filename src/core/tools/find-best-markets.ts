import { z } from 'zod'

import { DEFAULT_MIN_TVL_USD, NOT_ADVICE } from '../config.js'
import { gql } from '../graphql/client.js'
import {
  LATEST_BORROW_APY,
  LATEST_SUPPLY_APY,
  type SnapshotResponse,
} from '../graphql/queries.js'
import { describeRow, isUnreliable } from './shared.js'

export const findBestMarketsArgs = {
  kind: z
    .enum(['supply', 'borrow'])
    .default('supply')
    .describe(
      'supply = earn yield (best = highest net APY). borrow = take a loan ' +
        '(best = LOWEST net APY, i.e. cheapest cost). Defaults to supply.'
    ),
  asset: z
    .string()
    .optional()
    .describe('Asset symbol, e.g. USDC. Must come from list_market_universe.'),
  chainId: z.number().int().optional().describe('Chain ID, e.g. 1 for Ethereum.'),
  protocol: z
    .enum(['aave', 'morpho', 'compound'])
    .optional()
    .describe('Protocol provider.'),
  collateral: z
    .string()
    .optional()
    .describe(
      'Borrow only: filter by collateral asset symbol (e.g. WETH). Valid values ' +
        'come from the `collaterals` on returned borrow rows, not guessed. ' +
        'Ignored when kind is supply.'
    ),
  minTvlUsd: z
    .number()
    .nonnegative()
    .default(DEFAULT_MIN_TVL_USD)
    .describe(
      'Minimum supplied pool depth in USD. Defaults to $1M — in a thinner ' +
        'market the headline rate is mostly noise (and, for borrow, the pool ' +
        'may be too shallow to draw from). Lower it deliberately, not by accident.'
    ),
  limit: z.number().int().min(1).max(50).default(10),
}

const Args = z.object(findBestMarketsArgs)

/**
 * Current best markets, either side of the book.
 *
 * Both kinds read a server-side latest-snapshot query, so the ranking and the
 * TVL floor are applied in Postgres — this never pages the catalogue. The two
 * sides rank in opposite directions: supply by highest net APY (most earned),
 * borrow by lowest (cheapest cost). That inversion lives in the GraphQL
 * documents (`LATEST_BORROW_APY` sends `orderDirection: asc`), so here we only
 * pick the document.
 */
export async function findBestMarkets(raw: unknown) {
  const { kind, asset, chainId, protocol, collateral, minTvlUsd, limit } =
    Args.parse(raw)

  const isBorrow = kind === 'borrow'
  const document = isBorrow ? LATEST_BORROW_APY : LATEST_SUPPLY_APY

  // `collateral` is a borrow-only filter; sending it on the supply side would be
  // rejected by the schema, so it's dropped there rather than passed through.
  const filters = {
    asset,
    chainId,
    protocol,
    minTvlUsd,
    ...(isBorrow ? { collateral } : {}),
  }

  const data = await gql<{
    latestSupplyApy?: SnapshotResponse
    latestBorrowApy?: SnapshotResponse
  }>(document, { filters, first: limit })

  // Exactly one key is present — the one for the document we sent.
  const { items, pagination } = (
    isBorrow ? data.latestBorrowApy : data.latestSupplyApy
  ) as SnapshotResponse
  const markets = items.map(describeRow)

  return {
    query: { kind, asset, chainId, protocol, collateral, minTvlUsd, limit },
    ranking: isBorrow
      ? 'By net borrow cost APY, cheapest first — lower is better.'
      : 'By net supply APY, highest first.',
    matched: pagination.countTotal,
    returned: markets.length,
    markets,
    ...(markets.length === 0
      ? {
          hint:
            'No market matched. Check the filter values against ' +
            'list_market_universe, or lower minTvlUsd.',
        }
      : {}),
    ...(markets.some(isUnreliable)
      ? {
          warning:
            'Some markets are flagged unreliable (incomplete data for the ' +
            'current hour). Treat their APY as provisional.',
        }
      : {}),
    disclaimer: NOT_ADVICE,
  }
}
