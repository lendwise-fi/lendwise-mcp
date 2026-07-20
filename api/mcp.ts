import { createMcpHandler } from 'mcp-handler'

import { registerTools } from '../src/core/server.js'

/**
 * Hosted entrypoint — Streamable HTTP, served at https://mcp.lendwise.fi/mcp.
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
    // mcp-handler matches the request pathname with EXACT equality against
    // `${basePath}/mcp`. Vercel mounts this function at '/api/mcp', and the
    // vercel.json rewrite that exposes the public '/mcp' hands the function the
    // ORIGINAL request path — '/mcp', not the rewrite destination (verified in
    // prod: with basePath '/api', '/mcp' reached the function and got mcp-
    // handler's own "Not found"). So basePath is ''. Direct '/api/mcp' hits are
    // 308-redirected to '/mcp' in vercel.json instead of being served here.
    basePath: '',
    maxDuration: 60,
  }
)

export { handler as DELETE, handler as GET, handler as POST }
