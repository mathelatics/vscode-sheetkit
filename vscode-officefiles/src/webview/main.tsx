// Webview SPA bootstrap. Pattern cloned+improved from vscode-office ReactApp ({{configs}} -> __OFFICEFILES__).
import React from 'react';
import { createRoot } from 'react-dom/client';
import './main.css';
// x-data-spreadsheet: the MIT grid that vscode-office's Excel view is built on. Loaded as a
// side-effect UMD bundle (exposes window.x_spreadsheet) + its stylesheet.
import 'x-data-spreadsheet/dist/xspreadsheet.css';
import 'x-data-spreadsheet/dist/xspreadsheet.js';
import Vditor from 'vditor';

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

// ---- IR <-> x-data-spreadsheet conversion ---------------------------------

function rowsToXs(rows: any[][]) {
  const out: Record<number, { cells: Record<number, { text: string }> }> = {};
  (rows ?? []).forEach((r, ri) => {
    const cells: Record<number, { text: string }> = {};
    (r ?? []).forEach((v, ci) => {
      if (v === null || v === undefined || v === '') return;
      cells[ci] = { text: String(v) };
    });
    if (Object.keys(cells).length) out[ri] = { cells };
  });
  return out;
}

function xsToRows(sheet: any): any[][] {
  const rows: any[][] = [];
  const rs = sheet?.rows ?? {};
  for (const ri of Object.keys(rs)) {
    const rIdx = Number(ri);
    const cells = rs[ri]?.cells ?? {};
    const arr: any[] = [];
    for (const ci of Object.keys(cells)) {
      const text = cells[ci]?.text ?? '';
      arr[Number(ci)] = text === '' ? null : text;
    }
    rows[rIdx] = arr;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

function irToSheets(ir: any) {
  return (ir?.sheets ?? []).map((s: any) => ({ name: s.name, rows: rowsToXs(s.rows) }));
}

const norm = (rows: any[][]) => JSON.stringify((rows ?? []).map(r => (r ?? []).map(c => (c === undefined ? null : c))));

function Grid() {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const xsRef = React.useRef<any>(null);
  const baseline = React.useRef<Array<{ name: string; rows: any[][] }>>([]);
  const loading = React.useRef(false);
  const flushTimer = React.useRef<any>(null);

  const applySheets = (ir: any) => {
    const sheets = irToSheets(ir);
    baseline.current = sheets.map((s: any) => ({ name: s.name, rows: xsToRows(s as any) }));
    loading.current = true;
    xsRef.current?.loadData(sheets.length ? sheets : [{ name: 'Sheet1', rows: {} }]);
    loading.current = false;
  };

  const flush = () => {
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
    const inst = xsRef.current;
    if (!inst) return;
    const data: any[] = inst.getData?.() ?? [];
    data.forEach((sheet: any, i: number) => {
      const rows = xsToRows(sheet);
      const prev = baseline.current[i];
      const name = sheet?.name ?? prev?.name ?? `Sheet${i + 1}`;
      if (!prev || norm(prev.rows) !== norm(rows)) {
        baseline.current[i] = { name, rows };
        api.emit('sheet.set', { sheet: name, rows });
      }
    });
  };

  React.useEffect(() => {
    const Spreadsheet = (window as any).x_spreadsheet;
    if (!Spreadsheet || !hostRef.current) return;
    const el = hostRef.current;
    const inst = Spreadsheet(el, {
      mode: 'edit',
      showToolbar: true,
      showGrid: true,
      showContextmenu: true,
      showBottomBar: true,
      view: { height: () => el.clientHeight, width: () => el.clientWidth },
    });
    xsRef.current = inst;
    inst.change(() => {
      if (loading.current) return;
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(flush, 200);
    });

    api.emit('ready');
    const off = api.on('doc:update', (p: any) => {
      const incoming = (p.ir?.sheets ?? []).map((s: any) => ({ name: s.name, rows: s.rows }));
      const same = incoming.length === baseline.current.length
        && incoming.every((s: any, i: number) => norm(s.rows) === norm(baseline.current[i]?.rows ?? []));
      if (same) return; // echo of our own edit — keep selection/focus
      applySheets(p.ir);
    });
    return () => { off(); if (flushTimer.current) clearTimeout(flushTimer.current); };
  }, []);

  return (
    <div className="of-grid-shell">
      <div className="of-toolbar">
        <span className="of-title">{configs.fileName}</span>
        <span className="of-spacer" />
        <button onClick={() => api.emit('save')}>Save</button>
      </div>
      <div className="of-grid-host" ref={hostRef} />
    </div>
  );
}

function MarkdownView() {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const vdRef = React.useRef<any>(null);
  const loading = React.useRef(false);
  const lastSent = React.useRef('');
  const flushTimer = React.useRef<any>(null);

  React.useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const mode = configs.editMode === 'source' ? 'sv' : 'ir';
    const vd = new Vditor(el, {
      mode,
      cdn: configs.vditorCdn,
      height: '100%',
      value: '',
      cache: { enable: false },
      toolbarConfig: { pin: true },
      counter: { enable: true },
      outline: { enable: false, position: 'left' },
      after: () => { vdRef.current = vd; api.emit('ready'); },
      input: () => {
        if (loading.current) return;
        if (flushTimer.current) clearTimeout(flushTimer.current);
        flushTimer.current = setTimeout(() => {
          lastSent.current = vdRef.current?.getValue?.() ?? '';
          api.emit('md.set', { markdown: lastSent.current });
        }, 250);
      },
    });
    vdRef.current = vd;

    const off = api.on('md:update', (p: any) => {
      const inst = vdRef.current;
      if (!inst?.setValue) return;
      if ((p.markdown ?? '') === lastSent.current) return; // our own echo — don't reset the caret
      if ((p.markdown ?? '') === (inst.getValue?.() ?? '')) return;
      loading.current = true;
      inst.setValue(p.markdown ?? '');
      loading.current = false;
    });
    return () => { off(); if (flushTimer.current) clearTimeout(flushTimer.current); };
  }, []);

  return (
    <div className="of-md-shell">
      <div className="of-md-host" ref={hostRef} />
      <button className="of-save-fab" onClick={() => api.emit('save')}>Save</button>
    </div>
  );
}

const routes: Record<string, React.FC> = { grid: Grid, markdown: MarkdownView };
const View = routes[configs.route] ?? (() => <div>Unknown view: {configs.route}</div>);
createRoot(document.getElementById('root')!).render(<View />);
