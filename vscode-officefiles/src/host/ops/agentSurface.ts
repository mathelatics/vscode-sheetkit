// Agent surface: (1) plain commands, (2) vscode LanguageModelChat tools, (3) MCP server hook.
// All three delegate to the SAME ops service — see research/04-agent-mcp-control.md.
import * as vscode from 'vscode';
import { ops, openDocument } from './documentOps';

export function registerAgentCommands(context: vscode.ExtensionContext) {
  const wrap = <T>(fn: (...a: any[]) => T | Promise<T>) => async (...args: any[]) => {
    try { return await fn(...args); } catch (e: any) {
      vscode.window.showErrorMessage(`OfficeFiles: ${e?.message ?? e}`);
      throw e; // let command callers (incl. LM tool framework) see failure
    }
  };
  const wrapAsync = <T extends (...args: any[]) => Promise<any>>(fn: T) => async (...args: Parameters<T>) => {
    try { return await fn(...args); }
    catch (e: any) { vscode.window.showWarningMessage(`OfficeFiles: ${e?.message ?? e}`); throw e; }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('officefiles.agent.listDocuments', wrap(() => ops.listDocuments())),
    vscode.commands.registerCommand('officefiles.agent.readDocument', wrap((id: string, range?: any) => ops.read(id, range))),
    vscode.commands.registerCommand('officefiles.agent.applyEdits', wrapAsync((id: string, edits: any[], actor?: string) => ops.applyEdits(id, edits, actor))),
    vscode.commands.registerCommand('officefiles.agent.searchDocuments', wrap((query: string, regex?: boolean) => ops.search(query, !!regex))),
    vscode.commands.registerCommand('officefiles.agent.saveDocument', wrapAsync((id: string) => ops.save(id))),
    vscode.commands.registerCommand('officefiles.openCsvAsGrid', async () => {
      const uris = await vscode.window.showOpenDialog({ filters: { 'CSV/TSV': ['csv', 'tsv'] } });
      if (uris?.[0]) await openDocument(uris[0], 'officefiles.csvEditor');
    }),
  );
}

/** Native chat tools (#officefiles*) for Copilot / any LM-tool-capable agent inside the IDE. */
export function registerLanguageModelTools(context: vscode.ExtensionContext) {
  const lm = (vscode as any).lm; // guarded: API present >=1.90
  if (!lm?.registerTool) return;

  const mk = (name: string, description: string, handler: (opts: any) => Promise<any>, modelDescription?: string) =>
    lm.registerTool(name, {
      toolReferenceName: name.replace('officefiles.', ''),
      description, modelDescription: modelDescription ?? description,
      inputSchema: { type: 'object', properties: {}, ...handlerSchemas[name] },
    }, { invoke: async (options: any) => new lm.ToolResult((await handler(options)) ?? 'ok') });

  const handlerSchemas: Record<string, any> = {
    'officefiles.listDocuments': {},
    'officefiles.readDocument': { docId: { type: 'string' }, range: { type: 'object' } },
    'officefiles.search': { query: { type: 'string' }, regex: { type: 'boolean' } },
    'officefiles.applyEdits': { docId: { type: 'string' }, edits: { type: 'array', items: { type: 'object' } } },
    'officefiles.saveDocument': { docId: { type: 'string' } },
  };

  mk('officefiles.listDocuments', 'List OfficeFiles documents currently open in the editor.', async () => ops.listDocuments());
  mk('officefiles.readDocument', 'Read a document as structured JSON IR (table sheets/rows or markdown blocks).',
    async o => ops.read(o.docId, o.range));
  mk('officefiles.search', 'Search all open OfficeFiles documents for a substring or regex; returns docId + location for applyEdits.',
    async o => ops.search(o.query, !!o.regex),
    'Use before applyEdits to find cells/blocks to change.');
  mk('officefiles.applyEdits', 'Apply typed edit operations (setCell/insertRow/appendBlock/replaceText...) atomically; user can undo.',
    o => ops.applyEdits(o.docId, o.edits, 'copilot'),
    'Use this to modify spreadsheet cells or document blocks instead of editing files blindly.');
  mk('officefiles.saveDocument', 'Save the document to disk.', o => ops.save(o.docId));

  // Office binary formats (xlsx read/write, docx read) + capability discovery for agents.
  const openOffice = async (path: string) => {
    const uri = vscode.Uri.file(path);
    await openDocument(uri);
    const d = require('./ooxmlService').ooxml.get(uri.toString());
    return d ? { id: d.id, uri: d.uri.toString(), kind: d.format } : null;
  };
  handlerSchemas['officefiles.openOffice'] = { path: { type: 'string' } };
  handlerSchemas['officefiles.capabilities'] = {};
  mk('officefiles.openOffice', 'Open an xlsx/docx file so it can be read/edited via OfficeFiles tools. Returns docId.',
    o => openOffice(o.path),
    'Call before readDocument on .xlsx/.docx paths.');
  mk('officefiles.capabilities', 'Report which file formats are editable vs preview-only.',
    async () => require('../../core/codecs/registry').capabilityReport([
      { exts: ['.pdf'], editable: false, irKind: 'none' },
      { exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'], editable: false, irKind: 'none' },
      { exts: ['.docx'], editable: false, irKind: 'document' },
    ]));
}

/**
 * MCP integration notes (M3):
 * - In-IDE: `vscode.lm.registerMcpServerDefinition` provider exposing the same ops as MCP tools
 *   (VS Code >=1.99). Declared also under contributes.mcpServers for auto-discovery.
 * - External agents: bin/mcp-server.js (stdio, @modelcontextprotocol/sdk) bridging over the same core
 *   codecs + a small IPC socket to the running extension (see research/05 M6).
 */
