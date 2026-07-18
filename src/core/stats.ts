/**
 * Descriptive stats over a daily APY series.
 *
 * This is the whole point of `get_market_history`: over a 6-month horizon, a
 * durable 6% and a 12% that is a reward spike ending next week look identical
 * from a single snapshot. Standard deviation is what separates them.
 */

export interface Stats {
  mean: number
  stddev: number
  min: number
  max: number
  /** Number of finite observations the stats were computed from. */
  count: number
}

/**
 * Drop non-finite values. Postgres `double precision` can hold NaN (a bad
 * upstream APR→APY conversion lands there), and NaN poisons every downstream
 * number — a mean of NaN is worse than a missing mean, because it looks like an
 * answer.
 */
export function finiteOnly(values: readonly (number | null | undefined)[]): number[] {
  return values.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v)
  )
}

/** Population standard deviation. Returns null when there is nothing finite to describe. */
export function stats(values: readonly (number | null | undefined)[]): Stats | null {
  const xs = finiteOnly(values)
  if (xs.length === 0) return null

  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  const variance =
    xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / xs.length

  return {
    mean,
    stddev: Math.sqrt(variance),
    min: Math.min(...xs),
    max: Math.max(...xs),
    count: xs.length,
  }
}
