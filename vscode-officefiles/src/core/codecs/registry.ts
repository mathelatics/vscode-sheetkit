// Format registry: single source of truth mapping extension -> codec + editor + capabilities.
// Every surface (providers, agent tools, capability report) reads from here — deviation from
// vscode-office where the suffix switch is hardcoded in one React component (research/02).
import { DocumentIR, TableDocIR } from '../ir';
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

/** Capability report — what agents and the README both consume. Honest about boundaries. */
export function capabilityReport(binary: BinaryCodec[]) {
  return {
    editable: TEXT_FORMATS.map(f => ({ extensions: f.exts, viewType: f.viewType, model: f.irKind })),
    previewOnly: binary.map(b => ({ extensions: b.exts, model: b.irKind })),
    planned: [
      'xlsx (host-side read/write via ooxml codec — implemented, wiring in progress)',
      'docx (host-side paragraph-level read/write — implemented, wiring in progress)',
      'pdf text extraction / annotation',
      'pptx, epub rendering',
    ],
  };
}
