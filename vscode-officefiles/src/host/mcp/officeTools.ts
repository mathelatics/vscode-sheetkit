// Canonical OfficeFiles tool vocabulary shared by every MCP transport.
// A backend supplies the actual document access (disk in headless mode, the running
// editor over IPC in live mode); this module owns names, descriptions, JSON Schemas,
// safety annotations and the initialize instructions — so nothing drifts between surfaces.
import type { McpTool } from './protocol';
import type { EditOp } from '../../core/ir';
import { EDIT_OPS } from '../../core/ir';

/** Guidance handed to the agent once at initialize. Keep it short and actionable. */
export const OFFICE_INSTRUCTIONS = [
  'OfficeFiles operates on office documents through a single typed IR + EditOp vocabulary.',
  'Workflow: office_capabilities -> office_list/office_open -> office_search -> office_read -> office_apply_edits (optionally dryRun:true first) -> office_save.',
  'Formats: csv/tsv/md/json and xlsx/docx are editable; pptx/epub/pdf/zip are read-only.',
  `Edit ops: ${EDIT_OPS.join(', ')}.`,
  'Targets are addressed by `uri`/`path` (file on disk) or `docId` (a document open in the editor).',
  'office_apply_edits is destructive: prefer dryRun to preview, and re-read after saving.',
].join('\n');

export type TargetArgs = { uri?: string; path?: string; docId?: string };
export type ReadArgs = TargetArgs & { range?: { rows?: [number, number]; blocks?: [number, number] } };
export type SearchArgs = TargetArgs & { query: string; regex?: boolean; limit?: number };
export type ApplyArgs = TargetArgs & { edits: EditOp[]; dryRun?: boolean; actor?: string };

/** Backend contract. Optional members become optional tools (e.g. headless has no editor to `open`). */
export interface OfficeBackend {
  capabilities(): Promise<any>;
  list(args: { dir?: string; limit?: number }): Promise<any>;
  read(args: ReadArgs): Promise<any>;
  search(args: SearchArgs): Promise<any>;
  applyEdits(args: ApplyArgs): Promise<any>;
  save(args: TargetArgs): Promise<any>;
  open?(args: { path: string }): Promise<any>;
  extractPdfText?(args: TargetArgs): Promise<any>;
}

const TARGET_PROPS = {
  uri: { type: 'string', description: 'File path or file:// URI, e.g. /work/budget.xlsx.' },
  path: { type: 'string', description: 'Alias for `uri` (absolute filesystem path).' },
  docId: { type: 'string', description: 'Document id returned by office_list (a document open in the editor).' },
};

const EDIT_OP_SCHEMA = {
  type: 'array',
  description: [
    'Typed edit ops applied atomically.',
    'Table docs: {op:"setCell",sheet?,row,col,value}, {op:"insertRow",row,values?}, {op:"deleteRow",row}, {op:"insertColumn",col,header?,values?}, {op:"replaceSheet",rows}, {op:"replaceText",search,replacement,regex?,all?}.',
    'Document docs: {op:"appendBlock",block:{type,text,level?,lang?,items?}}, {op:"insertBlock",after?,block}, {op:"replaceBlock",index,block}, {op:"deleteBlock",index}, {op:"replaceText",search,replacement,regex?,all?}.',
  ].join(' '),
  items: { type: 'object', properties: { op: { type: 'string', enum: [...EDIT_OPS] } }, required: ['op'] },
};

export interface OfficeSurface { live?: boolean }

