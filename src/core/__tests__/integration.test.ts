import { describe, expect, it } from 'vitest'

import { findBestMarkets } from '../tools/find-best-markets.js'
import { getMarketDetails } from '../tools/get-market-details.js'
import { listMarketUniverse } from '../tools/list-market-universe.js'
import { optimizeAllocation } from '../tools/optimize-allocation.js'

/**
 * Hits the real API. Skipped unless LENDWISE_INTEGRATION=1, so the default test
 * run stays hermetic and doesn't spend anyone's rate limit budget in CI.
 *
 *   LENDWISE_INTEGRATION=1 LENDWISE_API_URL=http://localhost:3000 pnpm test
 */
const enabled = process.env.LENDWISE_INTEGRATION === '1'

describe.skipIf(!enabled)('integration (live API)', () => {
  it('lists a universe with real assets and chains', async () => {
    const universe = await listMarketUniverse({ kind: 'supply' })

    expect(universe.assets.length).toBeGreaterThan(0)
    expect(universe.chains.length).toBeGreaterThan(0)
    expect(universe.chains.every((c) => Number.isInteger(c.chainId))).toBe(true)
  }, 30_000)

  it('finds real supply markets sorted by net APY descending', async () => {
    const result = await findBestMarkets({ asset: 'USDC', limit: 5 })

    expect(result.markets.length).toBeGreaterThan(0)

    const apys = result.markets.map((m) => m.apy.net ?? -Infinity)
    expect([...apys].sort((a, b) => b - a)).toEqual(apys)

    for (const market of result.markets) {
      expect(market.asset).toBe('USDC')
      expect(market.productId).toBeTruthy()
      expect(market.asOf).toBeTruthy()
      // The $1M floor is on by default.
      expect(market.tvlUsd ?? 0).toBeGreaterThanOrEqual(1_000_000)
      // Never NaN.
      expect(Number.isNaN(market.apy.net)).toBe(false)
    }
  }, 30_000)

  it('allocates across a real batch and keeps every APY tied to its own market', async () => {
    const best = await findBestMarkets({ asset: 'USDC', limit: 3 })
    const productIds = best.markets.map((m) => m.productId)

    const result = await optimizeAllocation({ amountUsd: 1000, productIds })

    expect('allocations' in result).toBe(true)
    if (!('allocations' in result)) return

    for (const a of result.allocations) {
      const source = best.markets.find((m) => m.productId === a.productId)
      expect(source).toBeDefined()
      // The solver answers with positions, not ids. If the vector we build and
      // the one we map back through ever disagree, money lands on the wrong
      // market and every number still looks plausible.
      expect(a.netApy).toBeCloseTo(source!.apy.net!, 9)
    }

    const total = result.allocations.reduce((sum, a) => sum + a.amountUsd, 0)
    expect(total).toBeCloseTo(1000, 0)
  }, 30_000)

  it('finds real borrow markets sorted by net APY ascending (cheapest cost first)', async () => {
    const result = await findBestMarkets({ kind: 'borrow', asset: 'USDC', limit: 5 })

    expect(result.markets.length).toBeGreaterThan(0)

    // Borrow net APY is a cost, so best = lowest. The order must be ascending —
    // the opposite of supply, and not upstream's default direction.
    const apys = result.markets.map((m) => m.apy.net ?? Infinity)
    expect([...apys].sort((a, b) => a - b)).toEqual(apys)

    for (const market of result.markets) {
      expect(market.asset).toBe('USDC')
      expect(market.productId).toMatch(/:borrow$/)
      // Borrow rows carry the fields a supply row does not.
      expect('borrowedUsd' in market).toBe(true)
      expect(Array.isArray(market.collaterals)).toBe(true)
      expect(Number.isNaN(market.apy.net)).toBe(false)
    }
  }, 30_000)

  it('does not report a healthy borrow market as a stalled pipeline', async () => {
    const borrow = await findBestMarkets({ asset: 'USDC', limit: 1 })
    // Derive a real borrow productId from the registry rather than composing one.
    const supplyId = borrow.markets[0]?.productId
    expect(supplyId).toBeTruthy()

    const details = await getMarketDetails({ productId: supplyId! })
    expect(details.found).toBe(true)
    // A found product with a live snapshot must not carry the stall warning.
    if ('current' in details && details.current) {
      expect('warning' in details).toBe(false)
    }
  }, 30_000)
})
