// CSV Grid custom editor provider. Thin: wires TextDocument <-> bus <-> webview; all logic in ops service.
import * as vscode from 'vscode';
import { DocBus } from '../bus';
import { ManagedDoc, ops } from '../ops/documentOps';

export class CsvEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'officefiles.csvEditor';
  private seq = 0;

  constructor(private context: vscode.ExtensionContext) { }

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel, token: vscode.CancellationToken) {
    const docId = `csv-${++this.seq}`;
    const managed: ManagedDoc = { id: docId, uri: document.uri, kind: 'table', textDocument: document, dirty: false };
    ops.register(managed);

    panel.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    panel.webview.html = this.html(panel.webview, { route: 'grid', fileName: document.uri.fsPath.split(/[\\/]/).pop() });

    const bus = DocBus.attach(panel);
    const sendDoc = (reason: string) => bus.emit('doc:update', { id: docId, reason, ir: ops.read(docId) });

    // initial paint after SPA signals ready (multi-subscriber safe; theirs used implicit ordering)
    bus.on('ready', () => sendDoc('init'));
    bus.on('cell.set', async ({ row, col, value }) => { await ops.applyEdits(docId, [{ op: 'setCell', sheet: 'Sheet1', row, col, value }], 'user') });
    bus.on('row.insert', async ({ row }) => { await ops.applyEdits(docId, [{ op: 'insertRow', sheet: 'Sheet1', row }], 'user') });
    // Whole-sheet replacement from the grid editor (handles edits + structural add/remove in one atomic op).
    bus.on('sheet.set', async ({ sheet, rows }) => { await ops.applyEdits(docId, [{ op: 'replaceSheet', sheet, rows }], 'user') });
    bus.on('save', async () => { await ops.save(docId) });

    const sub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        managed.dirty = e.document.isDirty;
        sendDoc('external');   // covers agent edits too — same pipeline (see research/03)
      }
    });
    panel.onDidDispose(() => { sub.dispose(); bus.dispose(); ops.unregister(docId); });
  }

  private html(webview: vscode.Webview, configs: any): string {
    const uri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'grid', 'assets', 'index.js'));
    return /*html*/`<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource} data:;">
<link href="${webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'grid', 'assets', 'index.css'))}" rel="stylesheet">
</head><body><div id="root"></div>
<script>window.__OFFICEFILES__=${JSON.stringify(configs)};</script>
<script type="module" src="${uri}"></script></body></html>`;
  }
}
