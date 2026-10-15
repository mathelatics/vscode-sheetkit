// OOXML codecs (.xlsx / .docx) using JSZip — runs in the extension host (Node).
// Strategy mirrors our IR philosophy: parse to a lossless-enough structure, edit via typed ops,
// re-serialize. For xlsx we rebuild sheet XML from cell values (shared strings rebuilt inline),
// preserving all other package parts byte-for-byte (styles, rels, media) — like vscode-office's
// exceljs approach but with our own minimal writer so agents can edit real spreadsheets.
import { CellValue, DocIR, SheetIR, TableDocIR, BlockIR } from '../ir';

/** Minimal ZIP reader/writer interface — jszip is injected to keep this file dependency-free/testable. */
export interface ZipLike {
  files: Record<string, { async(name: 'string'): Promise<ArrayBuffer>; name?: string } & { type?: string; data?: any }>;
  file(path: string): { async(type: 'string'): Promise<any> } | undefined;
  generateAsync(opts: { type: 'uint8array' }): Promise<Uint8Array>;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function colToIndex(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function indexToCol(i: number): string {
  let s = ''; i++;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

/** Parse worksheet XML + sharedStrings into rows. */
export function parseSheetXml(xml: string, shared: string[]): CellValue[][] {
  const rows: CellValue[][] = [];
  const rowRe = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const rowNum = parseInt(rm[1], 10);
    while (rows.length < rowNum - 1) rows.push([]);
    const cells: CellValue[] = [];
    const cellRe = /<c([^>]*)>(?:<v>([\s\S]*?)<\/v>)?(?:<\/c>)?|<c([^>]*)\/>/g;
    const inner = rm[2];
    const cRe = /<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cRe.exec(inner))) {
      const attrs = cm[1];
      const body = cm[2] ?? '';
      const refM = /r="([A-Z]+\d+)"/.exec(attrs);
      const tM = /t="(\w+)"/.exec(attrs);
      const idx = refM ? colToIndex(refM[1]) : cells.length;
      const vM = /<v>([\s\S]*?)<\/v>/.exec(body);
      let val: CellValue = null;
      if (vM) {
        const raw = unesc(vM[1]);
        const t = tM?.[1];
        if (t === 's') val = shared[parseInt(raw, 10)] ?? '';
        else if (t === 'b') val = raw === '1';
        else if (t === 'str' || t === 'inlineStr') val = raw;
        else val = isNaN(Number(raw)) ? raw : Number(raw);
      } else {
        const isM = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(body);
        if (isM) val = unesc(isM[1]);
      }
      while (cells.length < idx) cells.push(null);
      cells[idx] = val;
    }
    rows[rowNum - 1] = cells;
  }
  return rows;
}

