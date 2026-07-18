#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { createServer } from '../core/server.js'

/**
 * stdio entrypoint — what `npx lendwise-mcp` runs.
 *
 * Nothing may be written to stdout except MCP protocol frames: stdout IS the
 * transport. Diagnostics go to stderr.
 */
async function main() {
  const server = createServer()
  await server.connect(new StdioServerTransport())
  console.error('lendwise-mcp ready on stdio')
}

main().catch((error) => {
  console.error('lendwise-mcp failed to start:', error)
  process.exit(1)
})
