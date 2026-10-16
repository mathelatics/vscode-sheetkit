// OfficeFiles extension entry.
// The rich viewers/editors are vendored from the MIT-licensed cweijan/vscode-office project
// (see src/referenceExtension.ts + src/react + src/provider). On top of that we keep our own
// agent/ops layer (DocumentOps + IR + LM tools + IPC bridge) and our optional grid editors.
import * as vscode from 'vscode';
import { activate as activateReference } from './referenceExtension';
import { registerAgentCommands, registerLanguageModelTools } from './host/ops/agentSurface';
import { openDocument } from './host/ops/documentOps';
import { capabilityReport } from './core/codecs/registry';
import { startIpcBridge } from './host/ipc/bridge';
import { registerMcpServerDefinition } from './host/mcp/server';
import { registerMcpConfigure } from './host/mcp/configure';
import { CsvEditorProvider } from './host/providers/csvProvider';
import { MarkdownEditorProvider } from './host/providers/markdownProvider';
import { GridFormatProvider } from './host/providers/gridFormatProvider';
import { XlsxGridProvider } from './host/providers/xlsxGridProvider';

async function pickFile(): Promise<vscode.Uri | undefined> {
  const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectMany: false, filters: { 'Office files': ['xlsx', 'docx', 'pptx', 'epub', 'pdf'] } });
  return uris?.[0];
}

/** Toggle a file between our custom editor and the built-in text editor. */
function switchEditor(customViewType: string, uri?: vscode.Uri) {
  const editor = vscode.window.activeTextEditor;
  const targetUri = uri ?? editor?.document.uri;
  if (!targetUri) return;
  const viewType = editor ? customViewType : 'default';
  void vscode.commands.executeCommand('vscode.openWith', targetUri, viewType);
}

export async function activate(context: vscode.ExtensionContext) {
  // 1) Reference viewers/editors (Excel, Word, PowerPoint, PDF, EPUB, fonts, SVG, PSD, XMind,
  //    Parquet, archives, WYSIWYG markdown, HTML preview, git history, ...).
  await activateReference(context);

  // 2) Our optional grid editors (deliberately `option` priority so the reference stays default).
  const viewOption = { webviewOptions: { retainContextWhenHidden: true } };
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(CsvEditorProvider.viewType, new CsvEditorProvider(context), viewOption),
    vscode.window.registerCustomEditorProvider(MarkdownEditorProvider.viewType, new MarkdownEditorProvider(context), viewOption),
    vscode.window.registerCustomEditorProvider(GridFormatProvider.viewType, new GridFormatProvider(context), viewOption),
    vscode.window.registerCustomEditorProvider('officefiles.xlsxViewer', new XlsxGridProvider(context), viewOption),
  );

  // 3) Our agent/ops surface.
  context.subscriptions.push(
    vscode.commands.registerCommand('officefiles.openOffice', async (uri?: { fsPath: string }) => {
      const u = uri?.fsPath ? vscode.Uri.file(uri.fsPath) : await pickFile();
      if (u) await openDocument(u);
    }),
    vscode.commands.registerCommand('officefiles.csv.switch', (uri?: vscode.Uri) => switchEditor(CsvEditorProvider.viewType, uri)),
    vscode.commands.registerCommand('officefiles.markdown.switch', (uri?: vscode.Uri) => switchEditor(MarkdownEditorProvider.viewType, uri)),
    vscode.commands.registerCommand('officefiles.capabilities', async () => {
      const report = capabilityReport([{ exts: ['.pdf'], editable: false, irKind: 'none' }, { exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'], editable: false, irKind: 'none' }, { exts: ['.docx'], editable: false, irKind: 'document' }]);
      const doc = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(report, null, 2) });
      await vscode.window.showTextDocument(doc);
    }),
  );
  registerAgentCommands(context);
  registerLanguageModelTools(context);
  registerMcpServerDefinition(context); // in-IDE MCP tools for VS Code chat agents
  registerMcpConfigure(context);         // one-click config for external MCP clients

  if (vscode.workspace.getConfiguration('officefiles').get('agent.ipcBridge', true)) {
    try { startIpcBridge(context); } catch (e) { console.error('[officefiles] ipc bridge failed', e); }
  }
}

export function deactivate() { }
