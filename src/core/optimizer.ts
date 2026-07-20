import { OPTIMIZER_ENDPOINT } from './config.js'
import { ApiError, postJson } from './http.js'

/**
 * The optimizer contract is POSITIONAL, and that is the single most dangerous
 * detail in this server.
 *
 * We send `apy: number[]`. It answers with `vault_index` — an offset into the
 * array we sent, not an id. If the array we build and the array we map back
 * through ever disagree on order, the agent confidently recommends a real
 * allocation attached to the wrong market. Nothing downstream would catch it:
 * the numbers all look plausible.
 *
 * So order is established exactly once, by the caller's productIds, and both
 * directions are driven from that same array. See optimizer.test.ts.
 */

export interface VaultAllocationResult {
  vault_index: number
  allocation: number
  allocation_percent: number
}

export interface VaultAllocationResponse {
  success: boolean
  allocations: VaultAllocationResult[]
  resulting_diversification: number
}

/** One market's share of the allocation, resolved back to its productId. */
export interface Allocation {
  productId: string
  apy: number
  allocationPercent: number
  amountUsd: number
}

/**
 * Map the solver's positional result back onto the productIds it was built
 * from. `apys[i]` must be the APY of `productIds[i]` — that invariant is the
 * caller's to hold, and `buildApyVector` is the only supported way to get it.
 */
export function mapAllocations(
  productIds: readonly string[],
  apys: readonly number[],
  allocations: readonly VaultAllocationResult[],
  amountUsd: number
): Allocation[] {
  return allocations.flatMap((a) => {
    const productId = productIds[a.vault_index]
    const apy = apys[a.vault_index]
    // A vault_index outside the array we sent means the request and response
    // disagree about the market set. Dropping it is the only safe move — the
    // alternative is attributing money to an unknown market.
    if (productId === undefined || apy === undefined) return []
    return [
      {
        productId,
        apy,
        allocationPercent: a.allocation_percent,
        amountUsd: amountUsd * (a.allocation_percent / 100),
      },
    ]
  })
}

/**
 * Build the positional APY vector for `productIds`, in that exact order.
 * Products with no finite APY in the snapshot are reported as missing rather
 * than defaulted to 0 — a 0 would silently tell the solver "this market is
 * worthless" instead of "we don't know".
 */
export function buildApyVector(
  productIds: readonly string[],
  latestApyByProduct: ReadonlyMap<string, number>
): { apys: number[]; found: string[]; missing: string[] } {
  const apys: number[] = []
  const found: string[] = []
  const missing: string[] = []

  for (const id of productIds) {
    const apy = latestApyByProduct.get(id)
    if (apy === undefined || !Number.isFinite(apy)) {
      missing.push(id)
      continue
    }
    apys.push(apy)
    found.push(id)
  }

  return { apys, found, missing }
}

/** Blended APY of an allocation — the portfolio's weighted mean. */
export function blendedApy(allocations: readonly Allocation[]): number {
  const totalPercent = allocations.reduce((a, x) => a + x.allocationPercent, 0)
  if (totalPercent === 0) return 0
  return (
    allocations.reduce((a, x) => a + x.apy * x.allocationPercent, 0) /
    totalPercent
  )
}

/**
 * Call the solver through the Lendwise proxy — never optimizer.lendwise.fi directly.
 *
 * The response is VALIDATED, not cast. A solver that answers 200 with
 * `success: false` (or without `allocations` at all) would otherwise blow up
 * inside `mapAllocations`, or — worse — be reported to the user as a valid
 * allocation of $0 across their markets.
 */
export async function optimizeVaults(
  apy: readonly number[],
  diversification: number
): Promise<VaultAllocationResponse> {
  const body = await postJson<Partial<VaultAllocationResponse>>(
    OPTIMIZER_ENDPOINT,
    { endpoint: '/optimize/vaults', data: { apy, diversification } },
    'The optimizer'
  )

  if (body.success !== true) {
    throw new ApiError(
      'The optimizer could not find an allocation for these markets.'
    )
  }
  if (!Array.isArray(body.allocations)) {
    throw new ApiError('The optimizer returned a malformed allocation.')
  }

  return {
    success: true,
    allocations: body.allocations,
    resulting_diversification: body.resulting_diversification ?? diversification,
  }
}
