// Headless MCP stdio server for EXTERNAL agents (Claude Desktop, Cursor, Zed, any MCP client).
// Runs the same core codecs directly on files — no IDE required. Build: node esbuild.mjs -> out/mcp-standalone.js
// Add to any MCP client config: { "mcpServers": { "officefiles": { "command": "node", "args": ["/path/out/mcp-standalone.js"] } } }
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { applyOps, DocumentIR, EditOp, isTableDoc } from '../../core/ir';
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

// Accept both plain paths and file:// URIs so MCP clients can pass either form.
function toPath(uriOrPath: string): string {
  if (/^file:\/\//i.test(uriOrPath)) return fileURLToPath(uriOrPath);
  return uriOrPath;
}

function pathFrom(a: any): string {
  const p = toPath(String(a.uri ?? ''));
  if (!p) throw new Error('missing required argument: uri');
  return p;
}

const tools: Record<string, { desc: string; fn: (a: any) => any }> = {
  office_read: {
    desc: 'Read a document (csv/tsv/markdown) and return its structured IR (blocks or table rows).',
    fn: (a) => load(pathFrom(a)).ir,
  },
  office_search: {
    desc: 'Search a document for a query string. Returns matches with block/row/column locations.',
    fn: (a) => {
      const { ir } = load(pathFrom(a));
      const q = String(a.query ?? '').toLowerCase();
      const hits: any[] = [];
      if (isTableDoc(ir)) {
        ir.sheets.forEach((s, si) => s.rows.forEach((r, ri) => r.forEach((v, ci) => {
          if (String(v ?? '').toLowerCase().includes(q)) hits.push({ sheet: si, row: ri, col: ci, value: v });
        })));
      } else {
        ir.blocks.forEach((b, bi) => {
          const text = JSON.stringify(b);
          if (text.toLowerCase().includes(q)) hits.push({ block: bi, type: b.type, preview: text.slice(0, 200) });
        });
      }
      return { total: hits.length, hits: hits.slice(0, 100) };
    },
  },
  office_apply_edits: {
    desc: 'Apply typed edit operations (insert/update/delete on blocks or cells) to a document and save it.',
    fn: (a: { uri: string; edits: EditOp[] }) => {
      const p = pathFrom(a);
      const doc = load(p);
      applyOps(doc.ir, a.edits ?? []);
      store(p, doc);            // headless mode writes immediately (agent approval is the gate)
      return { applied: (a.edits ?? []).length };
    },
  },
  office_save: {
    desc: 'Re-serialize the document IR back to disk (round-trip check / explicit save).',
    fn: (a: { uri: string }) => {
      const p = pathFrom(a);
      const doc = load(p);
      store(p, doc);
      return { saved: true };
    },
  },
  office_extract_pdf_text: {
    desc: 'Extract text from a PDF file (per page) so you can read/search its contents. Read-only.',
    fn: (a: { uri: string }) => {
      const p = pathFrom(a);
      if (!/\.pdf$/i.test(p)) throw new Error('office_extract_pdf_text requires a .pdf path');
      let extract: ((buf: Uint8Array, opts?: any) => Promise<any>) | undefined;
      try { ({ extractText: extract } = require('unpdf')); } catch { /* optional */ }
      if (!extract) throw new Error('PDF extraction unavailable in this build (unpdf not installed)');
      const bytes = new Uint8Array(fs.readFileSync(p));
      // tools/call awaits promises? our loop is sync — do it synchronously via pdf.js is not possible,
      // so mark as async-capable: caller receives a thenable handled by the RPC layer below.
      return extract(bytes, { mergePages: false }).then(r => {
        // unpdf returns { totalPages, text: string[] } (one entry per page when mergePages:false)
        const pages: string[] = Array.isArray(r?.text) ? r.text : Array.isArray(r?.pages) ? r.pages : [];
        return { pages, total: pages.length };
      });
    },
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

// Per-tool JSON Schemas so agents know exactly what arguments to pass.
const toolSchemas: Record<string, any> = {
  office_read: { type: 'object', properties: { uri: { type: 'string', description: 'File path or file:// URI of a .csv/.tsv/.md document' } }, required: ['uri'] },
  office_search: { type: 'object', properties: { uri: { type: 'string' }, query: { type: 'string', description: 'Case-insensitive substring to locate' } }, required: ['uri', 'query'] },
  office_apply_edits: {
    type: 'object',
    properties: {
      uri: { type: 'string' },
      edits: {
        type: 'array',
        description: 'Typed edit ops. Table docs: {op:"setCell",row,col,value}, {op:"insertRow",row,values?}, {op:"deleteRow",row}, {op:"insertColumn",col,header?}, {op:"replaceText",search,replacement}. Document (markdown) docs: {op:"appendBlock",block:{type,text}}, {op:"insertBlock",after?,block}, {op:"replaceBlock",index,block}, {op:"deleteBlock",index}, {op:"replaceText",search,replacement}.',
        items: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'] },
      },
    },
    required: ['uri', 'edits'],
  },
  office_save: { type: 'object', properties: { uri: { type: 'string' } }, required: ['uri'] },
  office_extract_pdf_text: { type: 'object', properties: { uri: { type: 'string', description: 'Path or file:// URI of a .pdf file' } }, required: ['uri'] },
};

async function handle(msg: any) {
  const { id, method, params } = msg;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'officefiles', version: '0.0.1' } } });
  if (method === 'notifications/initialized') return; // notification — no response
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.desc, inputSchema: toolSchemas[name] })) } });
  if (method === 'tools/call') {
    try {
      const t = (tools as any)[params?.name];
      if (!t) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool: ${params?.name}` } });
      const result = await Promise.resolve(t.fn(params.arguments ?? {}));
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
    } catch (e: any) {
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(e?.message ?? e) }], isError: true } });
    }
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
}
