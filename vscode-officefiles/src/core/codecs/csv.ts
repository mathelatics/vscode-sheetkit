// CSV/TSV codec: text <-> TableDocIR. RFC-4180 quoting, delimiter auto-detect. No deps.
import { CellValue, SheetIR, TableDocIR } from '../ir';

export interface CsvOptions { delimiter?: string; hasHeader?: boolean; sheetName?: string; }

export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/, 5).find(l => l.length) ?? '';
  const counts: Record<string, number> = { ',': 0, '\t': 0, ';': 0 };
  for (const ch of line) if (ch in counts) counts[ch]++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ',';
}

export function parseCsv(text: string, opts: CsvOptions = {}): TableDocIR {
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const rows: CellValue[][] = [];
  let row: CellValue[] = [], field = '', inQuotes = false;
  const pushField = () => { row.push(coerce(field)); field = ''; };
  const pushRow = () => { if (row.length || field) { pushField(); rows.push(row); row = []; } else rows.length && rows.push(row); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) pushField();
    else if (c === '\n') pushRow();
    else if (c === '\r') { /* skip; \n handles */ }
    else field += c;
  }
  if (field !== '' || row.length) pushRow();
  const sheet: SheetIR = { name: opts.sheetName ?? 'Sheet1', rows };
  return { kind: 'table', sheets: [sheet], meta: { delimiter, eol: text.includes('\r\n') ? '\r\n' : '\n', trailingNewline: /\r?\n$/.test(text) } };
}

function coerce(f: string): CellValue {
  if (f === '') return null;
  if (/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(f)) return Number(f);
  if (f.toLowerCase() === 'true') return true;
  if (f.toLowerCase() === 'false') return false;
  return f;
}

export function serializeCsv(doc: TableDocIR, opts: CsvOptions = {}): string {
  const delimiter = opts.delimiter ?? doc.meta?.delimiter ?? ',';
  const eol = doc.meta?.eol ?? '\n';
  const sheet = doc.sheets[0];
  if (!sheet) return '';
  const body = sheet.rows.map(r => r.map(v => renderField(v, delimiter)).join(delimiter)).join(eol);
  return body + ((doc.meta?.trailingNewline ?? true) ? eol : '');
}

function renderField(v: CellValue, delimiter: string): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(delimiter) || /["\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
