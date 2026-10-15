// OfficeFiles extension entry. Lazy-ish activation, registers providers + agent surface.
import * as vscode from 'vscode';
import { CsvEditorProvider } from './host/providers/csvProvider';
import { MarkdownEditorProvider } from './host/providers/markdownProvider';
import { registerAgentCommands, registerLanguageModelTools } from './host/ops/agentSurface';
import { openDocument } from './host/ops/documentOps';
import { capabilityReport } from './core/codecs/registry';
async function pickFile(): Promise<vscode.Uri | undefined> {
  const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectMany: false, filters: { 'Office files': ['xlsx', 'docx', 'pptx', 'epub', 'pdf'] } });
  return uris?.[0];
}
import { startIpcBridge } from './host/ipc/bridge';
import { BinaryPreviewProvider, BINARY_FORMATS } from './host/providers/binaryPreview';
import { GridFormatProvider } from './host/providers/gridFormatProvider';
import { OoxmlPreviewProvider } from './host/ops/ooxmlService';

export function activate(context: vscode.ExtensionContext) {
  const viewOption = { webviewOptions: { retainContextWhenHidden: true } }; // proven by vscode-office for UX
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(CsvEditorProvider.viewType, new CsvEditorProvider(context), viewOption),
    vscode.window.registerCustomEditorProvider(MarkdownEditorProvider.viewType, new MarkdownEditorProvider(context), viewOption),
    vscode.window.registerCustomEditorProvider(GridFormatProvider.viewType, new GridFormatProvider(context), viewOption),
    ...BINARY_FORMATS.map(f => vscode.window.registerCustomEditorProvider(f.viewType, new BinaryPreviewProvider(f), viewOption)),
    vscode.window.registerCustomEditorProvider('officefiles.xlsxViewer', new OoxmlPreviewProvider(context, 'xlsx'), viewOption),
    vscode.window.registerCustomEditorProvider('officefiles.docxViewer', new OoxmlPreviewProvider(context, 'docx'), viewOption),
    vscode.window.registerCustomEditorProvider('officefiles.pptxViewer', new OoxmlPreviewProvider(context, 'pptx'), viewOption),
    vscode.window.registerCustomEditorProvider('officefiles.epubViewer', new OoxmlPreviewProvider(context, 'epub'), viewOption),
  );
  // Agent convenience commands for office binaries (open into IR model + preview tab).
  context.subscriptions.push(
    vscode.commands.registerCommand('officefiles.openOffice', async (uri?: { fsPath: string }) => {
      const u = uri?.fsPath ? vscode.Uri.file(uri.fsPath) : await pickFile();
      if (u) await openDocument(u);
    }),
    vscode.commands.registerCommand('officefiles.capabilities', async () => {
      const report = capabilityReport([{ exts: ['.pdf'], editable: false, irKind: 'none' }, { exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'], editable: false, irKind: 'none' }, { exts: ['.docx'], editable: false, irKind: 'document' }]);
      const doc = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(report, null, 2) });
      await vscode.window.showTextDocument(doc);
    }),
  );
  registerAgentCommands(context);
  registerLanguageModelTools(context);

  // External-agent IPC bridge (used by bin/mcp-ipc-proxy.js). Opt-in via setting.
  if (vscode.workspace.getConfiguration('officefiles').get('agent.ipcBridge', true)) {
    try { startIpcBridge(context); } catch (e) { console.error('[officefiles] ipc bridge failed', e); }
  }
}

export function deactivate() { }
