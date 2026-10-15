// DocumentOps: the single capability registry used by webview bus, commands, LM tools and MCP server.
// Deviation from vscode-office: all logic lives here (testable, no Handler closures), providers are thin.
import * as vscode from 'vscode';
import { DocumentIR, EditOp, applyOps, isTableDoc, isTextDoc } from '../../core/ir';
import { formatForPath } from '../../core/codecs/registry';
import { ooxml } from './ooxmlService';

export interface ManagedDoc {
  id: string;
  uri: vscode.Uri;
  kind: 'table' | 'document';
  /** source of truth = live TextDocument for text formats; IR derived via codec */
  textDocument?: vscode.TextDocument;
  ir?: DocumentIR;              // for binary formats later (xlsx/docx)
  dirty: boolean;
}

type Listener = (doc: ManagedDoc, reason: string) => void;

class Registry {
  private docs = new Map<string, ManagedDoc>();
  private listeners = new Set<Listener>();
  onChange(cb: Listener) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  add(doc: ManagedDoc) { this.docs.set(doc.id, doc); this.fire(doc, 'open'); }
  remove(id: string) { const d = this.docs.get(id); if (d) { this.docs.delete(id); this.fire(d, 'close'); } }
  get(idOrUri: string): ManagedDoc | undefined {
    if (this.docs.has(idOrUri)) return this.docs.get(idOrUri);
    const u = vscode.Uri.parse(idOrUri).toString();
    return [...this.docs.values()].find(d => d.uri.toString() === u);
  }
  list(): ManagedDoc[] { return [...this.docs.values()]; }
  private fire(doc: ManagedDoc, reason: string) { this.listeners.forEach(l => l(doc, reason)); }
}

const registry = new Registry();

export function currentIr(doc: ManagedDoc): DocumentIR {
  const fmt = formatForPath(doc.uri.fsPath);
  if (fmt) return fmt.codec.parse(doc.textDocument!.getText());
  // Fallback: infer from declared kind (keeps dedicated csv/md providers working)
  return doc.kind === 'table' ? require('../../core/codecs/csv').parseCsv(doc.textDocument!.getText())
                              : require('../../core/codecs/markdown').parseMarkdown(doc.textDocument!.getText());
}

export function writeIrBack(doc: ManagedDoc, ir: DocumentIR): Thenable<boolean> {
  const fmt = formatForPath(doc.uri.fsPath);
  const text = fmt ? fmt.codec.serialize(ir)
                   : (doc.kind === 'table' ? require('../../core/codecs/csv').serializeCsv(ir as any)
                                           : require('../../core/codecs/markdown').serializeMarkdown(ir as any));
  const td = doc.textDocument!;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(td.uri, new vscode.Range(0, 0, td.lineCount, 0), text);
  // KEY: through VS Code edit pipeline -> undo stack + dirty tracking + onDidChange to ALL open views
  return vscode.workspace.applyEdit(edit);
}

