// Webview SPA bootstrap. Pattern cloned+improved from vscode-office ReactApp ({{configs}} -> __OFFICEFILES__).
import React from 'react';
import { createRoot } from 'react-dom/client';
import './main.css';

const configs = (window as any).__OFFICEFILES__ ?? { route: 'unknown' };

const api = (() => {
  const vscodeApi = (window as any).acquireVsCodeApi?.();
  const listeners = new Map<string, Set<(payload: any) => void>>();
  window.addEventListener('message', e => {
    const msg = e.data;
    if (!msg || msg.v !== 1) return; // versioned envelope (see host/bus.ts)
    listeners.get(msg.type)?.forEach(cb => cb(msg.payload));
  });
  return {
    on(type: string, cb: (payload: any) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
      return () => { listeners.get(type)?.delete(cb); };
    },
    emit(type: string, payload?: any) { vscodeApi?.postMessage({ v: 1, type, payload }); },
  };
})();

function Grid() {
  const [ir, setIr] = React.useState<any>(null);
  React.useEffect(() => {
    api.emit('ready');
    const off = api.on("doc:update", (p: any) => setIr(p.ir)); return () => off();
  }, []);
  if (!ir) return <div className="of-loading">Loading…</div>;
  const sheet = ir.sheets?.[0];
  const edit = (row: number, col: number, value: string) =>
    api.emit('cell.set', { row, col, value: value === '' ? null : isNaN(Number(value)) ? value : Number(value) });
  return (
    <div className="of-grid">
      <div className="of-toolbar">
        <span>{(window as any).__OFFICEFILES__.fileName}</span>
        <button onClick={() => api.emit('row.insert', { row: sheet.rows.length })}>+ Row</button>
        <button onClick={() => api.emit('save')}>Save</button>
      </div>
      <table>
        <tbody>
          {sheet.rows.map((r: any[], ri: number) => (
            <tr key={ri}>{r.map((c: any, ci: number) => (
              <td key={ci} contentEditable suppressContentEditableWarning
                onBlur={(e: any) => edit(ri, ci, e.target.innerText.trim())}>{c ?? ''}</td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarkdownView() {
  const [ir, setIr] = React.useState<any>(null);
  React.useEffect(() => {
    api.emit('ready');
    const off = api.on("doc:update", (p: any) => setIr(p.ir)); return () => off();
  }, []);
  if (!ir) return <div className="of-loading">Loading…</div>;
  const render = (b: any, i: number) => {
    const editable = (text: string) => ({
      contentEditable: true as any, suppressContentEditableWarning: true,
      onBlur: (e: any) => api.emit('block.replace', { index: i, block: { ...b, text: e.target.innerText } }),
    });
    switch (b.type) {
      case 'heading': return React.createElement(`h${Math.min(b.level ?? 1, 6)}`, editable(b.text), b.text);
      case 'code': return <pre {...editable(b.text)} className="of-code">{b.text}</pre>;
      case 'quote': return <blockquote {...editable(b.text)}>{b.text}</blockquote>;
      case 'list': return <ul>{(b.items ?? []).map((it: string, j: number) => <li key={j}>{it}</li>)}</ul>;
      default: return <p {...editable(b.text)}>{b.text}</p>;
    }
  };
  return (
    <div className="of-md">
      <div className="of-toolbar"><span>{(window as any).__OFFICEFILES__.fileName}</span>
        <button onClick={() => api.emit('block.append', { block: { type: 'paragraph', text: 'New paragraph' } })}>+ Block</button>
        <button onClick={() => api.emit('save')}>Save</button></div>
      {ir.blocks.map(render)}
    </div>
  );
}

const routes: Record<string, React.FC> = { grid: Grid, markdown: MarkdownView };
const View = routes[configs.route] ?? (() => <div>Unknown view: {configs.route}</div>);
createRoot(document.getElementById('root')!).render(<View />);
