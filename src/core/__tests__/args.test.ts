import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { DEFAULT_MIN_TVL_USD } from '../config.js'
import { findBestMarketsArgs } from '../tools/find-best-markets.js'
import { getMarketHistoryArgs } from '../tools/get-market-history.js'
import { listMarketUniverseArgs } from '../tools/list-market-universe.js'
import { optimizeAllocationArgs } from '../tools/optimize-allocation.js'
import { describeRow, finite } from '../tools/shared.js'
import type { SnapshotRow } from '../graphql/queries.js'

const FindBest = z.object(findBestMarketsArgs)
const Optimize = z.object(optimizeAllocationArgs)
const History = z.object(getMarketHistoryArgs)
const Universe = z.object(listMarketUniverseArgs)

describe('find_best_markets args', () => {
  it('applies the $1M TVL floor by default', () => {
    // The floor must be opt-out, not opt-in: steering $1k into a thin market is
    // the most plausible harm this server can do.
    expect(FindBest.parse({}).minTvlUsd).toBe(DEFAULT_MIN_TVL_USD)
    expect(FindBest.parse({}).limit).toBe(10)
  })

  it('caps limit at 50 and rejects a bad protocol', () => {
    expect(() => FindBest.parse({ limit: 500 })).toThrow()
    expect(() => FindBest.parse({ protocol: 'nonexistent' })).toThrow()
  })

  it('allows lowering the floor deliberately', () => {
    expect(FindBest.parse({ minTvlUsd: 0 }).minTvlUsd).toBe(0)
  })
})

describe('optimize_allocation args', () => {
  it('needs at least two markets to allocate across', () => {
    expect(() => Optimize.parse({ amountUsd: 1000, productIds: ['a'] })).toThrow()
    expect(
      Optimize.parse({ amountUsd: 1000, productIds: ['a', 'b'] }).diversification
    ).toBe(80)
  })

  it('rejects a non-positive amount and an out-of-range diversification', () => {
    expect(() => Optimize.parse({ amountUsd: 0, productIds: ['a', 'b'] })).toThrow()
    expect(() =>
      Optimize.parse({ amountUsd: 1000, productIds: ['a', 'b'], diversification: 101 })
    ).toThrow()
  })
})

describe('get_market_history args', () => {
  it('only accepts the supported ranges', () => {
    expect(History.parse({ productId: 'x' }).range).toBe('90d')
    expect(History.parse({ productId: 'x', range: '180d' }).range).toBe('180d')
    expect(() => History.parse({ productId: 'x', range: '5y' })).toThrow()
  })
})

describe('list_market_universe args', () => {
  it('defaults to supply', () => {
    expect(Universe.parse({}).kind).toBe('supply')
  })
})

describe('non-finite filtering at the tool boundary', () => {
  it('never lets NaN out as a number', () => {
    expect(finite(NaN)).toBeNull()
    expect(finite(Infinity)).toBeNull()
    expect(finite(null)).toBeNull()
    expect(finite(0)).toBe(0)
  })

  it('nulls a NaN APY on a described row instead of returning NaN', () => {
    const row: SnapshotRow = {
      hour: '2026-07-12T21:00:00.000Z',
      productId: 'p',
      asset: 'USDC',
      chainId: 1,
      apy: { base: NaN, rewards: 0.01, fees: 0, net: NaN },
      market: { supplyAssetsUsd: 1e6, utilizationRate: null },
      quality: { status: 'complete', count: 6, expectedCount: 6 },
      product: {
        protocol: {
          provider: 'aave',
          name: 'AaveV3Ethereum',
          chain: { id: 1, name: 'Ethereum' },
        },
      },
    }

    const described = describeRow(row)

    expect(described.apy.net).toBeNull()
    expect(described.apy.base).toBeNull()
    expect(described.apy.rewards).toBe(0.01)
    expect(described.quality.reliable).toBe(true)
    expect(described.asOf).toBe('2026-07-12T21:00:00.000Z')
  })

  it('flags a row built from too few slots as unreliable', () => {
    const row: SnapshotRow = {
      hour: '2026-07-12T21:00:00.000Z',
      productId: 'p',
      asset: 'USDC',
      chainId: 1,
      apy: { base: 0.05, rewards: 0, fees: 0, net: 0.05 },
      market: { supplyAssetsUsd: 1e6, utilizationRate: 0.5 },
      quality: { status: 'building', count: 2, expectedCount: 6 },
      product: null,
    }

    // 2/6 < 0.5 — the hour's average rests on too little data to state as fact.
    expect(describeRow(row).quality.reliable).toBe(false)
  })
})