export function buildSheetXml(rows: CellValue[][]): string {
  const parts: string[] = [];
  rows.forEach((row, ri) => {
    const cs: string[] = [];
    row.forEach((v, ci) => {
      if (v === null || v === undefined || v === '') return;
      const ref = `${indexToCol(ci)}${ri + 1}`;
      if (typeof v === 'number' && isFinite(v)) cs.push(`<c r="${ref}"><v>${v}</v></c>`);
      else if (typeof v === 'boolean') cs.push(`<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`);
      else cs.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`);
    });
    parts.push(`<row r="${ri + 1}">${cs.join('')}</row>`);
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${parts.join('')}</sheetData></worksheet>`;
}

const WORKBOOK_SHEET_RE = /<sheet [^>]*name="([^"]*)"[^>]*r:id="(rId\d+)"/g;
const RELS_RE = /<Relationship Id="(rId\d+)"[^>]*Target="([^"]*sheet[^"]*\.xml)"/g;

/** Decode Uint8Array zip content to string without Buffer (webview-safe). */
async function partText(zip: ZipLike, path: string): Promise<string | null> {
  const f = zip.file(path.startsWith('/') ? path.slice(1) : path);
  if (!f) return null;
  const buf = await f.async('string');
  return typeof buf === 'string' ? buf : null;
}

export async function parseXlsxBytes(zip: ZipLike): Promise<TableDocIR> {
  const wbXml = await partText(zip, 'xl/workbook.xml');
  if (!wbXml) throw new Error('Not an xlsx: missing xl/workbook.xml');
  const relsXml = (await partText(zip, 'xl/_rels/workbook.xml.rels')) ?? '';
  const ssXml = await partText(zip, 'xl/sharedStrings.xml');
  const shared: string[] = [];
  if (ssXml) {
    const siRe = /<si>(?:<t[^>]*>([\s\S]*?)<\/t>|([\s\S]*?))<\/si>/g;
    let m: RegExpExecArray | null;
    while ((m = siRe.exec(ssXml))) shared.push(unesc(m[1] ?? ''));
  }
  const relMap: Record<string, string> = {};
  for (const m of relsXml.matchAll(RELS_RE)) relMap[m[1]] = 'xl/' + m[2].replace(/^\/?xl\//, '').replace(/^\//, '');
  const sheets: SheetIR[] = [];
  const sheetMeta: Record<string, CellMeta> = {};   // keyed by sheet name (attached to IR.meta below)
  const sheetPaths: Record<string, string> = {};    // sheet name -> zip part path (for writer)
  for (const m of wbXml.matchAll(WORKBOOK_SHEET_RE)) {
    const target = relMap[m[2]];
    if (!target) continue;
    const xml = await partText(zip, target);
    if (!xml) continue;
    const name = unesc(m[1]);
    const rich = parseSheetXmlRich(xml, shared);
    sheets.push({ name, rows: rich.rows });
    sheetMeta[name] = rich.meta as any;
    sheetPaths[name] = target.startsWith('xl/') ? target : 'xl/' + target;
  }
  return { kind: 'table', sheets, meta: { format: 'xlsx', __sheetMeta: sheetMeta, __sheetPaths: sheetPaths } };
}

export async function serializeXlsxBytes(zip: ZipLike, doc: TableDocIR): Promise<Uint8Array> {
  // Rich path: when parse-time metadata is attached (__sheetMeta/__sheetPaths), rewrite each
  // worksheet preserving styles + untouched formulas. Falls back to the plain rebuild otherwise.
  const sheetMeta = (doc.meta as any)?.__sheetMeta as Record<string, CellMeta> | undefined;
  const sheetPaths = (doc.meta as any)?.__sheetPaths as Record<string, string> | undefined;
  if (sheetMeta && sheetPaths) {
    for (const s of doc.sheets) {
      const path = sheetPaths[s.name];
      if (!path) continue;
      // @ts-ignore jszip file() setter
      zip.file(path, serializeSheetXmlRich(s, sheetMeta[s.name]));
    }
    return zip.generateAsync({ type: 'uint8array' });
  }
  // Replace each worksheet XML with our rebuilt content; drop sharedStrings (we write inlineStr).
  const relsXml = (await partText(zip, 'xl/_rels/workbook.xml.rels')) ?? '';
  const wbXml = (await partText(zip, 'xl/workbook.xml')) ?? '';
  const relMap2: Record<string, string> = {};
  for (const m of relsXml.matchAll(RELS_RE)) relMap2[m[1]] = m[2].replace(/^\//, '');
  let i = 0;
  for (const m of wbXml.matchAll(WORKBOOK_SHEET_RE)) {
    const sheet = doc.sheets[i++];
    const target = relMap2[m[2]];
    if (!sheet || !target) continue;
    const path = target.startsWith('xl/') ? target : 'xl/' + target;
    const xml = buildSheetXml(sheet.rows);
    // @ts-ignore jszip file() setter
    zip.file(path, xml);
  }
  if (zip.file('xl/sharedStrings.xml')) {
    // @ts-ignore
    zip.remove('xl/sharedStrings.xml');
    const fixed = relsXml.replace(/<Relationship[^>]*sharedStrings\.xml"[^>]*\/>/g, '');
    // @ts-ignore
    zip.file('xl/_rels/workbook.xml.rels', fixed);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

// ---- XLSX formula + style preservation -----------------------------------------------------
// Deviation from the earlier values-only rebuild: we now keep per-cell metadata captured at
// parse time ({ s } style index, <f> formula) and re-emit it on serialize when the value was
// not touched. Editing a cell drops its stale formula but keeps its style — Excel-safe behavior.

export interface CellMeta { s?: number; formula?: string; t?: string }

/** Extract per-cell metadata (style index, formulas, raw type) keyed "r"->meta for one sheet XML. */
export function parseSheetMeta(xml: string): Record<string, CellMeta> {
  const meta: Record<string, CellMeta> = {};
  const cRe = /<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;
  while ((m = cRe.exec(xml))) {
    const attrs = m[1];
    const body = m[2] ?? '';
    const refM = /r="([A-Z]+\d+)"/.exec(attrs);
    if (!refM) continue;
    const entry: CellMeta = {};
    const sM = /\ss="(\d+)"/.exec(attrs);
    if (sM) entry.s = parseInt(sM[1], 10);
    const tM = /\st="(\w+)"/.exec(attrs);
    if (tM) entry.t = tM[1];
    const fM = /<f[^>]*>([\s\S]*?)<\/f>|<f[^>]*\/>/.exec(body);
    if (fM) entry.formula = fM[1] !== undefined ? unesc(fM[1]) : '';
    meta[refM[1]] = entry;
  }
  return meta;
}

const colRef = (ci: number, ri: number) => `${indexToCol(ci)}${ri + 1}`;

/** Build worksheet XML preserving styles/formulas from `meta` where cells are unchanged. */
export function buildSheetXmlRich(rows: CellValue[][], meta?: Record<string, CellMeta>): string {
  const parts: string[] = [];
  rows.forEach((row, ri) => {
    const cs: string[] = [];
    row.forEach((v, ci) => {
      const ref = colRef(ci, ri);
      const old = meta?.[ref];
      const sAttr = old?.s !== undefined ? ` s="${old.s}"` : '';
      // Unchanged non-empty cell with a stored formula -> re-emit formula + cached value + style.
      if (old?.formula !== undefined && v !== null && v !== undefined && v !== '') {
        const cached = typeof v === 'number' ? `<v>${v}</v>` : (typeof v === 'boolean' ? `<v>${v ? 1 : 0}</v>` : '');
        cs.push(`<c r="${ref}"${sAttr}><f>${esc(old.formula)}</f>${cached}</c>`);
        return;
      }
      if (v === null || v === undefined || v === '') {
        // Preserve pure formatting of empty cells (Excel shows styled blanks).
        if (old?.s !== undefined) cs.push(`<c r="${ref}" s="${old.s}"/>`);
        return;
      }
      if (typeof v === 'number' && isFinite(v)) cs.push(`<c r="${ref}"${sAttr}><v>${v}</v></c>`);
      else if (typeof v === 'boolean') cs.push(`<c r="${ref}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`);
      else cs.push(`<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`);
    });
    parts.push(`<row r="${ri + 1}">${cs.join('')}</row>`);
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${parts.join('')}</sheetData></worksheet>`;
}

/** Parse worksheet XML into rows WITH formula values preserved as "=expr" strings + side metadata. */
export function parseSheetXmlRich(xml: string, shared: string[]): { rows: CellValue[][]; meta: Record<string, CellMeta> } {
  const rows = parseSheetXml(xml, shared);
  const meta = parseSheetMeta(xml);
  // Overlay formulas: replace displayed value with "=formula" so agents can read/edit them.
  for (const [ref, mm] of Object.entries(meta)) {
    if (mm.formula === undefined) continue;
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    const ri = parseInt(m[2], 10) - 1, ci = colToIndex(m[1]);
    while (rows.length <= ri) rows.push([]);
    while (rows[ri].length <= ci) rows[ri].push(null);
    rows[ri][ci] = '=' + mm.formula;
  }
  return { rows, meta };
}

/** Serialize rows back using captured metadata (styles + untouched formulas). */
export function serializeSheetXmlRich(sheet: { rows: CellValue[][] }, meta?: Record<string, CellMeta>): string {
  // Cells whose value still equals their stored formula string get emitted as <f>; edited ones lose it.
  const out: Record<string, CellMeta> = { ...(meta ?? {}) };
  sheet.rows.forEach((row, ri) => row.forEach((v, ci) => {
    const ref = colRef(ci, ri);
    const old = out[ref];
    if (!old) return;
    if (old.formula !== undefined && v !== '=' + old.formula) delete old.formula; // edited -> drop stale formula
  }));
  // Values that ARE formulas become real <f> elements again.
  sheet.rows.forEach((row, ri) => row.forEach((v, ci) => {
    if (typeof v === 'string' && v.startsWith('=')) {
      const ref = colRef(ci, ri);
      out[ref] = { ...(out[ref] ?? {}), formula: v.slice(1) };
    }
  }));
  const cleanRows = sheet.rows.map(r => r.map(v => (typeof v === 'string' && v.startsWith('=') ? null : v)));
  return buildSheetXmlRich(cleanRows, out);
}

/** DOCX: paragraph-level extraction with run preservation.
 *  Each block gets `__xml` (full <w:p> span) + `__runs` (per-run text/format snapshot) attached,
 *  so serializeDocxBytes can rewrite ONLY the text runs while keeping pPr (styles/numbering),
 *  rPr (bold/italic/font/color per run) and everything else in document.xml byte-for-byte. */
export async function parseDocxBytes(zip: ZipLike): Promise<DocIR> {
  const docXml = await partText(zip, 'word/document.xml');
  if (!docXml) throw new Error('Not a docx: missing word/document.xml');
  const blocks: BlockIR[] = [];
  const pRe = /<w:p\b(?:[^>]*)\/>|<w:p\b[\s\S]*?<\/w:p>/g;
  for (const pm of docXml.matchAll(pRe)) {
    const texts = [...pm[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => unesc(m[1])).join('');
    const isHeading = /pStyle w:val="Heading/i.test(pm[0]) || (/<w:b\/?>/.test(pm[0]) && texts.length > 0 && texts === texts.toUpperCase());
    if (texts.trim() === '') continue;
    let block: BlockIR;
    if (isHeading) {
      const lvlM = /Heading(\d+)/i.exec(pm[0]);
      block = { type: 'heading', level: lvlM ? parseInt(lvlM[1], 10) : 1, text: texts };
    } else block = { type: 'paragraph', text: texts };
    // side-channel metadata (stripped before agent transport; used by the writer)
    (block as any).__xml = pm[0];
    (block as any).__runs = [...pm[0].matchAll(/<w:r\b[\s\S]*?(?:<\/w:r>|\/>)/g)].map(r => r[0]).length || 1;
    blocks.push(block);
  }
  return { kind: 'document', blocks };
}

/** Build a single text run preserving nothing but xml:space (used when run count changes). */
function mkRun(text: string): string {
  return `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

/** Redistribute new paragraph text across the ORIGINAL runs, keeping each run's rPr formatting.
 *  Proportional split by original run lengths keeps bold-lead-in ("**Note:**) styles intact. */
export function rewriteDocxParagraph(origParaXml: string, newText: string): string {
  const runRe = /<w:r\b(?:[^>]*)?>([\s\S]*?)<\/w:r>/g;
  const runs = [...origParaXml.matchAll(runRe)];
  const textRuns = runs.filter(r => /<w:t/.test(r[0]));
  if (textRuns.length === 0) {
    // No text runs at all (e.g. pure field/image paragraph) — append one.
    return origParaXml.replace(/<\/w:p>$/, mkRun(newText) + '</w:p>');
  }
  if (textRuns.length === 1) {
    const replaced = textRuns[0][0].replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/, (_all, _t) => `<w:t xml:space="preserve">${esc(newText)}</w:t>`);
    return origParaXml.slice(0, textRuns[0].index!) + replaced + origParaXml.slice(textRuns[0].index! + textRuns[0][0].length);
  }
  // Multiple text runs: proportional split by original visible-text length.
  const lens = textRuns.map(r => unesc((/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/.exec(r[0]) ?? [, ''])[1]!).length);
  const total = Math.max(1, lens.reduce((a, b) => a + b, 0));
  let pos = 0;
  let out = origParaXml;
  // Rebuild from last run to first so earlier indices stay valid.
  for (let i = textRuns.length - 1; i >= 0; i--) {
    const share = i === textRuns.length - 1 ? newText.length - pos : Math.round(lens[i] / total * newText.length);
    const chunk = newText.slice(pos, pos + Math.max(0, share));
    pos += Math.max(0, share);
    const m = textRuns[i];
    const replaced = m[0].replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/, () => `<w:t xml:space="preserve">${esc(chunk)}</w:t>`);
    out = out.slice(0, m.index!) + replaced + out.slice(m.index! + m[0].length);
  }
  return out;
}

/** Serialize an edited DocIR back into the ORIGINAL package bytes, rewriting only touched paragraphs. */
export async function serializeDocxBytes(zip: ZipLike, doc: DocIR): Promise<Uint8Array> {
  const docXml = await partText(zip, 'word/document.xml');
  if (!docXml) throw new Error('Not a docx: missing word/document.xml');
  const paras = [...docXml.matchAll(/<w:p\b(?:[^>]*)?>(?:[\s\S]*?)<\/w:p>|<w:p\b[^>]*\/>/g)];
  // Map IR blocks (non-empty ones) back to their source paragraph spans via __xml identity.
  let next = docXml;
  const touched = new Map<string, string>(); // origXml -> newXml
  for (const b of doc.blocks) {
    const orig = (b as any).__xml as string | undefined;
    if (!orig) continue;
    const curText = [...orig.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => unesc(m[1])).join('');
    if (curText === b.text) continue;                       // unchanged
    touched.set(orig, rewriteDocxParagraph(orig, b.text));  // changed -> preserve runs/styles
  }
  // Replace longest-first to avoid substring collisions between similar short paragraphs.
  for (const [orig, rep] of [...touched.entries()].sort((a, c) => c[0].length - a[0].length)) {
    const idx = next.indexOf(orig);
    if (idx >= 0) next = next.slice(0, idx) + rep + next.slice(idx + orig.length);
  }
  // @ts-ignore jszip file() setter
  zip.file('word/document.xml', next);
  void paras;
  return zip.generateAsync({ type: 'uint8array' });
}
