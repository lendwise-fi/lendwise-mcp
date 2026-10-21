# @lendwise/mcp

**Unified view for lending markets. One standard.**

[![Lendwise MCP on mcprush](https://mcprush.com/badge/lendwise-mcp/score.svg)](https://mcprush.com/to/lendwise-mcp?ref=badge)

MCP server for [Lendwise](https://lendwise.fi) — compare and optimize DeFi supply/borrow markets across **Aave V3**, **Morpho**, **Compound V3** and **Blend** (Stellar) over live yield data.

It answers questions like *"I have $1,000 to place in DeFi for the next 6 months — what are the best markets?"* against real yield data, in about four tool calls.

Read-only. It compares markets; it never signs a transaction.

## Install

### Hosted (Streamable HTTP)

Point any MCP client at `https://mcp.lendwise.fi/mcp` — nothing to install. With Claude Code:

```bash
claude mcp add --transport http lendwise https://mcp.lendwise.fi/mcp
```

### Local (stdio)

```jsonc
// claude_desktop_config.json / .mcp.json
{
  "mcpServers": {
    "lendwise": {
      "command": "npx",
      "args": ["-y", "@lendwise/mcp"]
    }
  }
}
```

No API key. The server holds no secrets — it speaks only HTTPS to the public Lendwise API.

## Tools

| tool | what it's for |
| --- | --- |
| `list_market_universe` | Every asset, chain and protocol that actually exists, with counts. **Call this first** — it's what stops an agent guessing a filter value that isn't there. |
| `find_best_markets` | Current supply markets ranked by net APY. Filtering and sorting happen server-side. Defaults to ≥ $1M TVL. |
| `get_market_details` | One market in full: protocol metadata, collaterals, APY split into base / rewards / fees. |
| `get_market_history` | Daily net-APY series **plus mean / stddev / min / max** — the stability signal a long horizon needs. |
| `optimize_allocation` | Split an amount across markets at a target diversification. Returns per-market amounts, blended APY, projected 6-month yield. |

### Why the TVL floor exists

`find_best_markets` defaults to `minTvlUsd: 1_000_000`. In a thin market a headline APY is mostly noise, and steering someone with $1k into one is the most plausible real-world harm this server can do. Lower it deliberately, not by accident.

### Why `get_market_history` returns statistics, not just a series

A snapshot cannot tell a durable 6% from a 12% that is a reward programme ending next week. A 180-day standard deviation can. That is the number a 6-month decision actually turns on.

## Configuration

| env var | default | purpose |
| --- | --- | --- |
| `LENDWISE_API_URL` | `https://lendwise.fi` | Point at `http://localhost:3000` to develop against a local `lendwise/web`. |
| `LENDWISE_INTEGRATION` | unset | Set to `1` to run the network integration tests. |

## Development

```bash
pnpm install
pnpm typecheck
pnpm test                                   # unit tests, hermetic
LENDWISE_INTEGRATION=1 pnpm test            # + live API tests
pnpm build
```

### The one invariant to not break

The optimizer's contract is **positional**: we send `apy: number[]`, it returns `vault_index` — an offset into the array we sent, not an id. If the array we build and the array we map back through ever disagree, the server confidently attributes a real allocation to the *wrong market*, and every number still looks plausible.

Order is therefore established exactly once, from the caller's `productIds`, and both directions run off that single array (`buildApyVector` → `mapAllocations` in `src/core/optimizer.ts`). It is pinned by unit tests in both directions. Do not "simplify" it into a lookup by APY value.

## Releasing

Pushing a tag `vX.Y.Z` publishes `@lendwise/mcp@X.Y.Z` to npm through
[`.github/workflows/publish.yml`](.github/workflows/publish.yml), with OIDC trusted publishing —
no npm token is stored anywhere.

```bash
# 1. bump "version" in package.json (e.g. 0.1.5), commit, push to main
# 2. tag that commit with the same version and push the tag
git tag v0.1.5
git push origin v0.1.5
```

Two jobs. `build` has no permissions: it installs, typechecks, tests, builds and packs the
tarball. `publish` runs in the `npm` environment, is the only job allowed to mint the OIDC
token, and only publishes the tarball `build` produced, with scripts disabled. Dependency code
never runs next to the publish credential.

`package.json` is the only place the version lives: the server reads the version it reports to
MCP clients from it. The workflow fails before publishing if the tagged commit is not on `main`
or if the tag does not match `package.json`. It skips a version already on npm, so re-running a
release is safe.

One-time setup (already needed before the first tag): on npmjs.com, `@lendwise/mcp` →
**Settings** → **Trusted publishing** → GitHub Actions, organization `lendwise-fi`, repository
`lendwise-mcp`, workflow `publish.yml`, environment `npm`. The `npm` environment is created on
the first run; add a required reviewer to it in the repository settings to approve each
release by hand.

## Hosted deployment

`mcp.lendwise.fi` is the Vercel function `api/mcp.ts`, deployed on every push to `main`.

**No `packageManager` field in `package.json`** (nor `devEngines.packageManager`). With one,
Vercel installs with its own pnpm 12 (12.2.1, whatever version and hash the field pins), which
installs no dependency on a clean build. With a build cache it reuses stale `node_modules`
instead: the build passes, but `api/mcp.ts` compiles as CommonJS (TS2345 in the build log, MCP
SDK `dist/cjs` vs `dist/esm`) and the function crashes at load with `ERR_REQUIRE_ESM`. Every
request then gets a 500 while stdio and the tests still pass. Without the field Vercel uses
pnpm 10, which works. pnpm 12.5.1 is used locally and pinned in the publish workflow.

Setting the project environment variable `ENABLE_EXPERIMENTAL_COREPACK=1` should make Vercel
install the exact pinned version through Corepack instead. Untested here.

After switching the package manager either way, redeploy once **without build cache**: a pnpm 10
install on a cache left by pnpm 12 fails with `ERR_PNPM_NO_PKG_MANIFEST`.

After any build-config change, check a preview loads: `GET /mcp` must answer 405, not 500. On
production:

```bash
curl -s -X POST https://mcp.lendwise.fi/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
# → "serverInfo":{"name":"lendwise","version":"<package.json version>"}
```

## Rate limits

The upstream API allows 60 GraphQL req/min/IP and 10 optimizer req/min/IP. A 429 is surfaced as an explicitly **retryable** error carrying `retryAfterSeconds` — back off, don't retry-storm.

## Not financial advice

Informational only. APYs are variable and historical yields do not predict future returns.

## License

MIT
