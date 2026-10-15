// DocumentOps: the single capability registry used by webview bus, commands, LM tools and MCP server.
// Deviation from vscode-office: all logic lives here (testable, no Handler closures), providers are thin.
import * as vscode from 'vscode';
import { DocumentIR, EditOp, applyOps, isTableDoc, isTextDoc } from '../../core/ir';
import { parseCsv, serializeCsv } from '../../core/codecs/csv';
import { parseMarkdown, serializeMarkdown } from '../../core/codecs/markdown';

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
  if (doc.kind === 'table') return parseCsv(doc.textDocument!.getText());
  return parseMarkdown(doc.textDocument!.getText());
}

export function writeIrBack(doc: ManagedDoc, ir: DocumentIR): Thenable<boolean> {
  const text = doc.kind === 'table' ? serializeCsv(ir as any) : serializeMarkdown(ir as any);
  const td = doc.textDocument!;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(td.uri, new vscode.Range(0, 0, td.lineCount, 0), text);
  // KEY: through VS Code edit pipeline -> undo stack + dirty tracking + onDidChange to ALL open views
  return vscode.workspace.applyEdit(edit);
}

export const ops = {
  listDocuments() {
    return registry.list().map(d => ({ id: d.id, uri: d.uri.toString(), kind: d.kind, dirty: d.dirty }));
  },
  read(uriOrId: string, range?: { rows?: [number, number] }) {
    const doc = registry.get(uriOrId);
    if (!doc) throw new Error(`document not found/open: ${uriOrId}`);
    const ir = currentIr(doc);
    if (range && isTableDoc(ir)) {
      const [a, b] = range.rows ?? [0, 1000];
      return { ...ir, sheets: ir.sheets.map(s => ({ ...s, rows: s.rows.slice(a, b) })) };
    }
    return ir;
  },
  search(query: string, regex = false) {
    const out: { docId: string; location: string; preview: string }[] = [];
    for (const d of registry.list()) {
      const re = regex ? new RegExp(query, 'g') : null;
      const hit = (loc: string, text: string) => {
        if (re ? re.test(text) : text.includes(query)) out.push({ docId: d.id, location: loc, preview: text.slice(0, 200) });
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

/** Open a file in our custom editor (used by office.open agent tool). */
export async function openDocument(uri: vscode.Uri, viewType: string) {
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
  return doc;
}
