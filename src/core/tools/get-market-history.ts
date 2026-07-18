import { z } from 'zod'

import { NOT_ADVICE } from '../config.js'
import { gql } from '../graphql/client.js'
import { type DailyRow, MARKET_HISTORY } from '../graphql/queries.js'
import { stats } from '../stats.js'

export const getMarketHistoryArgs = {
  productId: z.string().min(1).describe('Exact productId from find_best_markets.'),
  range: z
    .enum(['7d', '30d', '90d', '180d'])
    .default('90d')
    .describe('How far back to look. Use 180d for a 6-month horizon.'),
}

const Args = z.object(getMarketHistoryArgs)

/**
 * Daily net-APY series plus its mean / stddev / min / max.
 *
 * The stats are the deliverable, not the series. A snapshot cannot distinguish a
 * durable 6% from a 12% reward spike that ends next week; a 180-day standard
 * deviation can. That is the signal a 6-month horizon actually needs.
 */
export async function getMarketHistory(raw: unknown) {
  const { productId, range } = Args.parse(raw)

  const data = await gql<{
    supplyApyDaily: {
      items: DailyRow[]
      pagination: { count: number; countTotal: number }
    }
  }>(MARKET_HISTORY, { productId, range })

  const items = data.supplyApyDaily.items
  // Non-finite APYs (Postgres double precision can hold NaN) are dropped, not
  // returned — a NaN in a series poisons every stat computed from it.
  const netStats = stats(items.map((d) => d.apy.net))

  if (!netStats) {
    return {
      productId,
      range,
      observations: 0,
      hint:
        'No usable daily history for this product in that range. It may be ' +
        'newly tracked — try a shorter range.',
      disclaimer: NOT_ADVICE,
    }
  }

  return {
    productId,
    range,
    observations: netStats.count,
    netApy: {
      mean: netStats.mean,
      stddev: netStats.stddev,
      min: netStats.min,
      max: netStats.max,
    },
    interpretation:
      netStats.mean > 0 && netStats.stddev / Math.abs(netStats.mean) > 0.5
        ? 'Volatile: the spread is large relative to the mean, so the current ' +
          'APY is a poor predictor of what you would actually earn.'
        : 'Relatively stable over this window.',
    series: items.map((d) => ({
      date: d.date,
      net: Number.isFinite(d.apy.net) ? d.apy.net : null,
    })),
    disclaimer: NOT_ADVICE,
  }
}
