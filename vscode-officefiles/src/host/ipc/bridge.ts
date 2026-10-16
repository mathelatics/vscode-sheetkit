// IPC bridge: lets an EXTERNAL MCP client (Claude Desktop, Cursor CLI, scripts) drive the
// LIVE editors inside a running VS Code window — agent edits flow through ops.applyEdits so
// open webviews update instantly and edits land in the undo stack. (research/05 M6)
// Protocol: newline-delimited JSON over a local socket. Requests {id,method,params} / responses {id,result,error}.
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { ops, openDocument } from '../ops/documentOps';
import { extractPdfText } from '../ops/ooxmlService';
import { capabilityReport } from '../../core/codecs/registry';

export function socketPath(): string {
  return process.platform === 'win32'
    ? '\\\\.\\pipe\\officefiles-' + vscode.env.machineId.slice(0, 8)
    : path.join(os.tmpdir(), `officefiles-${vscode.env.machineId.slice(0, 8)}.sock`);
}

const methods: Record<string, (params: any) => any | Promise<any>> = {
  'capabilities': () => ({ mode: 'live', ...capabilityReport() }),
  'documents.list': () => ops.listDocuments(),
  'documents.read': (p) => ops.read(p.docId ?? p.uri, p.range),
  'documents.search': (p) => ops.search(p.query, !!p.regex),
  'documents.applyEdits': (p) => ops.applyEdits(p.docId ?? p.uri, p.edits ?? [], p.actor ?? 'mcp-ipc'),
  'documents.save': (p) => ops.save(p.docId ?? p.uri),
  'documents.open': async (p) => {
    const uri = vscode.Uri.file(String(p.path ?? p.uri));
    await openDocument(uri);
    return ops.listDocuments().find(d => d.uri === uri.toString()) ?? { opened: uri.toString() };
  },
  'pdf.extractText': async (p) => {
    const uri = vscode.Uri.file(String(p.path ?? p.uri));
    const bytes = await vscode.workspace.fs.readFile(uri);
    return extractPdfText(bytes);
  },
};

/** Start the server; returns a Disposable that cleans up socket file. */
export function startIpcBridge(context: vscode.ExtensionContext): vscode.Disposable {
  const p = socketPath();
  try { if (process.platform !== 'win32' && fs.existsSync(p)) fs.unlinkSync(p); } catch { /* stale socket */ }

  const server = net.createServer(conn => {
    let buf = '';
    conn.on('data', async chunk => {
      buf += chunk.toString();
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg: any; try { msg = JSON.parse(line); } catch { continue; }
        const { id, method, params } = msg;
        try {
          const fn = methods[method];
          if (!fn) throw new Error(`unknown method: ${method}`);
          const result = await fn(params ?? {});
          conn.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
        } catch (e: any) {
          conn.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: String(e?.message ?? e) } }) + '\n');
        }
      }
    });
    conn.on('error', () => { /* client vanished; ignore */ });
  });

  server.listen(p, () => {
    // Advertise where the external stdio proxy should connect.
    try { fs.writeFileSync(p + '.json', JSON.stringify({ socketPath: p, pid: process.pid }), 'utf8'); } catch { /* ok */ }
  });
  context.subscriptions.push(new vscode.Disposable(() => {
    server.close();
    try { if (process.platform !== 'win32') { fs.unlinkSync(p); fs.unlinkSync(p + '.json'); } } catch { /* ok */ }
  }));
  return new vscode.Disposable(() => server.close());
}
