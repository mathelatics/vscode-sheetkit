// Headless OfficeFiles backend: runs the core codecs directly on files on disk — no IDE required.
// Powers out/mcp-standalone.js (external agents, CI) over the shared protocol + officeTools.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import { DocumentIR, TableDocIR, DocIR, applyOps, isTableDoc, isTextDoc, publicIr, EditOp } from '../../core/ir';
import { parseCsv, serializeCsv } from '../../core/codecs/csv';
import { parseMarkdown, serializeMarkdown } from '../../core/codecs/markdown';
import { parseJson, serializeJson } from '../../core/codecs/json';
import { parseXlsxBytes, serializeXlsxBytes, parseDocxBytes, serializeDocxBytes } from '../../core/codecs/ooxml';
import { parsePptxBytes, parseEpubBytes, listZipEntries } from '../../core/codecs/viewers';
import { capabilityReport } from '../../core/codecs/registry';
import type { OfficeBackend, ReadArgs, SearchArgs, ApplyArgs, TargetArgs } from './officeTools';

type Kind = 'csv' | 'tsv' | 'md' | 'json' | 'xlsx' | 'docx' | 'pptx' | 'epub' | 'pdf' | 'zip';
const TEXT_KINDS: Kind[] = ['csv', 'tsv', 'md', 'json'];
const READ_ONLY: Kind[] = ['pptx', 'epub', 'pdf', 'zip'];
export const SUPPORTED_EXTS = [
  '.csv', '.tsv', '.md', '.markdown', '.json',
  '.xlsx', '.xlsm', '.docx', '.dotx', '.pptx', '.pptm', '.epub', '.pdf', '.zip', '.jar', '.vsix',
];

