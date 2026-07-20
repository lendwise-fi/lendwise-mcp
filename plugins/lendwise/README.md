# lendwise (Claude Code plugin)

Connects Claude Code to the [Lendwise](https://lendwise.fi) MCP server — five read-only tools to compare DeFi supply/borrow markets and optimize allocations across Aave, Morpho and Compound.

It bundles the hosted transport (`https://mcp.lendwise.fi/mcp`), so there is nothing to install and no API key.

## Install

```bash
/plugin marketplace add lendwise-fi/lendwise-mcp
/plugin install lendwise@lendwise-fi
```

## What you get

- The `lendwise` MCP server (5 tools: `list_market_universe`, `find_best_markets`, `get_market_details`, `get_market_history`, `optimize_allocation`).
- A `/lendwise:find-yield` skill that guides the model through the discover → rank → check-stability → optimize flow.

Read-only. It compares markets; it never signs a transaction. Not financial advice.

Prefer running the server locally instead? `npx @lendwise/mcp` (stdio) — see the [docs](https://lendwise.fi/docs/api/mcp).
