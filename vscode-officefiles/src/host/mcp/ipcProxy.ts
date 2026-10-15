// mcp-ipc-proxy: a stdio MCP server that FORWARDS tool calls into a running VS Code window
// through the OfficeFiles IPC bridge socket (src/host/ipc/bridge.ts). This is what makes
// "user writes a prompt -> agent edits the live open document" work for EXTERNAL agents
// (Claude Desktop, Cursor, Zed, any MCP client) without touching files on disk directly.
// Config example:
//   { "mcpServers": { "officefiles-live": { "command": "node", "args": ["/path/out/mcp-ipc-proxy.js"] } } }
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

function discoverSocket(): string | null {
  // Prefer the advertised registry files written by each running extension host.
  const dir = process.platform === 'win32' ? '\\\\.\\pipe\\' : os.tmpdir();
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('officefiles-') || !f.endsWith('.sock.json')) continue;
      const info = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (process.kill(info.pid, 0)) return info.socketPath; // window still alive
    }
  } catch { /* ignore */ }
  return null;
}

let sock: net.Socket | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let rxbuf = '';

function ensureConn(): Promise<net.Socket> {
  if (sock && !sock.destroyed) return Promise.resolve(sock);
  const p = discoverSocket();
  if (!p) return Promise.reject(new Error('no running VS Code with OfficeFiles IPC bridge found (open a window; setting officefiles.agent.ipcBridge=true)'));
  return new Promise((resolve, reject) => {
    const s = net.connect(p);
    s.on('connect', () => { sock = s; resolve(s); });
    s.on('data', chunk => {
      rxbuf += chunk.toString();
      let i: number;
      while ((i = rxbuf.indexOf('\n')) >= 0) {
        const line = rxbuf.slice(0, i).trim(); rxbuf = rxbuf.slice(i + 1);
        if (!line) continue;
        let msg: any; try { msg = JSON.parse(line); } catch { continue; }
        const pr = pending.get(msg.id);
        if (pr) { pending.delete(msg.id); msg.error ? pr.reject(new Error(msg.error.message)) : pr.resolve(msg.result); }
      }
    });
    s.on('close', () => { sock = null; });
    s.on('error', e => { sock = null; reject(e); });
  });
}

function call(method: string, params: any): Promise<any> {
  return ensureConn().then(s => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    s.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`ipc timeout: ${method}`)); } }, 15000);
  }));
}

const tools: Record<string, { desc: string; schema: any; run: (a: any) => Promise<any> }> = {
  live_list_documents: { desc: 'List OfficeFiles documents currently open in the user VS Code window.', schema: { type: 'object', properties: {} }, run: () => call('documents.list', {}) },
  live_read_document: { desc: 'Read an open document as structured IR JSON (live, includes unsaved edits).', schema: { type: 'object', properties: { uri: { type: 'string' }, docId: { type: 'string' } } }, run: a => call('documents.read', a) },
  live_search: { desc: 'Search all open documents; returns locations you can target with applyEdits.', schema: { type: 'object', properties: { query: { type: 'string' }, regex: { type: 'boolean' } }, required: ['query'] }, run: a => call('documents.search', a) },
  live_apply_edits: { desc: 'Apply typed edit ops to the LIVE open document (goes through undo stack; user sees it instantly).', schema: { type: 'object', properties: { uri: { type: 'string' }, docId: { type: 'string' }, edits: { type: 'array', items: { type: 'object' } } }, required: ['edits'] }, run: a => call('documents.applyEdits', a) },
  live_save_document: { desc: 'Save the open document to disk.', schema: { type: 'object', properties: { uri: { type: 'string' }, docId: { type: 'string' } } }, run: a => call('documents.save', a) },
};

// ---- stdio MCP loop (same wire contract as out/mcp-standalone.js) ----
let buf = '';
process.stdin.on('data', chunk => {
  buf += chunk.toString();
  let i: number;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let msg: any; try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});
function send(r: any) { process.stdout.write(JSON.stringify(r) + '\n'); }
async function handle(msg: any) {
  const { id, method, params } = msg;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'officefiles-live', version: '0.0.1' } } });
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.desc, inputSchema: t.schema })) } });
  if (method === 'tools/call') {
    const t = (tools as any)[params?.name];
    if (!t) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool: ${params?.name}` } });
    try {
      const result = await t.run(params.arguments ?? {});
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
    } catch (e: any) {
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(e?.message ?? e) }], isError: true } });
    }
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
}
