# @lendwise/mcp

MCP server for [Lendwise](https://lendwise.fi) — compare DeFi supply markets across **Aave V3**, **Morpho** and **Compound V3** on 8 chains (~700 products, ~120 assets).

It answers questions like *"I have $1,000 to place in DeFi for the next 6 months — what are the best markets?"* against real yield data, in about four tool calls.

Read-only. It recommends; it never signs a transaction.

## Install

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

## Rate limits

The upstream API allows 60 GraphQL req/min/IP and 10 optimizer req/min/IP. A 429 is surfaced as an explicitly **retryable** error carrying `retryAfterSeconds` — back off, don't retry-storm.

## Not financial advice

Informational only. APYs are variable and historical yields do not predict future returns.

## License

MIT
