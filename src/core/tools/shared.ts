import type { SnapshotRow } from '../graphql/queries.js'

/** Coerce a non-finite number to null. Never let NaN out of a tool. */
export function finite(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export interface DescribedMarket {
  productId: string
  asset: string
  chain: string
  chainId: number
  protocol: string
  market: string
  apy: {
    net: number | null
    base: number | null
    rewards: number | null
    fees: number | null
  }
  tvlUsd: number | null
  utilizationRate: number | null
  /** Borrow rows only: value currently drawn from the pool. Absent for supply. */
  borrowedUsd?: number | null
  /** Borrow rows only: accepted collateral symbols. Absent for supply. */
  collaterals?: string[]
  /** Snapshot time — every response says how fresh it is. */
  asOf: string
  quality: { status: string; slots: string; reliable: boolean }
}

/**
 * A row's data quality. `quality.count` is how many 10-minute slots of the
 * current hour have landed; below half the expected count the hour's average is
 * built on too little and is flagged rather than silently returned as fact.
 */
function reliability(row: SnapshotRow) {
  const { count, expectedCount, status } = row.quality
  const completeness = expectedCount > 0 ? count / expectedCount : 0
  return {
    status,
    slots: `${count}/${expectedCount}`,
    reliable: completeness >= 0.5,
  }
}

export function describeRow(row: SnapshotRow): DescribedMarket {
  return {
    productId: row.productId,
    asset: row.asset,
    chain: row.product?.protocol.chain.name ?? String(row.chainId),
    chainId: row.chainId,
    protocol: row.product?.protocol.provider ?? 'unknown',
    market: row.product?.protocol.name ?? 'unknown',
    apy: {
      net: finite(row.apy.net),
      base: finite(row.apy.base),
      rewards: finite(row.apy.rewards),
      fees: finite(row.apy.fees),
    },
    tvlUsd: finite(row.market.supplyAssetsUsd),
    utilizationRate: finite(row.market.utilizationRate),
    // Borrow-only fields, keyed off what the document actually selected rather
    // than a passed-in kind: a supply document omits both, a borrow one carries
    // them, so their presence on the row is the ground truth.
    ...(row.market.borrowAssetsUsd !== undefined
      ? { borrowedUsd: finite(row.market.borrowAssetsUsd) }
      : {}),
    ...(row.collaterals !== undefined
      ? { collaterals: row.collaterals.map((c) => c.symbol) }
      : {}),
    asOf: row.hour,
    quality: reliability(row),
  }
}

export function isUnreliable(m: DescribedMarket): boolean {
  return !m.quality.reliable
}
