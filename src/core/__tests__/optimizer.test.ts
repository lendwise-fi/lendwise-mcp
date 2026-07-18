import { describe, expect, it } from 'vitest'

import {
  blendedApy,
  buildApyVector,
  mapAllocations,
  type VaultAllocationResult,
} from '../optimizer.js'

/**
 * The solver's contract is positional: we send apy[], it returns vault_index.
 * If the array we build and the array we map back through disagree, the agent
 * recommends a real allocation attached to the wrong market — and every number
 * still looks plausible. Both directions are pinned here.
 */
describe('buildApyVector — productIds → apy[]', () => {
  it('preserves caller order, not map order', () => {
    // Deliberately insert in a different order than requested.
    const latest = new Map([
      ['c', 0.03],
      ['a', 0.01],
      ['b', 0.02],
    ])

    const { apys, found } = buildApyVector(['a', 'b', 'c'], latest)

    expect(found).toEqual(['a', 'b', 'c'])
    expect(apys).toEqual([0.01, 0.02, 0.03])
  })

  it('excludes products with no snapshot rather than defaulting them to 0', () => {
    const latest = new Map([
      ['a', 0.05],
      ['c', 0.07],
    ])

    const { apys, found, missing } = buildApyVector(['a', 'b', 'c'], latest)

    // A 0 would tell the solver "this market is worthless" instead of "unknown".
    expect(apys).toEqual([0.05, 0.07])
    expect(found).toEqual(['a', 'c'])
    expect(missing).toEqual(['b'])
  })

  it('excludes non-finite APYs (Postgres double precision can hold NaN)', () => {
    const latest = new Map([
      ['a', 0.05],
      ['b', NaN],
      ['c', Infinity],
    ])

    const { apys, found, missing } = buildApyVector(['a', 'b', 'c'], latest)

    expect(apys).toEqual([0.05])
    expect(found).toEqual(['a'])
    expect(missing).toEqual(['b', 'c'])
  })

  it('keeps positions aligned after an exclusion — the index must not shift', () => {
    const latest = new Map([
      ['a', 0.01],
      ['c', 0.03],
    ])

    const { apys, found } = buildApyVector(['a', 'b', 'c'], latest)

    // 'c' is at index 1 now, not 2. vault_index 1 must therefore mean 'c'.
    expect(found[1]).toBe('c')
    expect(apys[1]).toBe(0.03)
  })
})

describe('mapAllocations — vault_index → productId', () => {
  const allocations: VaultAllocationResult[] = [
    { vault_index: 2, allocation: 0.5, allocation_percent: 50 },
    { vault_index: 0, allocation: 0.3, allocation_percent: 30 },
    { vault_index: 1, allocation: 0.2, allocation_percent: 20 },
  ]

  it('resolves each index back to the product at that position', () => {
    const result = mapAllocations(
      ['a', 'b', 'c'],
      [0.01, 0.02, 0.03],
      allocations,
      1000
    )

    // Returned out of order by the solver — each must still land on its own product.
    expect(result).toEqual([
      { productId: 'c', apy: 0.03, allocationPercent: 50, amountUsd: 500 },
      { productId: 'a', apy: 0.01, allocationPercent: 30, amountUsd: 300 },
      { productId: 'b', apy: 0.02, allocationPercent: 20, amountUsd: 200 },
    ])
  })

  it('round-trips: build then map lands the money on the right markets', () => {
    const latest = new Map([
      ['mkt-a', 0.01],
      ['mkt-b', 0.02],
      ['mkt-c', 0.03],
    ])
    const requested = ['mkt-c', 'mkt-a', 'mkt-b'] // caller's arbitrary order

    const { apys, found } = buildApyVector(requested, latest)
    // Solver puts everything in whichever position held the 0.03 APY.
    const best = apys.indexOf(0.03)
    const solved: VaultAllocationResult[] = [
      { vault_index: best, allocation: 1, allocation_percent: 100 },
    ]

    const [only] = mapAllocations(found, apys, solved, 1000)

    expect(only?.productId).toBe('mkt-c')
    expect(only?.apy).toBe(0.03)
    expect(only?.amountUsd).toBe(1000)
  })

  it('drops an out-of-range vault_index instead of attributing money to nothing', () => {
    const result = mapAllocations(
      ['a', 'b'],
      [0.01, 0.02],
      [{ vault_index: 7, allocation: 1, allocation_percent: 100 }],
      1000
    )

    expect(result).toEqual([])
  })
})

describe('blendedApy', () => {
  it('weights each market by its allocation, not equally', () => {
    const blended = blendedApy([
      { productId: 'a', apy: 0.02, allocationPercent: 75, amountUsd: 750 },
      { productId: 'b', apy: 0.10, allocationPercent: 25, amountUsd: 250 },
    ])

    // 0.02*0.75 + 0.10*0.25 = 0.04 — not the 0.06 simple mean.
    expect(blended).toBeCloseTo(0.04, 10)
  })

  it('is 0 for an empty allocation rather than NaN', () => {
    expect(blendedApy([])).toBe(0)
  })
})