export const ops = {
  listDocuments() {
    return [...registry.list().map(d => ({ id: d.id, uri: d.uri.toString(), kind: d.kind, dirty: d.dirty })),
            ...ooxml.list()];
  },
  read(uriOrId: string, range?: { rows?: [number, number] }) {
    const bin = ooxml.get(uriOrId);
    if (bin) {
      const ir = publicIr(bin.ir);
      if (range && isTableDoc(ir)) {
        const [a, b] = range.rows ?? [0, 1000];
        return { ...ir, sheets: ir.sheets.map(s => ({ ...s, rows: s.rows.slice(a, b) })) };
      }
      return ir;
    }
    const doc = registry.get(uriOrId);
    if (!doc) throw new Error(`document not found/open: ${uriOrId}`);
    const ir = publicIr(currentIr(doc));
    if (range && isTableDoc(ir)) {
      const [a, b] = range.rows ?? [0, 1000];
      return { ...ir, sheets: ir.sheets.map(s => ({ ...s, rows: s.rows.slice(a, b) })) };
    }
    return ir;
  },
  search(query: string, regex = false) {
    const out: { docId: string; uri: string; location: string; preview: string }[] = [];
    for (const d of registry.list()) {
      const re = regex ? new RegExp(query, 'g') : null;
      const hit = (loc: string, text: string) => {
        if (re ? re.test(text) : text.includes(query)) out.push({ docId: d.id, uri: d.uri.toString(), location: loc, preview: text.slice(0, 200) });
        if (re) re.lastIndex = 0;
      };
      const ir = currentIr(d);
      if (isTableDoc(ir)) ir.sheets.forEach(s => s.rows.forEach((r: any[], ri: number) => r.forEach((c: any, ci: number) => hit(`${s.name}!${ci}:${ri}`, String(c ?? '')))));
      else if (isTextDoc(ir)) ir.blocks.forEach((b, i) => hit(`block:${i}`, b.text + ' ' + (b.items ?? []).join(' ')));
    }
    return out;
  },
  async applyEdits(uriOrId: string, edits: EditOp[], actor = 'agent') {
    if (!vscode.workspace.getConfiguration('officefiles').get('agent.allowWrite', true))
      throw new Error('writing by agents disabled (officefiles.agent.allowWrite=false)');
    if (ooxml.get(uriOrId)) return ooxml.applyEdits(uriOrId, edits);   // binary office docs (xlsx)
    const doc = registry.get(uriOrId);
    if (!doc) throw new Error(`document not found/open: ${uriOrId}`);
    const ir = structuredClone(currentIr(doc));
    applyOps(ir, edits);                 // validated in core (throws on bad ranges => atomic-ish pre-check)
    const ok = await writeIrBack(doc, ir);
    doc.dirty = !!doc.textDocument?.isDirty;
    registry['fire'](doc, `edit:${actor}`);
    return { applied: ok ? edits.length : 0 };
  },
  async save(uriOrId: string) {
    if (ooxml.get(uriOrId)) return ooxml.save(uriOrId);   // xlsx: rebuild zip + fs.writeFile
    const doc = registry.get(uriOrId);
    if (!doc) throw new Error(`document not found/open: ${uriOrId}`);
    const saved = await doc.textDocument?.save();
    doc.dirty = !saved ? doc.dirty : false;
    return { saved: !!saved };
  },
  register(doc: ManagedDoc) { registry.add(doc); },
  unregister(id: string) { registry.remove(id); },
  onRegistryChange(cb: Listener) { return registry.onChange(cb); },
};

/** Strip internal side-channel fields (__xml, __runs) before sending IR over any agent transport. */
export function publicIr(ir: DocumentIR): DocumentIR {
  const clone = JSON.parse(JSON.stringify(ir, (k, v) => (k === '__xml' || k === '__runs' || k === '__sheetMeta' || k === '__sheetPaths') ? undefined : v));
  return clone;
}

/** Open a file in our custom editor (used by office.open agent tool). */
export async function openDocument(uri: vscode.Uri, viewType?: string) {
  const lower = uri.fsPath.toLowerCase();
  // Binary office formats: host-side zip model, no TextDocument involved.
  if (/\.(xlsx|docx|pdf)$/.test(lower)) {
    await ooxml.open(uri);
    const vt = /\.xlsx$/.test(lower) ? 'officefiles.xlsxViewer' : /\.docx$/.test(lower) ? 'officefiles.docxViewer' : 'officefiles.pdfViewer';
    try { await vscode.commands.executeCommand('vscode.openWith', uri, vt); }
    catch { await vscode.commands.executeCommand('vscode.open', uri); }
    return null;
  }
  const fmt = formatForPath(lower);
  const vt = viewType ?? fmt?.viewType ?? (/\.md|\.markdown$/.test(lower) ? MarkdownEditorProvider.viewType : CsvEditorProvider.viewType);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.commands.executeCommand('vscode.openWith', uri, vt);
  return doc;
}
import { MarkdownEditorProvider } from '../providers/markdownProvider';
import { CsvEditorProvider } from '../providers/csvProvider';
