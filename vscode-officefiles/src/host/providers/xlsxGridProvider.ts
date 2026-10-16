// Editable XLSX grid provider: hosts the same webview grid as CSV, backed by the host-side OOXML
// model (ooxml.applyEdits/save). Multi-sheet, undo-safe (via WorkspaceEdit-free IR save),
// and fully agent-drivable through ops.
import * as vscode from 'vscode';
import { DocBus } from '../bus';
import { ops } from '../ops/documentOps';
import { ooxml } from '../ops/ooxmlService';

export class XlsxGridProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = 'officefiles.xlsxViewer';

  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
    const d = await ooxml.open(uri);
    return { uri, dispose: () => ooxml.close(d.id) };
  }

  async resolveCustomEditor(doc: vscode.CustomDocument, panel: vscode.WebviewPanel): Promise<void> {
    const d = ooxml.get(doc.uri.toString());
    if (!d) throw new Error('xlsx model not found');
    const docId = d.id;

    panel.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    panel.webview.html = this.html(panel.webview, {
      route: 'grid',
      fileName: doc.uri.fsPath.split(/[\\/]/).pop(),
    });

    const bus = DocBus.attach(panel);
    const send = (reason: string) => bus.emit('doc:update', { id: docId, reason, ir: ops.read(docId) });

    bus.on('ready', () => send('init'));
    bus.on('sheet.set', async ({ sheet, rows }) => {
      await ops.applyEdits(docId, [{ op: 'replaceSheet', sheet, rows }], 'user');
      send('edit');
    });
    // Backward-compatible single-cell ops (used by other views / agents).
    bus.on('cell.set', async ({ row, col, value, sheet }) => {
      await ops.applyEdits(docId, [{ op: 'setCell', sheet, row, col, value }], 'user');
      send('edit');
    });
    bus.on('save', async () => { await ops.save(docId); });

    const onOps = ops.onRegistryChange((_doc, reason) => {
      if (reason.startsWith('edit') || reason === 'close') send(reason);
    });
    panel.onDidDispose(() => { onOps(); bus.dispose(); });
  }

  private html(webview: vscode.Webview, configs: any): string {
    const base = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'grid', 'assets');
    return /*html*/`<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource} data:;">
<link href="${webview.asWebviewUri(vscode.Uri.joinPath(base, 'index.css'))}" rel="stylesheet">
</head><body><div id="root"></div>
<script>window.__OFFICEFILES__=${JSON.stringify(configs)};</script>
<script type="module" src="${webview.asWebviewUri(vscode.Uri.joinPath(base, 'index.js'))}"></script></body></html>`;
  }
}
