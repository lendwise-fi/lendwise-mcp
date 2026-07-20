import { z } from 'zod'

import { NOT_ADVICE } from '../config.js'
import { gql } from '../graphql/client.js'
import { BORROW_HISTORY, type DailyRow, MARKET_HISTORY } from '../graphql/queries.js'
import { stats } from '../stats.js'

export const getMarketHistoryArgs = {
  productId: z.string().min(1).describe('Exact productId from find_best_markets.'),
  kind: z
    .enum(['supply', 'borrow'])
    .default('supply')
    .describe(
      'Which side to chart. Must match the productId — a borrow productId ends ' +
        'in :borrow. Defaults to supply.'
    ),
  range: z
    .enum(['7d', '30d', '90d', '180d'])
    .default('90d')
    .describe('How far back to look. Use 180d for a 6-month horizon.'),
}

const Args = z.object(getMarketHistoryArgs)

interface DailyResponse {
  items: DailyRow[]
  pagination: { count: number; countTotal: number }
}

/**
 * Daily net-APY series plus its mean / stddev / min / max, for either side.
 *
 * The stats are the deliverable, not the series. A snapshot cannot distinguish a
 * durable rate from a reward spike that ends next week; a 180-day standard
 * deviation can. For supply that stability is the yield you can count on; for
 * borrow it is the cost you can count on. Same maths, opposite reading — hence
 * the kind-dependent interpretation copy.
 */
export async function getMarketHistory(raw: unknown) {
  const { productId, kind, range } = Args.parse(raw)

  const isBorrow = kind === 'borrow'
  const document = isBorrow ? BORROW_HISTORY : MARKET_HISTORY

  const data = await gql<{
    supplyApyDaily?: DailyResponse
    borrowApyDaily?: DailyResponse
  }>(document, { productId, range })

  // Exactly one key is present — the one for the document we sent.
  const items = (isBorrow ? data.borrowApyDaily : data.supplyApyDaily)!.items
  // Non-finite APYs (Postgres double precision can hold NaN) are dropped, not
  // returned — a NaN in a series poisons every stat computed from it.
  const netStats = stats(items.map((d) => d.apy.net))

  if (!netStats) {
    return {
      productId,
      kind,
      range,
      observations: 0,
      hint:
        'No usable daily history for this product in that range. It may be ' +
        'newly tracked, or the productId may not match the requested kind ' +
        '(a borrow productId ends in :borrow). Try a shorter range.',
      disclaimer: NOT_ADVICE,
    }
  }

  const volatile =
    netStats.mean > 0 && netStats.stddev / Math.abs(netStats.mean) > 0.5

  return {
    productId,
    kind,
    range,
    observations: netStats.count,
    netApy: {
      mean: netStats.mean,
      stddev: netStats.stddev,
      min: netStats.min,
      max: netStats.max,
    },
    interpretation: volatile
      ? isBorrow
        ? 'Volatile: the spread is large relative to the mean, so the current ' +
          'rate is a poor predictor of what you would actually pay.'
        : 'Volatile: the spread is large relative to the mean, so the current ' +
          'APY is a poor predictor of what you would actually earn.'
      : 'Relatively stable over this window.',
    series: items.map((d) => ({
      date: d.date,
      net: Number.isFinite(d.apy.net) ? d.apy.net : null,
    })),
    disclaimer: NOT_ADVICE,
  }
}
