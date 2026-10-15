// Binary format registry: formats we OPEN (preview) but do not text-edit.
// This is the honest capability boundary — same pattern vscode-office uses for pptx/epub etc.,
// but declared in one place so every surface (provider, agent tools, docs) reports it consistently.
import * as vscode from 'vscode';

export interface BinaryFormat {
  viewType: string;
  label: string;
  extensions: string[];        // lowercase, with dot
  kind: 'pdf' | 'image';
  editable: false;             // marker for capability queries
}

export const BINARY_FORMATS: BinaryFormat[] = [
  { viewType: 'officefiles.pdfViewer', label: 'OfficeFiles PDF Viewer', extensions: ['.pdf'], kind: 'pdf', editable: false },
  { viewType: 'officefiles.imageViewer', label: 'OfficeFiles Image Viewer', extensions: ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.svg'], kind: 'image', editable: false },
];

/** CustomTextEditorProvider-compatible viewer that renders a webview for binary bytes. */
export class BinaryPreviewProvider implements vscode.CustomReadonlyEditorProvider {
  constructor(private readonly fmt: BinaryFormat) {}

  async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(doc: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    webviewPanel.webview.options = { enableScripts: true };
    const bytes = await vscode.workspace.fs.readFile(doc.uri);
    if (this.fmt.kind === 'pdf') {
      // Self-contained pdf.js CDN viewer — no bundling needed; falls back to native embed.
      const b64 = Buffer.from(bytes).toString('base64');
      webviewPanel.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: https:; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; child-src blob:; worker-src blob:; style-src 'unsafe-inline' https://cdn.jsdelivr.net;">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pdfjs-dist@4/web/viewer.css">
</head><body style="margin:0;height:100vh">
<iframe id="f" style="width:100%;height:100%;border:0" src="about:blank"></iframe>
<script>
  // Simplest robust path: hand base64 to browser-native PDF rendering via data URL object.
  const bin = atob('${b64.length < 2_000_000 ? b64 : ''}');
  ${b64.length >= 2_000_000 ? "document.body.innerHTML='<p>PDF too large for inline preview — use VS Code built-in.</p>';" : `
  const arr = Uint8Array.from(bin, c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
  document.getElementById('f').src = url;`}
</script></body></html>`;
    } else {
      const mime = ({ '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon' } as Record<string, string>)[this.fmt.extensions.includes('.svg') ? '.svg' : this.fmt.extensions[0]] ?? 'application/octet-stream';
      const ext = '.' + (doc.uri.path.split('.').pop() ?? '').toLowerCase();
      const realMime = ({ '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon' } as Record<string, string>)[ext] ?? 'application/octet-stream';
      const b64 = Buffer.from(bytes).toString('base64');
      webviewPanel.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:var(--vscode-editor-background, #1e1e1e)}img,svg{max-width:96vw;max-height:96vh}</style></head>
<body><img src="data:${realMime};base64,${b64}" alt="${doc.uri.path.replace(/"/g, '')}"></body></html>`;
      void mime;
    }
  }
}
