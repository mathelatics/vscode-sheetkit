// Versioned multi-subscriber host<->webview bus (successor to vscode-office Handler).
// Envelope: { v:1, id?, type, payload?, error? } — supports request/response with timeouts.
import * as vscode from 'vscode';

export interface BusMessage {
  v: 1;
  id?: string;          // present for request/response pairs
  type: string;         // e.g. 'doc/update', 'grid/edit', 'rpc/result'
  payload?: any;
  error?: string;       // structured error channel (missing in vscode-office)
}

type Listener<T = any> = (payload: T, msg: BusMessage) => void | Promise<void>;

export class DocBus implements vscode.Disposable {
  private listeners = new Map<string, Set<Listener>>();   // MULTI-subscriber (deviation: theirs replaces)
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private seq = 0;
  private closed = false;
  private disposables: vscode.Disposable[] = [];

  static attach(panel: vscode.WebviewPanel): DocBus {
    const bus = new DocBus(panel.webview);
    bus.disposables.push(panel.onDidDispose(() => bus.dispose()));
    return bus;
  }

  constructor(private target: vscode.Webview) {
    this.disposables.push(target.onDidReceiveMessage(m => this.receive(m as BusMessage)));
  }

  on<T = any>(type: string, cb: Listener<T>): vscode.Disposable {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb as Listener);
    return new vscode.Disposable(() => this.listeners.get(type)?.delete(cb as Listener));
  }

  emit(type: string, payload?: any) {
    if (this.closed) return;
    this.target.postMessage({ v: 1, type, payload } satisfies BusMessage);
  }

  /** Fire-and-track errors: host->webview request awaiting 'result:<type>' with same id. */
  request(type: string, payload?: any, timeoutMs = 5000): Promise<any> {
    const id = `h${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`bus timeout: ${type}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.emit(type, payload);
      // route result by convention: responder emits `${type}:result` / `${type}:error` with id echoed
      const ok = this.on<{ id: string; value: any }>(`${type}:result`, p => { if (p?.id === id) { clearTimeout(this.pending.get(id)?.timer); this.pending.get(id)?.resolve(p.value); } });
      const err = this.on<{ id: string; error: string }>(`${type}:error`, p => { if (p?.id === id) { clearTimeout(this.pending.get(id)?.timer); this.pending.get(id)?.reject(new Error(p.error)); } });
      this.disposables.push(ok, err);
    });
  }

  private async receive(msg: BusMessage) {
    if (!msg || msg.v !== 1) return; // version guard (theirs has none)
    for (const cb of [...(this.listeners.get(msg.type) ?? [])]) {
      try { await cb(msg.payload, msg); } catch (e: any) {
        // structured error back to webview instead of only showErrorMessage toast
        if (msg.id) this.emit('bus:error', { id: msg.id, error: String(e?.message ?? e) });
        console.error('[officefiles bus]', msg.type, e);
      }
    }
  }

  dispose() {
    this.closed = true;
    this.listeners.clear();
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    this.disposables.forEach(d => d.dispose());
  }
}

/** Webview-side twin (plain DOM, no vscode module available there). Mirrors API surface. */
export function createWebviewBus(vscodeApi: { postMessage(m: any): void } | undefined) {
  const listeners = new Map<string, Set<(m: BusMessage) => void>>();
  window.addEventListener('message', (e) => {
    const msg = e.data as BusMessage;
    if (!msg || msg.v !== 1) return;
    listeners.get(msg.type)?.forEach(cb => cb(msg));
  });
  return {
    on(type: string, cb: (m: BusMessage) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
      return () => { listeners.get(type)?.delete(cb); };
    },
    emit(type: string, payload?: any) { vscodeApi?.postMessage({ v: 1, type, payload }); },
  };
}
