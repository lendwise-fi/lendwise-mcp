# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MCP server for Lendwise — read-only DeFi market comparison (Aave V3, Morpho, Compound V3 across 27 standardized chains). It recommends; it never signs a transaction. Holds no secrets: it speaks only HTTPS to the public Lendwise API.

## Commands

```bash
pnpm typecheck                    # tsc --noEmit against tsconfig.check.json (covers src + api + vitest.config)
pnpm test                         # unit tests, hermetic (no network)
LENDWISE_INTEGRATION=1 pnpm test  # also runs live-API integration tests (spends real rate-limit budget)
pnpm vitest run src/core/__tests__/optimizer.test.ts   # single test file
pnpm build                        # tsc → dist/ (compiles src only; api/ is deployed by Vercel, not built here)
pnpm start                        # run the stdio binary from dist/
```

`pnpm build` needs no network — GraphQL documents are hand-written, not codegen'd (see below).

Env: `LENDWISE_API_URL` (default `https://lendwise.fi`) — point at `http://localhost:3000` to develop against a local `lendwise/web` checkout.

## Sibling repo: `../web` (the upstream API)

This server is a thin client of the Lendwise web app at `/Users/cedric/Projects/lendwise/web` — the API it consumes is implemented there, and most cross-cutting questions (schema fields, filters, rate limits, data quality semantics) are answered by reading that codebase. It has its own `CLAUDE.md`; read it when working across both.

Key locations in `../web`:

- `src/lib/graphql/schema.ts` + `resolvers.ts` — the GraphQL schema this server's hand-written documents (`src/core/graphql/queries.ts`) must stay compatible with. When a query here fails or a field is missing, check the schema there first.
- `src/app/api/graphql/` — the `/api/graphql` endpoint (rate limits, query cost ceiling).
- `src/app/api/optimizer/` — the optimizer proxy this server calls (never `optimizer.lendwise.fi` directly).

Local dev loop: run `pnpm dev` in `../web` (localhost:3000), then point this server at it with `LENDWISE_API_URL=http://localhost:3000` — including for integration tests (`LENDWISE_INTEGRATION=1 LENDWISE_API_URL=http://localhost:3000 pnpm test`).

## Sibling repo: `../docs` (public documentation)

The public docs site (VitePress, served at `lendwise.fi/docs`) lives at `/Users/cedric/Projects/lendwise/docs` and has its own `CLAUDE.md`. **User-facing changes to this server — new/renamed tools, changed arguments or defaults, install instructions — usually need a matching docs update there.** There is no MCP page yet; `api/` (next to `api/graphql.md`) is the natural home when one is added.

Conventions that matter when editing docs: platform counts (chains, markets, assets) are interpolated from the `stats.data.ts` build-time loader, never hardcoded; `pnpm build` in `../docs` is the correctness check (no tests/linter there).

`.claude/settings.local.json` grants access to `../web` and `../docs` via `additionalDirectories`, so files there can be read/searched directly.

## Architecture

Two transports, one tool registry:

- `src/core/server.ts` — `registerTools()` registers the five tools. **Both entrypoints must go through this function** so the hosted and local servers can't drift apart in what they expose.
- `src/bin/stdio.ts` — stdio binary (`npx @lendwise/mcp`). Nothing may be written to stdout except MCP protocol frames; diagnostics go to stderr.
- `api/mcp.ts` — hosted Streamable HTTP via `mcp-handler`, deployed to Vercel. Public URL is `mcp.lendwise.fi/mcp`, mapped by a same-app rewrite in `vercel.json` onto the function Vercel mounts at `/api/mcp`. A same-app rewrite passes the *destination* path, so `basePath: '/api'` must stay in sync with that mount (mcp-handler matches the pathname exactly against `${basePath}/mcp`) — without it every request 404s while stdio still works.

Each tool lives in `src/core/tools/*.ts` and exports a handler plus a Zod raw-shape args object. `server.ts` wraps every handler in `run()`, which shapes errors as readable `isError` text: a 429 becomes `{ error: 'rate_limited', retryable: true, retryAfterSeconds }`, everything else `{ error: 'tool_failed', retryable: false }`.

All network traffic goes through one function — `postJson()` in `src/core/http.ts` (timeout, 429 → `RateLimitedError`, error shaping). The GraphQL client (`src/core/graphql/client.ts`) and optimizer client (`src/core/optimizer.ts`) both use it; don't add a second fetch path.

## The one invariant to not break

The optimizer's contract is **positional**: we send `apy: number[]`, it returns `vault_index` — an offset into the array we sent, not an id. If the array we build and the array we map back through ever disagree, the server confidently attributes a real allocation to the *wrong market*, and every number still looks plausible.

Order is established exactly once, from the caller's `productIds`, and both directions run off that single array (`buildApyVector` → `mapAllocations` in `src/core/optimizer.ts`; the tool passes the `found` array to both). Pinned by unit tests in both directions. Do not "simplify" it into a lookup by APY value.

## Deliberate design decisions (don't undo)

- **GraphQL documents are hand-written** in `src/core/graphql/queries.ts`, not generated — codegen would make a live endpoint a build-time dependency of a public package. Keep selection sets tight: the API's query cost limit scales with `first`, so extra fields can push a large page over the ceiling.
- **NaN never escapes a tool.** Upstream Postgres `double precision` can hold NaN; `finite()` (`src/core/tools/shared.ts`) and `finiteOnly()` (`src/core/stats.ts`) coerce/drop it. A market with no usable APY is reported as *missing*, never defaulted to 0 — a 0 tells the solver "worthless" instead of "unknown".
- **`find_best_markets` defaults to `minTvlUsd: 1_000_000`.** In a thin market a headline APY is mostly noise; steering someone into one is the most plausible real-world harm this server can do. The floor is lowered deliberately, never silently.
- **`optimize_allocation` fetches APYs in ONE batched GraphQL request** (server-side `productIds` filter). Per-product requests would burn up to 20 of the 60 req/min budget on a single call.
- **Optimizer responses are validated, not cast** — a 200 with `success: false` or missing `allocations` must throw, not surface as a plausible $0 allocation.
- Upstream limits: 60 GraphQL req/min/IP, 10 optimizer req/min/IP. Always call the solver through the Lendwise proxy (`/api/optimizer`), never `optimizer.lendwise.fi` directly.
- Every tool response carries the `NOT_ADVICE` disclaimer and snapshot freshness (`asOf`); rows below 50% slot completeness are flagged `reliable: false` rather than silently returned as fact.

## Versioning

`VERSION` in `src/core/server.ts` is hardcoded and must be kept in sync with `package.json` on version bumps.
