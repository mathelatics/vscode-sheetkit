// mcp-ipc-proxy: a stdio MCP server that forwards tool calls into a running VS Code window
// through the OfficeFiles IPC bridge socket (src/host/ipc/bridge.ts). This is what makes
// "user writes a prompt -> agent edits the live open document" work for EXTERNAL agents
// (Claude Desktop, Cursor, Zed, opencode, any MCP client) without touching files on disk directly.
// Config: { "mcpServers": { "officefiles-live": { "command": "node", "args": ["/path/out/mcp-ipc-proxy.js"] } } }
import { createMcpServer } from './protocol';
import { officeTools, OFFICE_INSTRUCTIONS } from './officeTools';
import { createLiveBackend } from './liveBackend';

createMcpServer({
  server: { name: 'officefiles-live', version: '0.1.0', instructions: OFFICE_INSTRUCTIONS },
  tools: officeTools(createLiveBackend(), { live: true }),
});
