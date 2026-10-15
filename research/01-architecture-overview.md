# 01 — High-Level Architecture of vscode-office (cweijan/vscode-office, MIT)

## What it is
A VS Code extension ("Office Viewer") that replaces default editors for ~40 file types:
Excel/CSV, Word(docx), PPT(pptx), PDF, EPUB, images/SVG/fonts, archives (zip/7z/tar/rar/icns),
Markdown (WYSIWYG via vditor + ProseMirror-based docx editor), XMind, PSD, Parquet, Java .class decompiler,
XML/YAML tree editors, HTTP files, and a Git history visualizer.

## Top-level structure
```
src/
  extension.ts        # Node/desktop entry: registers all providers & commands
  extension.web.ts    # Browser (vscode.dev / web) entry with reduced feature set
  common/             # Extension-host utilities
    global.ts         # DI-ish global config/context holder
    handler.ts        # Handler: bidirectional event bus between host <-> webview
    reactApp.ts       # Loads built React SPA html into webview, injects {{configs}}
    fileUtil.ts, fileSuffix.ts, util.ts, simpleEventEmitter.ts, Output.ts
  provider/           # vscode.CustomEditorProvider implementations (one per family)
    officeViewerProvider.ts   # routes by file suffix -> view name (excel/word/ppt/image/font/...)
    markdownEditorProvider.ts # editable custom editor (~532 lines) - TextDocument-based
    archiveViewerProvider.ts, classViewerProvider.ts, xml/, yaml/, http/, handlers/
  service/            # host-side business logic (csv, zip, parquet reader/writer, ai client, icon, telemetry)
  react/              # Webview SPA (React 19 + antd): main.tsx bootstraps from injected configs
    util/vscode.ts    # acquireVsCodeApi wrapper; typed event bus mirroring host Handler
    view/{excel,word,powerpoint,epub,image,svg,fontViewer,parquet,psd,xmind,icns,compress,gitHistory}
  gitHistory/         # self-contained sub-feature (provider+service+react views)
template/ vditor/     # vendored assets (vditor dist copied into webview bundle)
build.ts + vite.config.ts  # dual build: esbuild for extension host, vite for webview SPA
```

## The two-process model (critical design)
1. **Extension host (Node or Web worker)** owns the `vscode` API: FS, workspace events, commands, config.
2. **Webview (sandboxed iframe, Chromium)** runs a single React SPA bundle. It NEVER touches disk directly.

Communication = tiny RPC over postMessage:
- Host: `Handler.bind(panel, uri)` → `handler.on(event, cb)` / `handler.emit(event, content)`.
- Webview: `getVscodeEvent()` in `src/react/util/vscode.ts` → same `{type, content}` envelope.
- Envelope shape everywhere: `{ type: string, content: any }`. No schema/versioning (deviation point).

## Editor boot flow
```
openCustomDocument(uri) -> {uri, dispose}
resolveCustomEditor(document, panel):
  webview.options = { enableScripts, localResourceRoots: [extension roots, sibling folder] }
  Handler.bind(panel, uri)               # event bus + file watcher + doc-change listener
  route = switch(fileSuffix)             # 'excel' | 'word' | 'ppt' | 'image' | ...
  handleXxx(handler, uri)                # per-type host listeners (load/save/export...)
  ReactApp.view(webview, {route, fileName, ...configs})
      reads out/webview/index.html, rewrites <base href>, substitutes {{configs}} JSON:
      { route, language, "vscode-office" settings, icon config, sponsorBaseUrl }
```
SPA's `main.tsx` reads the injected config and mounts only the routed view → one bundle, many editors.

## Read-only vs editable split (key insight for our app)
- Most viewers are `CustomReadonlyEditorProvider`: host streams bytes/text to webview; parsing/rendering
  happens fully client-side (SheetJS xlsx, jszip, epubjs, opentype.js, hyparquet, ag-psd...).
- Only Markdown has a true editable provider bound to a `vscode.TextDocument`, so VS Code dirty-tracking,
  saves, undo, and conflict resolution work natively. THIS is the pattern to generalize for
  agent-editable office files: keep an underlying document as source of truth.
- CSV "editable" trick: command `office.csv.switch` swaps between raw text editor and grid viewer.

## Persistence & state
- `retainContextWhenHidden: true` on all editors (perf cost accepted for UX).
- Webview `getState/setState` for cheap UI state (dark mode), plus localStorage fallback.
- `autoClearCacheStorage` prunes stale global-state caches on activation.

## i18n / virtual filesystems
- All strings via `package.nls*.json` (10 locales) host-side; `src/react/i18n` client-side.
- `contributes.customEditors` selectors include `file:/vscode-vfs:/vscode-remote:` URI schemes
  → works with virtual FS providers (GitHub PR review, Remote-SSH). We must support these too.

## Build system
- `vite` builds the webview SPA into `out/webview`; `build.ts` (esbuild) bundles the extension host twice
  (node + web targets). Vendored `vditor/dist` copied via vite-plugin-static-copy.
- Dev mode: host loads SPA from `http://127.0.0.1:5739` HMR server (see `reactApp.readContent`).

## Dependencies worth noting (MIT project, patterns copyable)
Parsing/rendering in-browser: SheetJS `xlsx`, `@cweijan/exceljs` fork, ProseMirror suite +
`@eigenpal/docx-editor-react`, `pptxviewjs`, `epubjs`, `pdf-lib` (+ bundled pdf.js viewer), `jszip`,
`7z-wasm`, `tar`, `hyparquet`(+writer), `ag-psd`, `opentype.js`, `mind-elixir`, `chart.js`, CodeMirror 6,
`diff-match-patch`, `heic2any`, `utif`, `markdown-it` + plugins, `mermaid`, `katex`, `puppeteer-core` (HTML→PDF export).

## Weaknesses observed (fuel for deviations — see 04-deviations.md)
- One giant webview bundle for every format; no per-view code-splitting at runtime.
- No MCP/AI tool surface: AI is only "call OpenAI-compatible HTTP API for markdown assist".
- Event protocol untyped/unversioned; errors just popped as `showErrorMessage`.
- Readonly binary formats can't be edited programmatically (no mutation API for agents).
