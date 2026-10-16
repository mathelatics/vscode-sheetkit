// Headless MCP stdio server for EXTERNAL agents (Claude Desktop, Cursor, Zed, opencode, CI…).
// Runs the core codecs directly on files on disk — no IDE required.
// Build: node esbuild.mjs -> out/mcp-standalone.js
// Config: { "mcpServers": { "officefiles": { "command": "node", "args": ["/path/out/mcp-standalone.js"] } } }
//
// Protocol + tool vocabulary live in ./protocol.ts and ./officeTools.ts so this server, the
// live proxy and (later) the CLI stay byte-for-byte consistent. Document access is the only
// thing that differs, and it is isolated in ./headlessBackend.ts.
import { createMcpServer } from './protocol';
import { officeTools, OFFICE_INSTRUCTIONS } from './officeTools';
import { createHeadlessBackend } from './headlessBackend';

createMcpServer({
  server: { name: 'officefiles', version: '0.1.0', instructions: OFFICE_INSTRUCTIONS },
  tools: officeTools(createHeadlessBackend(), { live: false }),
});
