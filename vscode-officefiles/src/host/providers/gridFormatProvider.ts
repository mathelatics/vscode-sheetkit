// Generic grid provider for table formats (CSV/TSV/JSON). Thin wrapper over the shared ops registry.
import * as vscode from 'vscode';
import { DocBus } from '../bus';
import { ManagedDoc, ops } from '../ops/documentOps';
import { formatForPath } from '../../core/codecs/registry';

export class GridFormatProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'officefiles.jsonEditor'; // csv/tsv keep their dedicated providers
  private seq = 0;

  constructor(private context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel) {
    const fmt = formatForPath(document.uri.fsPath);
    if (!fmt) throw new Error('unsupported file for grid provider');
    const docId = `grid-${++this.seq}`;
    const managed: ManagedDoc = { id: docId, uri: document.uri, kind: 'table', textDocument: document, dirty: false };
    ops.register(managed);

    panel.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    panel.webview.html = this.html(panel.webview, { route: 'grid', fileName: document.uri.fsPath.split(/[\\/]/).pop() });

    const bus = DocBus.attach(panel);
    const sendDoc = (reason: string) => bus.emit('doc:update', { id: docId, reason, ir: ops.read(docId) });
    bus.on('ready', () => sendDoc('init'));
    bus.on('cell.set', async ({ row, col, value }) => { await ops.applyEdits(docId, [{ op: 'setCell', sheet: 'json', row, col, value }], 'user'); });
    bus.on('row.insert', async ({ row }) => { await ops.applyEdits(docId, [{ op: 'insertRow', sheet: 'json', row }], 'user'); });
    bus.on('sheet.set', async ({ sheet, rows }) => { await ops.applyEdits(docId, [{ op: 'replaceSheet', sheet, rows }], 'user'); });
    bus.on('save', async () => { await ops.save(docId); });

    const sub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) sendDoc('external');
    });
    panel.onDidDispose(() => { sub.dispose(); bus.dispose(); ops.unregister(docId); });
  }

  private html(webview: vscode.Webview, configs: any): string {
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'grid', 'assets', 'index.js'));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'grid', 'assets', 'index.css'));
    return /*html*/`<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource} data:;">
<link href="${css}" rel="stylesheet"></head><body><div id="root"></div>
<script>window.__OFFICEFILES__=${JSON.stringify(configs)};</script>
<script type="module" src="${js}"></script></body></html>`;
  }
}
