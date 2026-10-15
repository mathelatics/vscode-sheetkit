# 02 — Component / Module Design (mid-level)

## A. Extension-host components

### 1. `Global` (src/common/global.ts)
Static holder initialized in `activate()`: extension path, context, config shortcuts.
Pattern: cheap service-locator; avoid overusing — better to pass `context` explicitly.

### 2. `Handler` (src/common/handler.ts) — the heart of host↔webview RPC
```ts
Handler.bind(panel, uri): Handler
  - creates SimpleEventEmitter keyed by message.type
  - panel.webview.onDidReceiveMessage(msg => emitter.emit(msg.type, msg.content))
  - FileSystemWatcher on file -> emit 'fileChange'
  - workspace.onDidChangeTextDocument (matching uri) -> emit 'externalUpdate'
  - panel.onDidDispose -> isEnd=true, dispose watchers
handler.on(event, cb)   // subscribe to webview->host messages (single-listener replace semantics for non-'init')
handler.emit(event, content)  // host->webview postMessage({type,content})
```
Notes/quirks:
- `on()` REMOVES any previous listener for that event (except 'init'): last-writer-wins. Good for
  view-switching, dangerous for parallel features → we should use proper multi-subscription + disposal tokens.
- Errors in callbacks are caught and shown via `showErrorMessage` — no structured error channel back to UI.

### 3. `ReactApp` (src/common/reactApp.ts) — webview bootstrap
- Reads built `out/webview/index.html`, rewrites `<base href="/">` → webview URI base.
- Replaces `{{configs}}` placeholder with JSON: `{route, fileName, iconConfig, language, settings}`.
- Dev mode proxies HMR server at 127.0.0.1:5739.
This "inject config into HTML" trick avoids a first round-trip: SPA renders instantly with data already known.

### 4. Providers (src/provider/*)
- **OfficeViewerProvider** (`CustomReadonlyEditorProvider`): registered under FOUR viewTypes
  (officeViewer, htmlViewer, imageViewer, parquetViewer) so users can pick per-file via "Open With…".
  `openCustomDocument` returns stateless `{uri}`; all work happens in `resolveCustomEditor`.
  Suffix→route switch; special cases: pdf loads bundled pdf.js viewer page directly (not React),
  epub/ttf/etc route into React views. `localResourceRoots` includes the FILE'S PARENT FOLDER
  (needed for docx images referenced relatively, csv sidecar assets).
- **MarkdownEditorProvider** (editable): implements `CustomEditorProvider<MarkdownDocument>` where
  MarkdownDocument wraps a real `vscode.TextDocument`; listens to document changes both ways,
  applies `diff-match-patch` to reconcile webview edits vs external edits, manages dirty/save via
  `workspace.saveTextDocument`. Registers as two viewTypes (markdownViewer WYSIWYG + markdownPreview).
- **ArchiveViewerProvider**: zip/tar/7z — lists entries host-side or streams bytes to webview,
  extract/open-inside handlers. **ClassViewerProvider + JavaDecompilerProvider**: `.class` → runs
  decompiler, shows result via `TextDocumentContentProvider('decompile_java')` virtual scheme.
- **xml/ yaml/ http/**: activate(context) style modules registering tree-editor custom editors and
  REST-client commands (http files → requests executed host-side via axios, response streamed to webview).
- **webUnsupportedViewerProvider**: graceful degradation on vscode.dev for Node-only features.

### 5. Services (src/service/*)
- `csvService` (switch editor), `htmlService` (preview via webview + live reload),
- `zip/ compress/` (jszip + 7z-wasm + tar wrappers), `parquet/` (hyparquet read/write host-side for big files),
- `ai/customAIClient.ts`: unified HTTP client supporting openai|anthropic|gemini|ollama formats, user-config
  base URL/key/model — pure LLM API wrapper, NOT agent integration (our key deviation opportunity),
- `icon/iconService`: file-icon theme injection into webviews, `telemetryService` (vscode extension-telemetry).

## B. Webview (React SPA) components

### Bootstrap: src/react/main.tsx
Reads `window.__CONFIGS__`-style injected object (via template), picks view by `route`, wraps in antd
ConfigProvider (theme from vscode CSS vars + dark-mode toggle), mounts.

### The webview-side bus: src/react/util/vscode.ts
Mirrors host Handler: `getVscodeEvent()` with `on/emit` over `{type,content}`; window 'message' listener
dispatches to a single handler per event name. Also owns dark-mode persistence (getState + localStorage).

### Views (src/react/view/*)
- excel: SheetJS/exceljs parse ArrayBuffer → antd table/grid; chart rendering via chart.js; CSV/TSV same route.
- word: ProseMirror-based docx editor (@eigenpal/docx-editor-react) — editable docx is emerging here.
- powerpoint: pptxviewjs render-only.
- epub: epubjs with pagination UI. image: react-image-gallery + heic2any/utif decoding. svg: inline + export png.
- fontViewer: opentype.js glyph tables. parquet: hyparquet column preview + filter. psd: ag-psd layers.
- xmind: mind-elixir graph. compress: archive browser tree. gitHistory: log graph + diff viewer.
- common/: shared widgets (toolbar, sponsor banner, i18n provider).

### Styling strategy
VS Code provides `--vscode-*` CSS variables inside webviews; app maps them to an antd theme token set
(`antThemeConfig.ts`) → native-looking dark/light. Our app should do the same AND additionally honor
user-level themes through a small token bridge.

## C. Command & contribution surface (package.json)
- `contributes.customEditors` (~40 selectors incl. vfs/remote schemes), `commands` for switching editors,
  creating new office files (template/ dir holds blank docx/xlsx/pptx templates), paste-image into md,
  html preview; `configuration` block under `vscode-office.*` (theme, editor options, AI settings);
  `menus` (explorer context: convert/export), `keybindings` (shortcut.md documents them),
  `themes`+`iconThemes` (ships One Dark Modern + file-icon collection — nice retention feature).

## D. Data flow example: editing & saving a CSV grid
1. Host reads file text → emit('init', {content}) while ReactApp injects route.
2. Webview parses → grid. User edits → emit('save', newText).
3. Host writes via workspace.fs.writeFile → file watcher fires 'fileChange' back to webview →
   webview must ignore self-originated change (they guard by comparing content hash).
Improvement for us: explicit requestId/version stamps instead of hash comparison; use TextDocument as SSOT.
