// Headless MCP stdio server for EXTERNAL agents (Claude Desktop, Cursor, Zed, any MCP client).
// Runs the same core codecs directly on files — no IDE required. Build: node esbuild.mjs -> out/mcp-standalone.js
// Add to any MCP client config: { "mcpServers": { "officefiles": { "command": "node", "args": ["/path/out/mcp-standalone.js"] } } }
import * as fs from 'fs';
import { applyOps, DocumentIR, EditOp } from '../../core/ir';
import { parseCsv, serializeCsv } from '../../core/codecs/csv';
import { parseMarkdown, serializeMarkdown } from '../../core/codecs/markdown';

function load(uri: string): { ir: DocumentIR; kind: 'table' | 'document' } {
  const text = fs.readFileSync(uri, 'utf8');
  if (/\.(csv|tsv)$/i.test(uri)) return { ir: parseCsv(text), kind: 'table' };
  return { ir: parseMarkdown(text), kind: 'document' };
}
function store(uri: string, doc: { ir: DocumentIR; kind: string }) {
  const out = doc.kind === 'table' ? serializeCsv(doc.ir as any) : serializeMarkdown(doc.ir as any);
  fs.writeFileSync(uri, out, 'utf8');
}

const tools = {
  office_headless_read: (a: any) => load(a.uri).ir,
  office_headless_apply_edits: (a: { uri: string; edits: EditOp[] }) => {
    const doc = load(a.uri);
    applyOps(doc.ir, a.edits);
    store(a.uri, doc);            // headless mode writes immediately (agent approval is the gate)
    return { applied: a.edits.length };
  },
};

// Minimal JSON-RPC over stdio implementing MCP handshake (tools/list, tools/call).
// NOTE: production build uses @modelcontextprotocol/sdk Server + StdioServerTransport; this hand-rolled
// loop keeps M0 dependency-free and documents the exact wire contract we must satisfy.
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim(); buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg: any; try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});
function send(resp: any) { process.stdout.write(JSON.stringify(resp) + '\n'); }
function handle(msg: any) {
  const { id, method, params } = msg;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'officefiles', version: '0.0.1' } } });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: Object.keys(tools).map(name => ({ name, description: name, inputSchema: { type: 'object', properties: { uri: { type: 'string' }, edits: { type: 'array' } }, required: ['uri'] } })) } });
  if (method === 'tools/call') {
    try {
      const fn = (tools as any)[params.name];
      const result = fn ? fn(params.arguments ?? {}) : { error: 'unknown tool' };
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
    } catch (e: any) {
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(e?.message) }], isError: true } });
    }
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
}
