// Markdown editor provider: real WYSIWYG/IR/SV via Vditor (MIT), same engine family as vscode-office.
// Source of truth remains the VS Code TextDocument, so undo/dirty/conflicts and *agent edits* all
// work; the webview receives raw markdown and pushes raw markdown back through WorkspaceEdit.
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

    const editMode = vscode.workspace.getConfiguration('officefiles').get<string>('editMode', 'wysiwyg');
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ],
    };
    const vditorCdn = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vditor')).toString();
    panel.webview.html = this.html(panel.webview, {
      route: 'markdown',
      fileName: document.uri.fsPath.split(/[\\/]/).pop(),
      editMode,
      vditorCdn,
    });

    const bus = DocBus.attach(panel);
    const send = (reason: string) => bus.emit('md:update', { id: docId, reason, markdown: document.getText() });
    bus.on('ready', () => send('init'));
    bus.on('md.set', async ({ markdown }: { markdown: string }) => {
      if (typeof markdown !== 'string' || markdown === document.getText()) return;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), markdown);
      await vscode.workspace.applyEdit(edit); // undo-safe + mirrors to all views + agents
    });
    // Keep block-level agent ops working on the same document.
    bus.on('block.replace', async ({ index, block }) => { await ops.applyEdits(docId, [{ op: 'replaceBlock', index, block }], 'user'); });
    bus.on('block.append', async ({ block }) => { await ops.applyEdits(docId, [{ op: 'appendBlock', block }], 'user'); });
    bus.on('block.delete', async ({ index }) => { await ops.applyEdits(docId, [{ op: 'deleteBlock', index }], 'user'); });
    bus.on('save', async () => { await ops.save(docId); });

    const sub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        managed.dirty = e.document.isDirty;
        send('external'); // covers agent edits and other views
      }
    });
    panel.onDidDispose(() => { sub.dispose(); bus.dispose(); ops.unregister(docId); });
  }

  private html(webview: vscode.Webview, configs: any): string {
    const base = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'grid', 'assets');
    return /*html*/`<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline' blob:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data: blob: https:; connect-src ${webview.cspSource}; worker-src blob:; media-src ${webview.cspSource} data: blob:;">
<link href="${webview.asWebviewUri(vscode.Uri.joinPath(base, 'index.css'))}" rel="stylesheet">
</head><body><div id="root"></div>
<script>window.__OFFICEFILES__=${JSON.stringify(configs)};</script>
<script type="module" src="${webview.asWebviewUri(vscode.Uri.joinPath(base, 'index.js'))}"></script></body></html>`;
  }
}