function toPath(p: string): string { return /^file:\/\//i.test(p) ? fileURLToPath(p) : p; }
function target(a: TargetArgs): string {
  const p = a.path ?? (a.uri ? toPath(a.uri) : '');
  if (!p) throw new Error('missing target: provide `path` or `uri`');
  return p;
}
function kindOf(p: string): Kind {
  const e = path.extname(p).toLowerCase();
  if (e === '.csv') return 'csv';
  if (e === '.tsv') return 'tsv';
  if (e === '.md' || e === '.markdown') return 'md';
  if (e === '.json') return 'json';
  if (e === '.xlsx' || e === '.xlsm') return 'xlsx';
  if (e === '.docx' || e === '.dotx') return 'docx';
  if (e === '.pptx' || e === '.pptm') return 'pptx';
  if (e === '.epub') return 'epub';
  if (e === '.pdf') return 'pdf';
  if (e === '.zip' || e === '.jar' || e === '.vsix') return 'zip';
  throw new Error(`unsupported format: ${e || p}`);
}

// unpdf is optional at runtime (heavy pdf.js build); degrade with a clear message when absent.
let _extractText: ((buf: Uint8Array, opts?: any) => Promise<any>) | undefined;
try { ({ extractText: _extractText } = require('unpdf')); } catch { /* optional */ }

async function pdfDoc(p: string): Promise<DocIR> {
  if (!_extractText) throw new Error('PDF extraction unavailable in this build (unpdf not installed)');
  const r = await _extractText(new Uint8Array(fs.readFileSync(p)), { mergePages: false });
  const pages: string[] = Array.isArray(r?.text) ? r.text : Array.isArray(r?.pages) ? r.pages : [];
  return { kind: 'document', blocks: pages.map((text, i) => ({ type: 'paragraph' as const, text, page: i + 1 } as any)) };
}

/** Load a file to its full IR (internal side-channel fields preserved for lossless writes). */
async function load(p: string): Promise<{ ir: DocumentIR; kind: Kind }> {
  const kind = kindOf(p);
  if (kind === 'csv') return { ir: parseCsv(fs.readFileSync(p, 'utf8')), kind };
  if (kind === 'tsv') return { ir: parseCsv(fs.readFileSync(p, 'utf8'), { delimiter: '\t' }), kind };
  if (kind === 'md') return { ir: parseMarkdown(fs.readFileSync(p, 'utf8')), kind };
  if (kind === 'json') return { ir: parseJson(fs.readFileSync(p, 'utf8')) as unknown as DocumentIR, kind };
  if (kind === 'pdf') return { ir: await pdfDoc(p), kind };
  const zip = await JSZip.loadAsync(fs.readFileSync(p));
  if (kind === 'xlsx') return { ir: await parseXlsxBytes(zip as any), kind };
  if (kind === 'docx') return { ir: await parseDocxBytes(zip as any), kind };
  if (kind === 'pptx') return { ir: await parsePptxBytes(zip as any), kind };
  if (kind === 'epub') return { ir: await parseEpubBytes(zip as any), kind };
  throw new Error(`load unsupported: ${kind}`);
}

/** Serialize an edited IR back to disk (text formats byte-faithfully, xlsx/docx via original package). */
async function store(p: string, ir: DocumentIR, kind: Kind): Promise<void> {
  if (kind === 'csv') { fs.writeFileSync(p, serializeCsv(ir as TableDocIR, {}), 'utf8'); return; }
  if (kind === 'tsv') { fs.writeFileSync(p, serializeCsv(ir as TableDocIR, { delimiter: '\t' }), 'utf8'); return; }
  if (kind === 'md') { fs.writeFileSync(p, serializeMarkdown(ir as DocIR), 'utf8'); return; }
  if (kind === 'json') { fs.writeFileSync(p, serializeJson(ir as TableDocIR), 'utf8'); return; }
  const zip = await JSZip.loadAsync(fs.readFileSync(p));
  let out: Uint8Array;
  if (kind === 'xlsx') out = await serializeXlsxBytes(zip as any, ir as TableDocIR);
  else if (kind === 'docx') out = await serializeDocxBytes(zip as any, ir as DocIR);
  else throw new Error(`${kind} is read-only (no writer)`);
  fs.writeFileSync(p, Buffer.from(out));
}

function slice(ir: DocumentIR, range?: ReadArgs['range']): DocumentIR {
  if (!range) return ir;
  if (range.rows && isTableDoc(ir)) {
    const [a, b] = range.rows;
    return { ...ir, sheets: ir.sheets.map(s => ({ ...s, rows: s.rows.slice(a ?? 0, b ?? s.rows.length) })) };
  }
  if (range.blocks && isTextDoc(ir)) {
    const [a, b] = range.blocks;
    return { ...ir, blocks: ir.blocks.slice(a ?? 0, b ?? ir.blocks.length) };
  }
  return ir;
}

function searchIr(ir: DocumentIR, query: string, regex: boolean, limit: number) {
  const re = regex ? new RegExp(query, 'g') : null;
  const hits: any[] = [];
  const hit = (loc: string, text: string) => {
    if (hits.length >= limit) return;
    if (re ? re.test(text) : text.toLowerCase().includes(query.toLowerCase())) {
      hits.push({ location: loc, preview: text.slice(0, 200) });
    }
    if (re) re.lastIndex = 0;
  };
  if (isTableDoc(ir)) {
    ir.sheets.forEach(s => s.rows.forEach((r, ri) => r.forEach((c, ci) => hit(`${s.name}!${ci}:${ri}`, String(c ?? '')))));
  } else if (isTextDoc(ir)) {
    ir.blocks.forEach((b, i) => hit(`block:${i}`, b.text + ' ' + (b.items ?? []).join(' ')));
  }
  return hits;
}

export function createHeadlessBackend(): OfficeBackend {
  return {
    async capabilities() {
      return { mode: 'headless', ...capabilityReport() };
    },

    async list(args) {
      const dir = args.dir ?? process.cwd();
      const limit = args.limit ?? 200;
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isFile() && SUPPORTED_EXTS.includes(path.extname(d.name).toLowerCase()))
        .slice(0, limit)
        .map(d => ({ name: d.name, path: path.join(dir, d.name), kind: kindOf(d.name) }));
      return { dir, count: entries.length, entries };
    },

    async read(args) {
      const p = target(args);
      const kind = kindOf(p);
      if (kind === 'zip') return { path: p, kind, entries: listZipEntries(new Uint8Array(fs.readFileSync(p))) };
      const { ir } = await load(p);
      return publicIr(slice(ir, args.range));
    },

    async search(args) {
      const p = target(args);
      const limit = args.limit ?? 100;
      const kind = kindOf(p);
      if (kind === 'zip') throw new Error('zip archives are not searchable; use office_read to list entries');
      const { ir } = await load(p);
      const hits = searchIr(publicIr(ir), args.query, !!args.regex, limit);
      return { path: p, total: hits.length, hits };
    },

    async applyEdits(args) {
      const p = target(args);
      const kind = kindOf(p);
      if (READ_ONLY.includes(kind)) throw new Error(`${kind} is read-only; no writer`);
      const { ir } = await load(p);
      const edits: EditOp[] = args.edits ?? [];
      const next = structuredClone(ir);
      applyOps(next, edits);
      if (edits.some(e => e.op === 'replaceSheet') && (next as any).meta?.__sheetMeta) (next as any).meta.__sheetMeta = {};
      if (args.dryRun) return { path: p, dryRun: true, applied: edits.length, appliedOps: edits.map(e => e.op) };
      await store(p, next, kind);
      return { path: p, applied: edits.length, saved: true };
    },

    async save(args) {
      const p = target(args);
      const kind = kindOf(p);
      if (READ_ONLY.includes(kind)) throw new Error(`${kind} is read-only; nothing to save`);
      const { ir } = await load(p);
      await store(p, ir, kind);
      return { path: p, saved: true };
    },

    async extractPdfText(args) {
      const p = target(args);
      if (kindOf(p) !== 'pdf') throw new Error('office_extract_pdf_text expects a .pdf file');
      const doc = await pdfDoc(p);
      return { path: p, total: doc.blocks.length, pages: doc.blocks.map((b: any, i: number) => ({ page: b.page ?? i + 1, text: b.text })) };
    },
  };
}