/** Build the tool list for a backend. Tools whose backend method is absent are omitted. */
export function officeTools(backend: OfficeBackend, surface: OfficeSurface = {}): McpTool[] {
  const liveNote = surface.live
    ? 'Live editor mode: operates on documents open in the user VS Code window; edits are undoable.'
    : 'Headless mode: reads and writes files directly on disk.';

  const tools: McpTool[] = [
    {
      name: 'office_capabilities',
      title: 'OfficeFiles capabilities',
      description: 'Report which file formats are editable vs read-only, the EditOp vocabulary, and usage notes. Call this first.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Capabilities', readOnlyHint: true, openWorldHint: false },
      handler: () => backend.capabilities(),
    },
    {
      name: 'office_list',
      title: 'List documents',
      description: surface.live
        ? 'List OfficeFiles documents currently open in the editor (id, uri, kind, dirty).'
        : 'List supported office files on disk. Pass `dir` (default: the current working directory) to scan a folder.',
      inputSchema: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Directory to scan (headless mode). Defaults to cwd.' },
          limit: { type: 'number', description: 'Max entries to return (default 200).' },
        },
      },
      annotations: { title: 'List', readOnlyHint: true, openWorldHint: false },
      handler: (a) => backend.list(a ?? {}),
    },
    {
      name: 'office_read',
      title: 'Read document',
      description: `Read a document as structured JSON IR (table sheets/rows or markdown blocks). ${liveNote} Use range to page large documents.`,
      inputSchema: {
        type: 'object',
        properties: {
          ...TARGET_PROPS,
          range: {
            type: 'object',
            description: 'Optional slice. Tables: {rows:[start,end]}. Documents: {blocks:[start,end]}.',
            properties: { rows: { type: 'array', items: { type: 'number' } }, blocks: { type: 'array', items: { type: 'number' } } },
          },
        },
        anyOf: [{ required: ['uri'] }, { required: ['path'] }, { required: ['docId'] }],
      },
      annotations: { title: 'Read', readOnlyHint: true, openWorldHint: true },
      handler: (a) => backend.read(a ?? {}),
    },
    {
      name: 'office_search',
      title: 'Search documents',
      description: 'Search for a substring or regex. Returns locations (sheet!col:row or block:index) to target with office_apply_edits. Call before editing.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to find.' },
          regex: { type: 'boolean', description: 'Treat query as a regular expression.' },
          limit: { type: 'number', description: 'Max hits (default 100).' },
          ...TARGET_PROPS,
        },
        required: ['query'],
      },
      annotations: { title: 'Search', readOnlyHint: true, openWorldHint: true },
      handler: (a) => backend.search(a ?? {}),
    },
    {
      name: 'office_apply_edits',
      title: 'Apply edits',
      description: `Apply typed edit operations atomically and (unless dryRun) persist them. ${liveNote} Set dryRun:true to validate + preview without writing.`,
      inputSchema: {
        type: 'object',
        properties: {
          ...TARGET_PROPS,
          edits: EDIT_OP_SCHEMA,
          dryRun: { type: 'boolean', description: 'Validate and preview only; do not write.' },
          actor: { type: 'string', description: 'Optional actor label recorded in the change trace (e.g. agent name).' },
        },
        required: ['edits'],
        anyOf: [{ required: ['uri'] }, { required: ['path'] }, { required: ['docId'] }],
      },
      annotations: { title: 'Apply edits', destructiveHint: true, idempotentHint: false, openWorldHint: true },
      handler: (a) => backend.applyEdits(a ?? { edits: [] }),
    },
    {
      name: 'office_save',
      title: 'Save document',
      description: 'Persist a document to disk (round-trip / explicit save).',
      inputSchema: {
        type: 'object',
        properties: { ...TARGET_PROPS },
        anyOf: [{ required: ['uri'] }, { required: ['path'] }, { required: ['docId'] }],
      },
      annotations: { title: 'Save', destructiveHint: true, idempotentHint: true, openWorldHint: true },
      handler: (a) => backend.save(a ?? {}),
    },
  ];

  if (backend.open) {
    tools.push({
      name: 'office_open',
      title: 'Open document',
      description: 'Open a file on disk in the OfficeFiles editor so it can be read/edited by docId. Returns the document descriptor.',
      inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path to open.' } }, required: ['path'] },
      annotations: { title: 'Open', readOnlyHint: false, openWorldHint: true },
      handler: (a) => backend.open!({ path: a.path }),
    });
  }

  if (backend.extractPdfText) {
    tools.push({
      name: 'office_extract_pdf_text',
      title: 'Extract PDF text',
      description: 'Extract per-page text from a PDF (read-only) so you can read/search it.',
      inputSchema: {
        type: 'object',
        properties: { ...TARGET_PROPS },
        anyOf: [{ required: ['uri'] }, { required: ['path'] }],
      },
      annotations: { title: 'Extract PDF text', readOnlyHint: true, openWorldHint: true },
      handler: (a) => backend.extractPdfText!(a ?? {}),
    });
  }

  return tools;
}
