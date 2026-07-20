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
    // `${basePath}/mcp`. Vercel mounts this function at '/api/mcp'; a same-app
    // rewrite in vercel.json exposes the public '/mcp' and hands the function
    // the *destination* path, so req.url is '/api/mcp' whether the client hits
    // '/mcp' or '/api/mcp' — basePath must stay '/api'. Change one without the
    // other and every request 404s while stdio still works.
    basePath: '/api',
    maxDuration: 60,
  }
)

export { handler as DELETE, handler as GET, handler as POST }
