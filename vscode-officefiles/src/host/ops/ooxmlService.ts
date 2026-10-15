// OOXML host service: read/write .xlsx and .docx via JSZip in the extension host.
import * as vscode from 'vscode';
import JSZip from 'jszip';
import { DocumentIR, EditOp, TableDocIR, DocIR, applyOps, isTableDoc, isTextDoc } from '../../core/ir';
import { parseXlsxBytes, serializeXlsxBytes, parseDocxBytes, serializeDocxBytes } from '../../core/codecs/ooxml';
import { parsePptxBytes, parseEpubBytes } from '../../core/codecs/viewers';

/** Minimal structural HTML renderers for the read-only webview previews (no styling deps). */
export function sheetToHtml(ir: DocumentIR): string {
  if (!isTableDoc(ir)) return '<p>not a table</p>';
  return ir.sheets.map(s => `<h3>${esc(s.name)}</h3><table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-family:var(--vscode-font-family)">${s.rows.slice(0, 500).map((r, i) => `<tr>${(r as any[]).map(c => i === 0 ? `<th>${esc(String(c ?? ''))}</th>` : `<td>${esc(String(c ?? ''))}</td>`).join('')}</tr>`).join('')}</table>`).join('<hr>');
}
export function docToHtml(ir: DocumentIR): string {
  if (!isTextDoc(ir)) return '<p>not a document</p>';
  return `<div style="font-family:var(--vscode-font-family);line-height:1.6">${ir.blocks.map(b => b.type === 'heading' ? `<h${Math.min(b.level ?? 1, 6)}>${esc(b.text)}</h${Math.min(b.level ?? 1, 6)}>` : b.type === 'list' ? `<ul>${(b.items ?? []).map(it => `<li>${esc(it)}</li>`).join('')}</ul>` : `<p>${esc(b.text)}</p>`).join('')}</div>`;
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Read-only preview provider for xlsx/docx/pptx/epub (grid/paragraph view of parsed IR). */
export class OoxmlPreviewProvider implements vscode.CustomReadonlyEditorProvider {
  constructor(private context: vscode.ExtensionContext, private kind: 'xlsx' | 'docx' | 'pptx' | 'epub') {}
  async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
    const d = await ooxml.open(uri);
    return { uri, dispose: () => ooxml.close(d.id) };
  }
  async resolveCustomEditor(doc: vscode.CustomDocument, panel: vscode.WebviewPanel) {
    panel.webview.options = { enableScripts: false };
    const d = ooxml.get(doc.uri.toString());
    const body = this.kind === 'xlsx' ? sheetToHtml(d?.ir ?? { kind: 'table', sheets: [] } as any) : docToHtml(d?.ir ?? { kind: 'document', blocks: [] } as any);
    panel.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{padding:12px;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background)}th{background:var(--vscode-editor-selectionBackground,#333)}</style></head><body>${body}</body></html>`;
  }
}

// PDF text extraction for agents: unpdf (server-safe pdf.js build) runs in the extension host.
// Falls back gracefully when the package is unavailable (keeps esbuild/tests dependency-light).
let _extractText: ((buf: Uint8Array, opts?: any) => Promise<{ totalPages: number; pages: string[] }>) | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ extractText: _extractText } = require('unpdf'));
} catch { /* optional at runtime */ }

export async function extractPdfText(bytes: Uint8Array): Promise<{ pages: string[]; text: string }> {
  if (!_extractText) throw new Error('PDF text extraction unavailable (unpdf not installed)');
  const r = await _extractText(bytes as any, { mergePages: false });
  const pages = r.pages ?? [];
  return { pages, text: pages.join('\n\n') };
}

interface BinDoc {
  id: string;
  uri: vscode.Uri;
  format: 'xlsx' | 'docx' | 'pdf' | 'pptx' | 'epub';
  ir: DocumentIR;
  zip: JSZip;               // full package kept in memory => other parts preserved on save
  dirty: boolean;
}

const seq = { n: 0 };
const binDocs = new Map<string, BinDoc>();

