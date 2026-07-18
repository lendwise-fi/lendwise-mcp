import { z } from 'zod'

import { DEFAULT_MIN_TVL_USD, NOT_ADVICE } from '../config.js'
import { gql } from '../graphql/client.js'
import {
  LATEST_SUPPLY_APY,
  type SnapshotResponse,
} from '../graphql/queries.js'
import { describeRow, isUnreliable } from './shared.js'

export const findBestMarketsArgs = {
  asset: z
    .string()
    .optional()
    .describe('Asset symbol, e.g. USDC. Must come from list_market_universe.'),
  chainId: z.number().int().optional().describe('Chain ID, e.g. 1 for Ethereum.'),
  protocol: z
    .enum(['aave', 'morpho', 'compound'])
    .optional()
    .describe('Protocol provider.'),
  minTvlUsd: z
    .number()
    .nonnegative()
    .default(DEFAULT_MIN_TVL_USD)
    .describe(
      'Minimum supplied TVL in USD. Defaults to $1M — in a thinner market the ' +
        'headline APY is mostly noise. Lower it deliberately, not by accident.'
    ),
  limit: z.number().int().min(1).max(50).default(10),
}

const Args = z.object(findBestMarketsArgs)

/**
 * Current best supply markets by net APY. Reads the server-side latest-snapshot
 * query, so the ranking and the TVL floor are both applied in Postgres — this
 * never pages the catalogue and reduces client-side.
 */
export async function findBestMarkets(raw: unknown) {
  const { asset, chainId, protocol, minTvlUsd, limit } = Args.parse(raw)

  const data = await gql<{ latestSupplyApy: SnapshotResponse }>(
    LATEST_SUPPLY_APY,
    {
      filters: { asset, chainId, protocol, minTvlUsd },
      first: limit,
    }
  )

  const { items, pagination } = data.latestSupplyApy
  const markets = items.map(describeRow)

  return {
    query: { asset, chainId, protocol, minTvlUsd, limit },
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
