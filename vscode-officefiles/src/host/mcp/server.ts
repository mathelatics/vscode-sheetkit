import * as vscode from 'vscode';
import { ops } from '../ops/documentOps';

// MCP server wiring (M3/M6). Two transports share the same tool definitions:
// 1) In-IDE via vscode.lm.registerMcpServerDefinition (VS Code >= 1.99) — tools appear in Copilot Chat.
// 2) Standalone stdio entry (bin/mcp-server.js built from ./standalone.ts using @modelcontextprotocol/sdk)
//    for Claude Desktop / Cursor / Zed; it talks to this extension over an IPC socket OR runs headless
//    directly on files using src/core codecs (no IDE needed for file-scoped ops).

export interface McpToolDef { name: string; description: string; inputSchema: object; handler: (args: any) => Promise<any>; }

export const mcpTools: McpToolDef[] = [
  {
    name: 'office_list_documents', description: 'List OfficeFiles documents open in the editor.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ops.listDocuments(),
  },
  {
    name: 'office_read', description: 'Read a document as JSON IR. range.rows=[start,end] optional for tables.',
    inputSchema: { type: 'object', properties: { docId: { type: 'string' }, range: { type: 'object' } }, required: ['docId'] },
    handler: async (a) => ops.read(a.docId, a.range),
  },
  {
    name: 'office_search', description: 'Search all open documents; returns locations (Sheet!col:row or block:i).',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, regex: { type: 'boolean' } }, required: ['query'] },
    handler: async (a) => ops.search(a.query, !!a.regex),
  },
  {
    name: 'office_apply_edits', description: 'Apply typed edit ops atomically (undoable by user).',
    inputSchema: {
      type: 'object', properties: {
        docId: { type: 'string' },
        edits: { type: 'array', items: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'] } },
      }, required: ['docId', 'edits'],
    },
    handler: async (a) => ops.applyEdits(a.docId, a.edits, 'mcp'),
  },
  {
    name: 'office_save', description: 'Persist document to disk.',
    inputSchema: { type: 'object', properties: { docId: { type: 'string' } }, required: ['docId'] },
    handler: async (a) => ops.save(a.docId),
  },
  {
    name: 'office_open', description: 'Open a file by absolute path in OfficeFiles (csv/md/json/tsv grid or editors; xlsx/docx into the office model). Returns docId for other tools.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    handler: async (a) => {
      const vscode_ = await import('vscode');
      const { openDocument } = await import('../ops/documentOps');
      const uri = vscode_.Uri.file(a.path);
      await openDocument(uri);
      const listed = ops.listDocuments().find(d => d.uri === uri.toString());
      return listed ?? { opened: uri.toString() };
    },
  },
  {
    name: 'office_capabilities', description: 'Which formats are editable vs preview-only, and the EditOp vocabulary.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const { capabilityReport } = await import('../../core/codecs/registry');
      return {
        ...capabilityReport([
          { exts: ['.pdf'], editable: false, irKind: 'none' },
          { exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'], editable: false, irKind: 'none' },
          { exts: ['.docx'], editable: false, irKind: 'document' },
        ]),
        editOps: ['setCell', 'insertRow', 'deleteRow', 'insertColumn', 'appendBlock', 'insertBlock', 'replaceBlock', 'deleteBlock', 'replaceText'],
      };
    },
  },
];

/** Register in-process MCP server definition so VS Code chat agents discover our tools. */
export function registerMcpServerDefinition(context: vscode.ExtensionContext) {
  const lm = (vscode as any).lm;
  if (!lm?.registerMcpServerDefinition) return; // older VS Code: LM tools + commands still work
  try {
    // createMcpStdioServerDefinition(label, command, args?, cwd?, env?) — direct definition, no provider needed.
    const def = lm.createMcpStdioServerDefinition
      ? lm.createMcpStdioServerDefinition(
          'OfficeFiles',
          process.execPath,
          [vscode.Uri.joinPath(context.extensionUri, 'out', 'mcp-standalone.js').fsPath])
      : undefined;
    if (def) context.subscriptions.push(lm.registerMcpServerDefinition('officefiles', def));
  } catch { /* API shape drift across Insiders builds — degrade silently to LM tools/commands */ }
}