export const ooxml = {
  async open(uri: vscode.Uri): Promise<BinDoc> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const lower = uri.fsPath.toLowerCase();
    // PDFs: text-extraction model only (agent-readable, not editable). No zip involved.
    if (lower.endsWith('.pdf')) {
      let pages: string[] = [];
      try { pages = (await extractPdfText(bytes)).pages; } catch { /* image-only/encrypted pdf */ }
      const ir: DocIR = { kind: 'document', blocks: pages.map((p, i) => ({ type: 'paragraph' as const, text: p, page: i + 1 } as any)) };
      const doc: BinDoc = { id: `bin-${++seq.n}`, uri, format: 'pdf', ir, zip: null as any, dirty: false };
      binDocs.set(doc.id, doc);
      return doc;
    }
    const zip = await JSZip.loadAsync(bytes);
    let ir: DocumentIR;
    let format: 'xlsx' | 'docx' | 'pptx' | 'epub';
    if (lower.endsWith('.xlsx')) { ir = await parseXlsxBytes(zip as any); format = 'xlsx'; }
    else if (lower.endsWith('.docx')) { ir = await parseDocxBytes(zip as any); format = 'docx'; }
    else if (lower.endsWith('.pptx')) { ir = await parsePptxBytes(zip as any); format = 'pptx'; }
    else if (lower.endsWith('.epub')) { ir = await parseEpubBytes(zip as any); format = 'epub'; }
    else throw new Error(`unsupported office binary: ${uri.fsPath}`);
    const doc: BinDoc = { id: `bin-${++seq.n}`, uri, format, ir, zip, dirty: false };
    binDocs.set(doc.id, doc);
    return doc;
  },
  get(idOrUri: string): BinDoc | undefined {
    if (binDocs.has(idOrUri)) return binDocs.get(idOrUri)!;
    const u = vscode.Uri.parse(idOrUri).toString();
    return [...binDocs.values()].find(d => d.uri.toString() === u);
  },
  list() {
    return [...binDocs.values()].map(d => ({ id: d.id, uri: d.uri.toString(), kind: d.format, dirty: d.dirty }));
  },
  /** Full docs (internal use only — search/ops; never expose zip bytes over agent transport). */
  all(): BinDoc[] {
    return [...binDocs.values()];
  },
  read(idOrUri: string): DocumentIR {
    const d = this.get(idOrUri);
    if (!d) throw new Error(`office document not open: ${idOrUri}`);
    return d.ir;
  },
  async applyEdits(idOrUri: string, edits: EditOp[]): Promise<{ applied: number }> {
    const d = this.get(idOrUri);
    if (!d) throw new Error(`office document not open: ${idOrUri}`);
    if (d.format === 'pdf') throw new Error('pdf is read-only (text extraction for agents; no writer)');
    if (d.format === 'pptx' || d.format === 'epub') throw new Error(`${d.format} is preview-only: agent-readable IR, but no writer yet`);
    const ir = structuredClone(d.ir);
    applyOps(ir, edits);
    d.ir = ir;
    d.dirty = true;
    return { applied: edits.length };
  },
  async save(idOrUri: string): Promise<{ saved: boolean }> {
    const d = this.get(idOrUri);
    if (!d) throw new Error(`office document not open: ${idOrUri}`);
    if (d.format === 'xlsx') {
      const bytes = await serializeXlsxBytes(d.zip as any, d.ir as TableDocIR);
      await vscode.workspace.fs.writeFile(d.uri, bytes);
      d.dirty = false;
      return { saved: true };
    }
    if (d.format === 'docx') {
      // Re-open pristine zip from disk so repeated saves don't accumulate rewritten parts.
      const fresh = await JSZip.loadAsync(await vscode.workspace.fs.readFile(d.uri));
      const bytes = await serializeDocxBytes(fresh as any, d.ir as DocIR);
      await vscode.workspace.fs.writeFile(d.uri, bytes);
      d.zip = await JSZip.loadAsync(bytes);   // re-anchor __xml spans to the new baseline
      const reIr = await parseDocxBytes(d.zip as any);
      d.ir = reIr;
      d.dirty = false;
      return { saved: true };
    }
    throw new Error(`no writer for ${d.format} yet`);
  },
  close(idOrUri: string) {
    const d = this.get(idOrUri);
    if (d) binDocs.delete(d.id);
  },
};
