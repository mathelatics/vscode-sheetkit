// Format registry: single source of truth mapping extension -> codec + editor + capabilities.
// Every surface (providers, agent tools, capability report) reads from here — deviation from
// vscode-office where the suffix switch is hardcoded in one React component (research/02).
// NO vscode imports — reused verbatim by the headless MCP server and CLI.
import { DocumentIR, TableDocIR, EDIT_OPS } from '../ir';
import { parseCsv, serializeCsv } from './csv';
import { parseMarkdown, serializeMarkdown } from './markdown';
import { parseJson, serializeJson } from './json';

export type Codec = { parse(text: string): DocumentIR; serialize(ir: DocumentIR): string };

export const csvCodec: Codec = { parse: parseCsv as any, serialize: serializeCsv as any };
export const mdCodec: Codec = { parse: parseMarkdown, serialize: serializeMarkdown };
export const jsonCodec: Codec = { parse: parseJson as any, serialize: serializeJson as any };

/** Binary codecs operate on bytes + a JSZip instance (injected by host to keep core dep-free). */
export interface BinaryCodec {
  exts: string[];
  editable: boolean;           // false => preview only
  irKind: 'table' | 'document' | 'none';
}

/** The single binary format capability matrix — consumed by both the live and headless MCP
 *  servers so agents get identical answers regardless of how they connect. */
export interface BinaryFormatCap extends BinaryCodec { viewType?: string }
export const BINARY_FORMATS: BinaryFormatCap[] = [
  { exts: ['.xlsx', '.xlsm'], editable: true, irKind: 'table', viewType: 'officefiles.xlsxViewer' },
  { exts: ['.docx', '.dotx'], editable: true, irKind: 'document', viewType: 'officefiles.docxViewer' },
  { exts: ['.pptx', '.pptm'], editable: false, irKind: 'document' },
  { exts: ['.epub'], editable: false, irKind: 'document' },
  { exts: ['.pdf'], editable: false, irKind: 'document' },
  { exts: ['.zip', '.jar', '.vsix'], editable: false, irKind: 'none' },
];

export interface TextFormatDef {
  exts: string[];
  codec: Codec;
  viewType: string;
  label: string;
  irKind: 'table' | 'document';
  editable: true;
}

export const TEXT_FORMATS: TextFormatDef[] = [
  { exts: ['.csv'], codec: csvCodec, viewType: 'officefiles.csvEditor', label: 'OfficeFiles Grid Editor', irKind: 'table', editable: true },
  { exts: ['.tsv'], codec: { parse: (t: string) => parseCsv(t, { delimiter: '\t' }) as any, serialize: (ir: any) => serializeCsv(ir, { delimiter: '\t' }) }, viewType: 'officefiles.csvEditor', label: 'OfficeFiles Grid Editor (TSV)', irKind: 'table', editable: true },
  { exts: ['.md', '.markdown'], codec: mdCodec, viewType: 'officefiles.markdownEditor', label: 'OfficeFiles Markdown Editor', irKind: 'document', editable: true },
  { exts: ['.json'], codec: jsonCodec, viewType: 'officefiles.jsonEditor', label: 'OfficeFiles JSON Editor', irKind: 'table', editable: true },
];

/** OOXML binary formats handled host-side via JSZip (see src/core/codecs/ooxml.ts). */
export const BINARY_OOXML_FORMATS = [
  { exts: ['.xlsx'], editable: true, irKind: 'table' as const, viewType: 'officefiles.xlsxViewer', label: 'OfficeFiles Excel Editor (beta)' },
  { exts: ['.docx'], editable: false, irKind: 'document' as const, viewType: 'officefiles.docxViewer', label: 'OfficeFiles Word Reader (beta)' },
];

export function formatForPath(p: string): TextFormatDef | undefined {
  const lower = p.toLowerCase();
  return TEXT_FORMATS.find(f => f.exts.some(e => lower.endsWith(e)));
}

/** Capability report — what agents and the README both consume. Honest about boundaries.
 *  The optional argument is retained for backward compatibility and ignored. */
export function capabilityReport(_overrides?: unknown) {
  const bin = BINARY_FORMATS;
  return {
    editable: [
      ...TEXT_FORMATS.map(f => ({ extensions: f.exts, viewType: f.viewType, model: f.irKind })),
      ...bin.filter(b => b.editable).map(b => ({ extensions: b.exts, viewType: b.viewType, model: b.irKind })),
    ],
    previewOnly: bin.filter(b => !b.editable).map(b => ({ extensions: b.exts, model: b.irKind })),
    editOps: [...EDIT_OPS],
    notes: [
      'csv/tsv/md/json and xlsx/docx are editable; pptx/epub/pdf/zip are read-only.',
      'Headless (standalone) mode reads+writes files on disk; live mode edits the open (undoable) document.',
      'Use office_search to locate a cell/block, then office_apply_edits with typed ops; office_read accepts an optional range.',
    ],
  };
}
