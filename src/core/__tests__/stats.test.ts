import { describe, expect, it } from 'vitest'

import { finiteOnly, stats } from '../stats.js'

describe('finiteOnly', () => {
  it('drops NaN, Infinity, null and undefined', () => {
    expect(finiteOnly([1, NaN, 2, Infinity, null, -Infinity, undefined, 3])).toEqual(
      [1, 2, 3]
    )
  })

  it('keeps legitimate zeros and negatives', () => {
    // A 0% APY is a fact, not a missing value; a negative net APY is possible.
    expect(finiteOnly([0, -0.01, 0.02])).toEqual([0, -0.01, 0.02])
  })
})

describe('stats', () => {
  it('computes mean, population stddev, min and max', () => {
    const result = stats([2, 4, 4, 4, 5, 5, 7, 9])

    expect(result).not.toBeNull()
    expect(result?.mean).toBe(5)
    expect(result?.stddev).toBe(2) // population sd of this classic set
    expect(result?.min).toBe(2)
    expect(result?.max).toBe(9)
    expect(result?.count).toBe(8)
  })

  it('ignores non-finite values instead of returning NaN', () => {
    const result = stats([0.05, NaN, 0.05, Infinity])

    // A single NaN would otherwise poison the mean and every stat after it.
    expect(result?.mean).toBe(0.05)
    expect(result?.stddev).toBe(0)
    expect(result?.count).toBe(2)
  })

  it('returns null when nothing finite is left, rather than a fake zero', () => {
    expect(stats([NaN, Infinity, null])).toBeNull()
    expect(stats([])).toBeNull()
  })

  it('gives a stable market a small stddev and a spiky one a large stddev', () => {
    const stable = stats([0.06, 0.061, 0.059, 0.06])
    const spiky = stats([0.06, 0.30, 0.05, 0.06])

    // This is the entire reason the tool exists — the means are close, the
    // risk profiles are not.
    expect(stable!.stddev).toBeLessThan(0.01)
    expect(spiky!.stddev).toBeGreaterThan(0.09)
  })
})
