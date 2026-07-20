import { FETCH_TIMEOUT_MS } from './config.js'

/**
 * A 429 from upstream. Surfaced as its own error type rather than swallowed:
 * the agent must back off, not retry-storm the endpoint the rate limit exists to
 * protect.
 */
export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super(
      `Lendwise API rate limit exceeded. Retryable: wait ${retryAfterSeconds}s ` +
        `before trying again. Do not retry immediately.`
    )
    this.name = 'RateLimitedError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export class ApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Default back-off when upstream sends a 429 without a usable Retry-After. */
const DEFAULT_RETRY_AFTER_SECONDS = 60

/**
 * POST JSON and return the parsed body.
 *
 * The single network path for this server: the GraphQL client and the optimizer
 * client both go through it, so timeout handling, 429 semantics and error
 * shaping cannot drift apart between them.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  label: string
): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new ApiError(
        `${label} did not respond within ${FETCH_TIMEOUT_MS / 1000}s.`
      )
    }
    throw new ApiError(`Could not reach ${label}: ${(error as Error).message}`)
  }

  if (response.status === 429) {
    const header = Number(response.headers.get('retry-after'))
    throw new RateLimitedError(
      Number.isFinite(header) && header > 0 ? header : DEFAULT_RETRY_AFTER_SECONDS
    )
  }

  const raw = await response.text()

  if (!response.ok) {
    // A dead or misrouted upstream answers with HTML, not JSON. Parse only if it
    // parses, so the real status is never masked by a JSON SyntaxError.
    let detail = raw.slice(0, 200)
    try {
      const parsed = JSON.parse(raw) as { error?: string }
      if (parsed.error) detail = parsed.error
    } catch {
      /* not JSON — fall back to the raw text */
    }
    throw new ApiError(`${label} returned HTTP ${response.status}: ${detail}`)
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    throw new ApiError(`${label} returned a non-JSON response.`)
  }
}
