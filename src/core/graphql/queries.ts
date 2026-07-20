/**
 * The four documents the tools need.
 *
 * Written by hand rather than generated. The spec called for graphql-codegen
 * against LENDWISE_API_URL introspection, but that makes a live endpoint a
 * *build-time* dependency of a public package — and the queries these five tools
 * need are a fixed, small set. `pnpm build` here needs no network.
 *
 * Selection sets are kept tight on purpose: the API enforces a query cost limit
 * that scales with `first`, so asking for fields we won't render can push a
 * large page over the ceiling.
 */

// ─── Shared response shapes ──────────────────────────────────────────────────

export interface ApyBreakdown {
  base: number
  rewards: number
  fees: number
  net: number
  rewardItems?: RewardItem[]
}

export interface RewardItem {
  token: { symbol: string }
  apy: number
  source: string
  program: string | null
}

export interface MarketState {
  supplyAssetsUsd: number | null
  utilizationRate: number | null
  /** Borrow snapshots only — supply documents don't select it, so it's absent there. */
  borrowAssetsUsd?: number | null
}

export interface Quality {
  status: string
  count: number
  expectedCount: number
}

export interface SnapshotRow {
  hour: string
  productId: string
  asset: string
  chainId: number
  apy: ApyBreakdown
  market: MarketState
  quality: Quality
  /** Accepted collateral assets — borrow snapshots only, absent on supply rows. */
  collaterals?: { symbol: string }[]
  product: {
    protocol: { provider: string; name: string; chain: { id: number; name: string } }
  } | null
}

export interface SnapshotResponse {
  items: SnapshotRow[]
  pagination: { count: number; countTotal: number; limit: number; skip: number }
}

export interface DailyRow {
  date: string
  apy: { net: number; base: number; rewards: number }
}

export interface FacetsResponse {
  assets: { symbol: string; count: number }[]
  chains: { id: number; name: string; count: number }[]
  protocols: { name: string; count: number }[]
}

export interface ProductRow {
  id: string
  kind: string
  asset: { symbol: string; name: string; address: string; decimals: number }
  protocol: {
    provider: string
    type: string
    version: string
    name: string
    chain: { id: number; name: string }
    address: string
    meta: unknown
  }
  collaterals:
    | {
        symbol: string
        name: string
        ltv: number | null
        lltv: number
        canBeCollateral: boolean
      }[]
    | null
}

// ─── Documents ───────────────────────────────────────────────────────────────

export const PRODUCT_FACETS = /* GraphQL */ `
  query ProductFacets($filters: ProductFilters) {
    productFacets(filters: $filters) {
      assets {
        symbol
        count
      }
      chains {
        id
        name
        count
      }
      protocols {
        name
        count
      }
    }
  }
`

const SNAPSHOT_FIELDS = /* GraphQL */ `
  items {
    hour
    productId
    asset
    chainId
    apy {
      base
      rewards
      fees
      net
    }
    market {
      supplyAssetsUsd
      utilizationRate
    }
    quality {
      status
      count
      expectedCount
    }
    product {
      protocol {
        provider
        name
        chain {
          id
          name
        }
      }
    }
  }
  pagination {
    count
    countTotal
    limit
    skip
  }
`

export const LATEST_SUPPLY_APY = /* GraphQL */ `
  query LatestSupplyApy($filters: LatestFilters, $first: Int) {
    latestSupplyApy(
      filters: $filters
      first: $first
      orderBy: apyNet
      orderDirection: desc
    ) {
      ${SNAPSHOT_FIELDS}
    }
  }
`

/**
 * Borrow rows carry two fields supply rows don't: `borrowAssetsUsd` (how much of
 * the pool is drawn) and the `collaterals` accepted against the loan. Selecting
 * them here — not on the shared supply fragment — is deliberate: a supply market
 * state has no `borrowAssetsUsd`, so asking for it there is a schema error.
 */
const BORROW_SNAPSHOT_FIELDS = /* GraphQL */ `
  items {
    hour
    productId
    asset
    chainId
    apy {
      base
      rewards
      fees
      net
    }
    market {
      supplyAssetsUsd
      borrowAssetsUsd
      utilizationRate
    }
    quality {
      status
      count
      expectedCount
    }
    collaterals {
      symbol
    }
    product {
      protocol {
        provider
        name
        chain {
          id
          name
        }
      }
    }
  }
  pagination {
    count
    countTotal
    limit
    skip
  }
`

