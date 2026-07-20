import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { RateLimitedError } from './graphql/client.js'
import {
  findBestMarkets,
  findBestMarketsArgs,
} from './tools/find-best-markets.js'
import {
  getMarketDetails,
  getMarketDetailsArgs,
} from './tools/get-market-details.js'
import {
  getMarketHistory,
  getMarketHistoryArgs,
} from './tools/get-market-history.js'
import {
  listMarketUniverse,
  listMarketUniverseArgs,
} from './tools/list-market-universe.js'
import {
  optimizeAllocation,
  optimizeAllocationArgs,
} from './tools/optimize-allocation.js'

export const VERSION = '0.1.1'

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

/**
 * Run a tool and render its result as MCP text content.
 *
 * A 429 is surfaced as an explicitly retryable error carrying the wait — the
 * agent has to back off, not hammer the endpoint the rate limit exists to
 * protect. Everything else is returned as `isError` text so the model can read
 * what went wrong and correct itself, rather than the transport throwing.
 */
async function run(
  handler: (args: unknown) => Promise<unknown>,
  args: unknown
): Promise<ToolResult> {
  try {
    const result = await handler(args)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'rate_limited',
              retryable: true,
              retryAfterSeconds: error.retryAfterSeconds,
              message: error.message,
            }),
          },
        ],
        isError: true,
      }
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'tool_failed',
            retryable: false,
            message: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    }
  }
}

/**
 * Register the five tools on a server instance.
 *
 * Both transports go through this one function: the stdio binary builds its own
 * server, while mcp-handler hands us one it constructed. If registration lived in
 * only one of those paths, the hosted and local servers would drift apart in what
 * they expose.
 */
export function registerTools(server: McpServer): McpServer {
  // Every tool is read-only and non-destructive, but reaches the public internet.
  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const

  server.registerTool(
    'list_market_universe',
    {
      title: 'List the market universe',
      description:
        'List every asset, chain and protocol that Lendwise actually tracks, ' +
        'with market counts. Call this FIRST — the filter values for ' +
        'find_best_markets must come from here, not from memory.',
      inputSchema: listMarketUniverseArgs,
      annotations: readOnly,
    },
    (args) => run(listMarketUniverse, args)
  )

  server.registerTool(
    'find_best_markets',
    {
      title: 'Find the best supply markets',
      description:
        'Rank current supply markets by net APY. Filtering and sorting run ' +
        'server-side against the latest snapshot. Defaults to markets with at ' +
        'least $1M TVL, because a thin market’s headline APY is mostly noise.',
      inputSchema: findBestMarketsArgs,
      annotations: readOnly,
    },
    (args) => run(findBestMarkets, args)
  )

  server.registerTool(
    'get_market_details',
    {
      title: 'Get market details',
      description:
        'Full detail for one market: protocol metadata, accepted collaterals, ' +
        'and the current APY split into base / rewards / fees with individual ' +
        'reward items.',
      inputSchema: getMarketDetailsArgs,
      annotations: readOnly,
    },
    (args) => run(getMarketDetails, args)
  )

  server.registerTool(
    'get_market_history',
    {
      title: 'Get market APY history',
      description:
        'Daily net-APY history for one market plus mean / stddev / min / max. ' +
        'Use this before committing to a market over a long horizon: it is what ' +
        'separates a durable yield from a temporary reward spike.',
      inputSchema: getMarketHistoryArgs,
      annotations: readOnly,
    },
    (args) => run(getMarketHistory, args)
  )

  server.registerTool(
    'optimize_allocation',
    {
      title: 'Optimize an allocation',
      description:
        'Split an amount across chosen markets to maximise yield at a target ' +
        'diversification, returning per-market amounts, the blended APY and a ' +
        'projected 6-month yield.',
      inputSchema: optimizeAllocationArgs,
      annotations: readOnly,
    },
    (args) => run(optimizeAllocation, args)
  )

  return server
}

/** Build a fully-registered server. Used by the stdio entrypoint. */
export function createServer(): McpServer {
  return registerTools(new McpServer({ name: 'lendwise', version: VERSION }))
}
