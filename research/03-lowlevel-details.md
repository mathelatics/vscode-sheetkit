# 03 — Low-Level Design Notes (verified from source)

## Exact host↔webview protocol (from src/common/handler.ts + src/react/util/vscode.ts)
- Envelope: `{ type: string, content?: any }` both directions. No ids, no ack, no error channel.
- Host `Handler.on(event, cb)`: for non-'init' events it *replaces* the previous listener
  (`removeListener(listens[0])`) → single-subscriber semantics per event name.
- Webview `getVscodeEvent().on(event, fn)` stores ONE fn per event in a plain object map.
- Lifecycle events emitted by host without any webview request: `fileChange`, `externalUpdate`, `dispose`.
- First paint: provider calls handler listeners THEN `ReactApp.view(...)` which embeds config JSON into HTML
  (`{{configs}}` placeholder replaced). SPA reads it synchronously at boot.

## Editable document sync (markdownEditorProvider.ts, ~527 lines) — THE pattern to reuse
```ts
class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel) {
    const handler = Handler.bind(webviewPanel, document.uri);
    handler.on('update', content => this.updateTextDocument(document, content)); // webview -> doc
    workspace.onDidChangeTextDocument(e => e.document===document && !isWebviewOriginated
        && handler.emit('change', document.getText()));                            // doc -> webview
  }
  updateTextDocument(document, content) {          // line ~521
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, Range(0,0,lineCount,0), normalized);
    return vscode.workspace.applyEdit(edit);       // <-- goes through VS Code edit pipeline!
  }
}
```
KEY INSIGHT: because edits go through `workspace.applyEdit` on a real TextDocument, ANY external actor
(Copilot, MCP tools, other extensions, user typing in text editor via "Reopen with text editor")
already sees/changes the same buffer, and `onDidChangeTextDocument` pushes updates into the webview.
This is exactly how we give agents control: agent edits the TextDocument → WYSIWYG view live-updates.
Additional details found: image paste writes file via `workspace.fs.writeFile` then inserts markdown link;
status bar word count; AI streaming with AbortController + CancellationTokenSource (double cancel);
`blockScroll.ts` broadcasts scroll/block anchors across multiple open webviews of same doc.

## Provider registration facts (extension.ts / package.json)
- activationEvents: only `onStartupFinished` (eager; deviation: use `onCustomEditor:`/`onLanguage:` lazy).
- viewOption: `{ webviewOptions: { retainContextWhenHidden: true } }` shared by all editors.
- One provider instance serves 4 viewTypes (officeViewer/htmlViewer/imageViewer/parquetViewer) -
  viewType multiplexing lets users choose default editor per file type in VS Code UI.
- PDF path bypasses React: loads bundled pdf.js viewer html directly into webview (loadPdfViewer).
- Java decompiler: virtual scheme `decompile_java` + TextDocumentContentProvider → opens as normal text doc.

## Binary handling specifics
- Office files arrive in webview as base64/ArrayBuffer streamed by host after read (`readUriText`/fs.readFile);
  large files (parquet) parsed HOST-side with hyparquet and served as column chunks (memory guard).
- Archives: jszip (web-safe), 7z-wasm for .7z/.rar listing, tar module; extraction writes via workspace.fs.
- CSV: full text in memory; `office.csv.switch` command toggles custom editor vs built-in text editor.

## AI integration present today (src/service/ai/)
- `customAIClient.ts`: formats auto|openai|anthropic|gemini|ollama; user sets URL/key/model in settings;
  streaming SSE parser; used ONLY for markdown assist (rewrite/generate selection).
- NO MCP server, NO LanguageModelChat (vscode.languageModel), NO tool/function registration anywhere
  (grep 'mcp' → empty). This confirms our differentiator: first-class agent/MCP control surface.

## i18n low-level
- Host: `package.nls.json` + `%key%` in package.json + `i18n()` helper from Global (vscode-nls-i18n shim).
- Webview: own dictionary in src/react/i18n keyed by `vscode.env.language` passed in injected configs.

## Telemetry & privacy
- @vscode/extension-telemetry wired with telemetry.json declaration; respects vscode global telemetry level.

## Testing/CI observed
- test/ dir minimal; .github workflows run build+lint (eslint flat config). Dev loop: `npm run dev`
  (vite on 5739) + F5 extension host pointing at HMR html. We should do better: vitest unit tests for
  format codecs + Playwright-vscode (Code OSS) E2E smoke for each custom editor.
