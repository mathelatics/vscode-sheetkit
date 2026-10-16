// Live OfficeFiles backend: forwards tool calls into a running VS Code window through the
// OfficeFiles IPC bridge socket (../ipc/bridge.ts). This is what makes
// "user writes a prompt -> agent edits the live open document" work for EXTERNAL agents
// (Claude Desktop, Cursor, Zed, opencode, any MCP client) without touching files on disk directly.
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { applyOps } from '../../core/ir';
import type { OfficeBackend, ApplyArgs, TargetArgs } from './officeTools';

function discoverSocket(): string | null {
  // Prefer the advertised registry files written by each running extension host.
  // Pick the newest live-PID registry so stale entries from previous installs don't win.
  const dir = process.platform === 'win32' ? '\\\\.\\pipe\\' : os.tmpdir();
  const candidates: Array<{ socketPath: string; mtime: number }> = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('officefiles-') || !f.endsWith('.sock.json')) continue;
      try {
        const full = path.join(dir, f);
        const info = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (!info?.socketPath || !info?.pid) continue;
        if (!process.kill(info.pid, 0)) continue; // window not alive
        candidates.push({ socketPath: info.socketPath, mtime: fs.statSync(full).mtimeMs });
      } catch { /* skip unreadable / dead */ }
    }
  } catch { /* ignore */ }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].socketPath;
}

export function createLiveBackend(): OfficeBackend {
  let sock: net.Socket | null = null;
  let seq = 0;
  let rxbuf = '';
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  function ensureConn(): Promise<net.Socket> {
    if (sock && !sock.destroyed) return Promise.resolve(sock);
    const p = discoverSocket();
    if (!p) return Promise.reject(new Error('no running VS Code with OfficeFiles found (open a window with the OfficeFiles extension enabled)'));
    return new Promise((resolve, reject) => {
      const s = net.connect(p);
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Error(`ipc connect timeout: ${p} (stale OfficeFiles socket registry in ${path.dirname(p)})`));
      }, 5000);
      s.on('connect', () => { clearTimeout(timer); sock = s; resolve(s); });
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
      s.on('close', () => { clearTimeout(timer); sock = null; });
      s.on('error', e => { clearTimeout(timer); sock = null; reject(e); });
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

  const ref = (a: TargetArgs) => ({ docId: a.docId, uri: a.uri ?? a.path });

  return {
    capabilities: () => call('capabilities', {}),
    list: () => call('documents.list', {}),
    read: (a) => call('documents.read', { ...ref(a), range: a.range }),
    search: (a) => call('documents.search', { query: a.query, regex: a.regex, limit: a.limit }),
    async applyEdits(a: ApplyArgs) {
      if (a.dryRun) {
        const ir = await call('documents.read', ref(a));
        const next = JSON.parse(JSON.stringify(ir));
        applyOps(next, a.edits ?? []);
        return { dryRun: true, applied: (a.edits ?? []).length, appliedOps: (a.edits ?? []).map(e => e.op) };
      }
      return call('documents.applyEdits', { ...ref(a), edits: a.edits ?? [], actor: a.actor });
    },
    save: (a) => call('documents.save', ref(a)),
    open: (a) => call('documents.open', { path: a.path }),
    extractPdfText: (a) => call('pdf.extractText', { path: a.path ?? a.uri }),
  };
}
