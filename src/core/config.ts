/**
 * The MCP server holds no secrets. It speaks only HTTPS to the Lendwise public
 * API, which is what makes this repo safe to be public — there is nothing here
 * to leak. `LENDWISE_API_URL` is overridable so a local web checkout can be
 * developed against.
 */
export const LENDWISE_API_URL = (
  process.env.LENDWISE_API_URL ?? 'https://lendwise.fi'
).replace(/\/$/, '')

export const GRAPHQL_ENDPOINT = `${LENDWISE_API_URL}/api/graphql`
export const OPTIMIZER_ENDPOINT = `${LENDWISE_API_URL}/api/optimizer`

/** Upstream is public and rate-limited; don't hang an agent on a slow request. */
export const FETCH_TIMEOUT_MS = 15_000

/**
 * Below this TVL a headline APY is mostly noise. Steering someone with $1k into
 * a thin market is the most plausible real-world harm this server can do, so the
 * floor is on by default and must be lowered deliberately.
 */
export const DEFAULT_MIN_TVL_USD = 1_000_000

export const NOT_ADVICE =
  'Informational only, not financial advice. APYs are variable and historical ' +
  'yields do not predict future returns. Verify on-chain before committing funds.'