/**
 * Current best borrow markets. Borrow net APY is a COST (base + fees − rewards),
 * so the cheapest market has the LOWEST net — the opposite of supply.
 *
 * `orderDirection: asc` is set explicitly as defense in depth. Upstream now
 * defaults `latestBorrowApy` to asc too (best-first, kind-aware), so this only
 * restates that default — but pinning it here keeps the ranking correct even if
 * that default is ever changed back, and makes the intent legible at the call
 * site rather than depending on a server-side convention.
 */
export const LATEST_BORROW_APY = /* GraphQL */ `
  query LatestBorrowApy($filters: LatestBorrowFilters, $first: Int) {
    latestBorrowApy(
      filters: $filters
      first: $first
      orderBy: apyNet
      orderDirection: asc
    ) {
      ${BORROW_SNAPSHOT_FIELDS}
    }
  }
`

/**
 * Latest snapshot for an explicit set of products — the optimizer's APY source.
 *
 * One request for the whole batch via the server-side `productIds` filter. One
 * request per product would burn up to 20 of the 60 req/min budget on a single
 * optimize_allocation call.
 */
export const LATEST_SUPPLY_BY_PRODUCTS = /* GraphQL */ `
  query LatestSupplyByProducts($productIds: [String!], $first: Int) {
    latestSupplyApy(filters: { productIds: $productIds }, first: $first) {
      ${SNAPSHOT_FIELDS}
    }
  }
`

const DETAIL_SNAPSHOT_FIELDS = /* GraphQL */ `
  items {
    hour
    productId
    asset
    chainId
    apy {
      base
      rewards
      fees
      net
      rewardItems {
        token {
          symbol
        }
        apy
        source
        program
      }
    }
    market {
      supplyAssetsUsd
      utilizationRate
    }
    quality {
      status
      count
      expectedCount
    }
    product {
      protocol {
        provider
        name
        chain {
          id
          name
        }
      }
    }
  }
`

/**
 * A productId identifies a supply OR a borrow product, and the two live in
 * different snapshot queries. Ask both and take whichever answers: querying only
 * the supply side would report every healthy borrow market as a stalled pipeline.
 */
export const MARKET_DETAILS = /* GraphQL */ `
  query MarketDetails($productId: String!) {
    products(filters: { productId: $productId }, first: 1) {
      items {
        id
        kind
        asset {
          symbol
          name
          address
          decimals
        }
        protocol {
          provider
          type
          version
          name
          chain {
            id
            name
          }
          address
          meta
        }
        collaterals {
          symbol
          name
          ltv
          lltv
          canBeCollateral
        }
      }
    }
    latestSupplyApy(filters: { productId: $productId }, first: 1) {
      ${DETAIL_SNAPSHOT_FIELDS}
    }
    latestBorrowApy(filters: { productId: $productId }, first: 1) {
      ${DETAIL_SNAPSHOT_FIELDS}
    }
  }
`

export const MARKET_HISTORY = /* GraphQL */ `
  query MarketHistory($productId: String!, $range: String!) {
    supplyApyDaily(
      filters: { productId: $productId, range: $range }
      first: 500
      orderBy: time
      orderDirection: asc
    ) {
      items {
        date
        apy {
          net
          base
          rewards
        }
      }
      pagination {
        count
        countTotal
      }
    }
  }
`

/**
 * The borrow-side twin of MARKET_HISTORY. Same daily shape and the same
 * mean/stddev question — but for borrow the stat measures how much the *cost*
 * moves, not the yield. A stable borrow rate is the signal a fixed-horizon
 * borrower needs.
 */
export const BORROW_HISTORY = /* GraphQL */ `
  query BorrowHistory($productId: String!, $range: String!) {
    borrowApyDaily(
      filters: { productId: $productId, range: $range }
      first: 500
      orderBy: time
      orderDirection: asc
    ) {
      items {
        date
        apy {
          net
          base
          rewards
        }
      }
      pagination {
        count
        countTotal
      }
    }
  }
`
