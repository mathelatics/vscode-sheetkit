// JSON codec: text <-> TableDocIR. Lossless round-trip via a magic header column that
// stores the original document as a single string cell (JSON.stringify-safe escaping).
// Agents see real columns/rows for flat arrays-of-objects (the common "tabular JSON" case);
// anything non-tabular still reads/writes back byte-faithfully.
import { CellValue, TableDocIR } from '../ir';

const MAGIC = '__officefiles_json__';

/** Try to map an array of flat objects to rows/columns (agent-friendly view). */
function tryTabular(value: any): { header: string[]; rows: CellValue[][] } | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const keys = new Set<string>();
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    for (const k of Object.keys(item)) {
      const v = item[k];
      if (v !== null && typeof v === 'object') return null; // nested → not flat
      keys.add(k);
    }
  }
  const header = [...keys];
  const rows = value.map((item: Record<string, CellValue>) => header.map(h => item[h] ?? null));
  return { header, rows };
}

export function parseJson(text: string): TableDocIR {
  const value = JSON.parse(text);
  const tab = tryTabular(value);
  const payload = JSON.stringify(value); // compact canonical form stored in magic cell
  if (tab) {
    return {
      kind: 'table',
      sheets: [{ name: 'json', rows: [tab.header, ...tab.rows] }],
      meta: { format: 'json', magic: MAGIC, payload },
    };
  }
  // Non-tabular: single-cell table holding the whole doc — still fully editable via replaceText ops.
  return {
    kind: 'table',
    sheets: [{ name: 'json', rows: [[MAGIC], [payload]] }],
    meta: { format: 'json', magic: MAGIC, payload },
  };
}

export function serializeJson(doc: TableDocIR): string {
  const sheet = doc.sheets[0];
  const header = sheet?.rows[0] ?? [];
  // If user edited the visible grid, rebuild objects from it (preferred over stale payload).
  if (header.length > 0 && header[0] !== MAGIC) {
    const rows = sheet.rows.slice(1);
    const out = rows.map(r => {
      const o: Record<string, CellValue> = {};
      header.forEach((h, i) => { if (h != null && h !== '') o[String(h)] = r[i] ?? null; });
      return o;
    });
    return JSON.stringify(out, null, 2) + '\n';
  }
  // Untouched passthrough / structural doc: use live magic cell if edited, else original payload.
  const live = sheet?.rows[1]?.[0];
  const raw = typeof live === 'string' && live ? live : (doc.meta?.payload ?? '{}');
  try {
    return JSON.stringify(JSON.parse(raw), null, 2) + '\n'; // pretty-print canonical
  } catch {
    return String(raw);
  }
}
