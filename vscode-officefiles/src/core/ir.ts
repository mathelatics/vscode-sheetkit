// OfficeFiles core: format-agnostic Intermediate Representation + typed edit operations.
// NO vscode imports here — reusable by extension host, webview, headless CLI and MCP server.

/** A cell value in our IR (kept JSON-serializable for agent transport). */
export type CellValue = string | number | boolean | null;

export interface SheetIR {
  name: string;
  /** row-major values; ragged rows allowed */
  rows: CellValue[][];
  /** binary codecs (xlsx) attach side-channel metadata here: per-cell style/formula maps.
   *  Stripped by publicIr() before agent transport — mirrors DocIR's __xml block spans. */
  meta?: Record<string, any>;
}

export interface TableDocIR {
  kind: 'table';
  sheets: SheetIR[];
  /** codec metadata (delimiter, eol) — lets CSV round-trip byte-faithfully */
  meta?: Record<string, any>;
}

export interface BlockIR {
  /** paragraph | heading | list | code | quote | image | table */
  type: 'paragraph' | 'heading' | 'list' | 'code' | 'quote' | 'image' | 'table';
  level?: number;          // heading depth
  text: string;            // raw markdown-ish inline content
  lang?: string;           // code fence language
  items?: string[];        // list items
  ordered?: boolean;       // list: numbered vs bulleted
  bullet?: string;         // original bullet marker ('-' | '*' | '+') for lossless round-trip
}

export interface DocIR {
  kind: 'document';
  blocks: BlockIR[];
}

export type DocumentIR = TableDocIR | DocIR;

/** Typed, minimal, agent-friendly edit operations. Batch = atomic from caller view. */
export type EditOp =
  | { op: 'setCell'; sheet?: string; row: number; col: number; value: CellValue }
  | { op: 'insertRow'; sheet?: string; row: number; values?: CellValue[] }
  | { op: 'deleteRow'; sheet?: string; row: number }
  | { op: 'insertColumn'; sheet?: string; col: number; header?: string; values?: CellValue[] }
  | { op: 'appendBlock'; block: BlockIR }
  | { op: 'insertBlock'; after?: number; block: BlockIR }   // insert at end if `after` omitted
  | { op: 'replaceBlock'; index: number; block: BlockIR }
  | { op: 'deleteBlock'; index: number }
  | { op: 'replaceText'; search: string; replacement: string; regex?: boolean; all?: boolean };

export function isTableDoc(ir: DocumentIR): ir is TableDocIR { return ir.kind === 'table'; }
export function isTextDoc(ir: DocumentIR): ir is DocIR { return ir.kind === 'document'; }

/** Apply ops to an IR in-place (clone first if immutability needed). Throws on invalid ranges. */
export function applyOps(ir: DocumentIR, ops: EditOp[]): DocumentIR {
  for (const o of ops) {
    if (isTableDoc(ir)) applyTableOp(ir, o);
    else applyDocOp(ir, o);
  }
  return ir;
}

function findSheet(doc: TableDocIR, o: EditOp): SheetIR {
  const name = (o as any).sheet as string | undefined;
  const s = doc.sheets.find(s => s.name === name) ?? doc.sheets[0];
  if (!s) throw new Error('no sheet');
  return s;
}

function applyTableOp(doc: TableDocIR, o: EditOp) {
  switch (o.op) {
    case 'setCell': {
      const s = findSheet(doc, o);
      while (s.rows.length <= o.row) s.rows.push([]);
      const row = s.rows[o.row];
      while (row.length <= o.col) row.push(null);
      row[o.col] = o.value;
      break;
    }
    case 'insertRow': {
      const s = findSheet(doc, o);
      s.rows.splice(o.row, 0, o.values ? [...o.values] : []);
      break;
    }
    case 'deleteRow': {
      const s = findSheet(doc, o);
      if (o.row < 0 || o.row >= s.rows.length) throw new Error(`row ${o.row} out of range`);
      s.rows.splice(o.row, 1);
      break;
    }
    case 'insertColumn': {
      const s = findSheet(doc, o);
      s.rows.forEach((r, i) => r.splice(o.col, 0, i === 0 && o.header ? o.header : (o.values?.[i] ?? null)));
      break;
    }
    case 'replaceText': {
      const re = o.regex ? new RegExp(o.search, o.all !== false ? 'g' : '') : null;
      doc.sheets.forEach(s => s.rows.forEach(r => r.forEach((v, i) => {
        if (typeof v === 'string') r[i] = re ? v.replace(re, o.replacement) : v.split(o.search).join(o.replacement);
      })));
      break;
    }
    default: break; // doc-only ops ignored on tables
  }
}

function applyDocOp(doc: DocIR, o: EditOp) {
  switch (o.op) {
    case 'appendBlock': doc.blocks.push(o.block); break;
    case 'insertBlock': {
      const at = o.after === undefined ? doc.blocks.length : Math.max(0, Math.min(o.after + 1, doc.blocks.length));
      doc.blocks.splice(at, 0, o.block); break;
    }
    case 'replaceBlock':
      if (o.index < 0 || o.index >= doc.blocks.length) throw new Error(`block ${o.index} out of range`);
      doc.blocks[o.index] = o.block; break;
    case 'deleteBlock':
      if (o.index < 0 || o.index >= doc.blocks.length) throw new Error(`block ${o.index} out of range`);
      { // tombstone so binary writers (docx) can strip the source paragraph on save
        const [removed] = doc.blocks.splice(o.index, 1);
        (removed as any).__deleted = true;
        (doc as any).__tombstones = ((doc as any).__tombstones ?? []);
        (doc as any).__tombstones.push(removed);
      }
      break;
    case 'replaceText': {
      const re = o.regex ? new RegExp(o.search, o.all !== false ? 'g' : '') : null;
      doc.blocks.forEach(b => {
        b.text = re ? b.text.replace(re, o.replacement) : b.text.split(o.search).join(o.replacement);
        b.items = b.items?.map(it => re ? it.replace(re, o.replacement) : it.split(o.search).join(o.replacement));
      });
      break;
    }
    default: break; // table-only ops ignored on docs
  }
}
