import { createMcpHandler } from 'mcp-handler'

import { registerTools } from '../src/core/server.js'

/**
 * Hosted entrypoint — Streamable HTTP, deployed to mcp.lendwise.fi.
 *
 * mcp-handler constructs the server and hands it to us, so registration goes
 * through the same `registerTools` the stdio binary uses. The two transports
 * cannot expose different tool sets.
 */
const handler = createMcpHandler(
  (server) => {
    registerTools(server)
  },
  {},
  {
    // MUST match where this function is mounted. mcp-handler matches on the
    // request pathname and defaults to '/mcp'; this file is served at
    // '/api/mcp', so without basePath every request 404s and the hosted
    // transport is dead while stdio still works.
    basePath: '/api',
    maxDuration: 60,
  }
)

export { handler as DELETE, handler as GET, handler as POST }
