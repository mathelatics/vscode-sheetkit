// Markdown editor provider: source-of-truth TextDocument + block view webview (deviation from vscode-office:
// simpler sync — no diff-match-patch needed because we always push full IR blocks and edit via WorkspaceEdit).
import * as vscode from 'vscode';
import { DocBus } from '../bus';
import { ManagedDoc, ops } from '../ops/documentOps';

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'officefiles.markdownEditor';
  private seq = 0;

  constructor(private context: vscode.ExtensionContext) { }

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel) {
    const docId = `md-${++this.seq}`;
    const managed: ManagedDoc = { id: docId, uri: document.uri, kind: 'document', textDocument: document, dirty: false };
    ops.register(managed);

    panel.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    panel.webview.html = this.html(panel.webview, { route: 'markdown', fileName: document.uri.fsPath.split(/[\\/]/).pop() });

    const bus = DocBus.attach(panel);
    const send = (reason: string) => bus.emit('doc:update', { id: docId, reason, ir: ops.read(docId) });
    bus.on('ready', () => send('init'));
    bus.on('block.replace', async ({ index, block }) => { await ops.applyEdits(docId, [{ op: 'replaceBlock', index, block }], 'user') });
    bus.on('block.append', async ({ block }) => { await ops.applyEdits(docId, [{ op: 'appendBlock', block }], 'user') });
    bus.on('block.delete', async ({ index }) => { await ops.applyEdits(docId, [{ op: 'deleteBlock', index }], 'user') });
    bus.on('save', async () => { await ops.save(docId) });

    const sub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        managed.dirty = e.document.isDirty;
        send('external'); // also fires when an AGENT edits via ops.applyEdits -> live block update
      }
    });
    panel.onDidDispose(() => { sub.dispose(); bus.dispose(); ops.unregister(docId); });
  }

  private html(webview: vscode.Webview, configs: any): string {
    const base = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'assets');
    return /*html*/`<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:;">
<link href="${webview.asWebviewUri(vscode.Uri.joinPath(base, 'index.css'))}" rel="stylesheet">
</head><body><div id="root"></div>
<script>window.__OFFICEFILES__=${JSON.stringify(configs)};</script>
<script type="module" src="${webview.asWebviewUri(vscode.Uri.joinPath(base, 'index.js'))}"></script></body></html>`;
  }
}
