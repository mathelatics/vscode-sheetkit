# OfficeTools — Tech Report Notebook

> **Subject:** `vscode-officetools` — a focused VS Code extension that provides **PDF** and
> **Markdown** viewers/editors and nothing else.
> **Status:** working (desktop + web bundles activate; PDF and Markdown providers verified).
> **Last updated:** 2026-10-17
> **Repo:** `/workspaces/vscode-sheetkit/vscode-officetools`
> **Branch:** `officetools-pdf-markdown`

This notebook is written to be read top-to-bottom by two audiences:

- **Users** — §1–§3 (what you get, how to drive it, all settings).
- **Developers** — §4–§11 (architecture, protocols, build, tests, gotchas, credits).

A change log and decision log live at the end (§12).

---

## 1. What OfficeTools is

OfficeTools is a deliberately small extension carved out of the much larger
`vscode-officefiles` project. It keeps **two** custom editors and discards everything else
(agent/MCP tooling, CSV/XLSX/DOCX/PPTX/EPUB/SVG/images/PSD/XMind/Parquet/archives/fonts/ICNS,
HTML preview, HTTP client, Git history, icon/colour themes).

| Format   | Editor id                       | Kind                                 | Priority                            |
| -------- | ------------------------------- | ------------------------------------ | ----------------------------------- |
| PDF      | `officetools.pdfViewer`       | read-only viewer (pdf.js)            | default for`*.pdf`                |
| Markdown | `officetools.markdownEditor`  | WYSIWYG/IR editor + preview (Vditor) | default for`*.md`, `*.markdown` |
| Markdown | `officetools.markdownPreview` | same provider, preview entry point   | on demand                           |

**Design goals**

1. **Fewer moving parts.** One build step (esbuild), no MCP, no grid SPA, no icon theme.
2. **No collisions.** Private `officetools.*` view types and settings so it can coexist with
   `cweijan.vscode-office` and `officefiles` in the same window.
3. **Faithful features.** The PDF viewer and Markdown editor are the upstream (MIT) engines,
   vendored as-is, not re-implemented.

---

## 2. User guide

### 2.1 PDF viewing

Open any `*.pdf` — it renders in the built-in viewer (no "open with" step needed).

**Controls (pdf.js viewer + OfficeTools additions)**

| Group       | What you can do                                                                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation  | First/previous/next/last page, page-number box, thumbnails sidebar, document outline sidebar                                                                                                   |
| Zoom        | Zoom in/out, fit page, fit width, automatic, actual size, and a**custom scale dropdown** (`scaleSelectContainer`)                                                                      |
| Page layout | Rotate CW/CCW, vertical / horizontal / wrapped scrolling, single / odd / even spreads, presentation mode                                                                                       |
| Cursor      | Hand (pan) vs. select-text tool                                                                                                                                                                |
| Find        | In-document search with match-case, whole-word, highlight-all, next/previous, result count                                                                                                     |
| Panels      | Thumbnails, outline, attachments, layers, and**document properties** (title, author, subject, keywords, dates, creator, producer, version, page size, linearized, file size, page count) |
| Files       | Download, open file, print                                                                                                                                                                     |
| Sidebar     | Drag the`sidebarResizer` to resize; width + open state persist in `localStorage` (`vscode-office.pdf.sidebarWidth`, `vscode-office.pdf.sidebarOpen`)                                   |
| Theme       | **Theme adapt** (follow VS Code colours) — toggle via the toolbar button or `Ctrl/Cmd+Shift+L`; **Dark mode** for the PDF — `Ctrl/Cmd+L`. Both persist in `localStorage`   |
| Security    | Password prompt dialog for encrypted PDFs; graceful error overlay for broken files                                                                                                             |

The viewer is **read-only** by design; it can never modify the file.

### 2.2 Markdown editing

Opening `*.md` / `*.markdown` gives you a full Markdown studio.

**Writing**

- Two modes: **WYSIWYG** and **IR** (instant rendering). Switch from the toolbar or `officetools.editMode`.
- Outline panel on the left for navigation.
- Toolbar: outline, headings, bold, italic, strikethrough, link, lists, ordered lists,
  checkboxes, tables, quote, code block, inline code, undo/redo, find, upload image,
  editor theme + theme toggle, AI settings, settings.
- Rich rendering: **Mermaid** diagrams, **KaTeX** math (`$…$`, `$$…$$`, macros from VS Code's
  `markdown.math.macros`), **highlight.js** code blocks, **PlantUML**, Obsidian callouts,
  `==mark==`, tables of contents, footnotes, YAML front matter.
- **Wiki links** `[[Page]]`, `[[Page#heading]]`, `[[Page|label]]` and `![[embeds]]` resolve
  against your workspace and open the target file.
- Markdown links to other files open in a new editor tab; broken links surface as a toast.
- **Images:** drag-and-drop or *Insert Image*; pasted/copied images are written next to the
  document using the `officetools.pasterImgPath` template and inserted as Markdown.

**Saving & sync**

- The Markdown text document is the **single source of truth**. The webview never owns state;
  it sends Markdown back through a `WorkspaceEdit`, so:
  - native undo/redo and dirty-state work;
  - external edits (other editors, scripts) are reflected live;
  - `Ctrl/Cmd+S` and the toolbar Save button flush to disk.
- Writes are serialised (`MarkdownDocumentSync`) with a small debounce (400 ms) to avoid
  re-parsing storms.

**Context menu (right-click)**

- **AI Polish** (rewrite/improve the selection) — see §2.4.
- Copy, Copy as HTML, Copy as Plain Text, Paste, Insert Image.
- **Export PDF**, **Export PDF (without outline)**, **Export DOCX**, **Export HTML**.
- Show in Folder.

**Editor themes** (per the settings) apply to the editor chrome; CodeMirror and Mermaid
themes are configurable independently.

### 2.3 Commands & keybindings

| Command                    | Title                     | Default key                | When                                   |
| -------------------------- | ------------------------- | -------------------------- | -------------------------------------- |
| `office.markdown.switch` | Switch Markdown editor    | `Ctrl+Alt+E` / `⌘⌃E` | Markdown text editor focused           |
| `office.markdown.paste`  | Enhance paste in Markdown | `Ctrl+V` / `⌘V`       | Markdown text editor focused (desktop) |

`office.markdown.switch` is also offered from the editor title bar (the ✎ button) for
`.md`/`.markdown`. Internally it opens the file with `officetools.markdownEditor` (or back to
`default`).

### 2.4 AI Polish (Markdown)

From the right-click menu, **AI Polish** can improve a selection or the whole document. Two engines:

1. **VS Code Language Models** (default) — uses whichever chat model is available via the
   `vscode.lm` API. If none is available a warning is shown.
2. **Custom endpoint** — an OpenAI-, Anthropic-, Gemini- or Ollama-compatible HTTP API
   (URL, key, model, format). Streaming responses are written into the document as chunks.

This is the *only* AI feature in OfficeTools, and it is a Markdown-editor convenience — there
is **no MCP server, no Language-Model tool surface, and no agent API** in this extension.

### 2.5 Settings reference

All settings live under the `officetools.*` namespace.

**Markdown**

| Setting                                      | Type                  | Default                             | Meaning                                                                                    |
| -------------------------------------------- | --------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `officetools.editMode`                     | `wysiwyg` \| `ir` | `wysiwyg`                         | Default editing mode                                                                       |
| `officetools.editorTheme`                  | enum                  | `Auto`                            | Editor chrome theme (`Light`, `Solarized`, `One Dark`, `Dracula`, …)              |
| `officetools.codeMirrorTheme`              | enum                  | `Auto`                            | Code-block syntax theme                                                                    |
| `officetools.mermaidTheme`                 | enum                  | `Auto`                            | Mermaid diagram theme                                                                      |
| `officetools.restoreViewState`             | boolean               | `true`                            | Restore caret focus on open (scroll is always restored)                                    |
| `officetools.preventMacOptionKey`          | boolean               | `true`                            | Don't let the macOS Option key insert specials                                             |
| `officetools.workspacePathAsImageBasePath` | boolean               | `false`                           | Resolve relative images from the workspace root                                            |
| `officetools.pasteImageToWorkspacePath`    | boolean               | `false`                           | Write pasted images into the workspace with a leading`/`                                 |
| `officetools.pasterImgPath`                | string                | `image/${fileName}/${now}.${ext}` | Image path template (`workspaceDir`, `fileName`, `now`, `date`, `uuid`, `ext`) |

**Markdown → PDF export**

| Setting                       | Type     | Default | Meaning                                                    |
| ----------------------------- | -------- | ------- | ---------------------------------------------------------- |
| `officetools.chromiumPath`  | string   | `""`  | Path to a Chromium-based browser (auto-detected otherwise) |
| `officetools.puppeteerArgs` | string[] | `[]`  | Extra launch args (e.g.`["--no-sandbox"]`)               |
| `officetools.pdfMarginTop`  | integer  | `25`  | Top margin for the generated PDF                           |

**Telemetry** (currently disabled)

| Setting                         | Type    | Default  | Meaning                                                                    |
| ------------------------------- | ------- | -------- | -------------------------------------------------------------------------- |
| `officetools.enableTelemetry` | boolean | `false` | Anonymous usage events; also respects the global VS Code telemetry setting. **Inactive** — no connection string is configured, so nothing is ever sent |

---

## 3. Exporting from Markdown (user view)

`Export PDF / DOCX / HTML` runs in the **extension host**:

```
markdown.md ──► markdown-it (+plugins) ──► HTML (inlined CSS, KaTeX, Mermaid SVG)
                                         ├─► PDF   via puppeteer-core (Chrome/Chromium/Edge/Brave)
                                         └─► DOCX  via vscode-html-to-docx
                                         └─► HTML  via the HTML exporter
```

- **PDF** needs a Chromium-based browser. OfficeTools auto-detects common paths
  (Edge, Chrome, Chromium, Brave on Windows/macOS/Linux) and falls back to `chrome-finder`.
  Override with `officetools.chromiumPath`. On Linux-as-root, `--no-sandbox` args are added
  automatically.
- **PDF (without outline)** skips the PDF bookmark tree (post-processed with `pdf-lib`).
- **HTML** is fast and needs no browser.
- Export writes next to the `.md` file.

> If export fails, the message is logged to the **Office Viewer** output channel and an error
> toast appears — most often this is "no Chromium found".

---

## 4. Architecture (developer view)

### 4.1 High-level shape

```
VS Code Extension Host (Node)
├─ src/extension.ts                  desktop activate()
│   ├─ Global.init (i18n)            reads package.nls*.json
│   ├─ TelemetryService.init
│   ├─ FileUtil.init
│   ├─ MarkdownEditorProvider   ─┐  registers custom editors
│   └─ OfficeViewerProvider     ─┘
│
├─ MarkdownService                   export + clipboard-image helpers
└─ services/ (wiki links, settings, sync, AI)

Webview (sandboxed iframe)
├─ Markdown: resource/markdown/index.html  → dist/index.min.js (Vditor) + index.js (glue)
│            resource/lib/vscode.js        (postMessage bridge)
└─ PDF:      resource/pdf/viewer.html      → pdf.js + main.js (OfficeTools additions)
```

### 4.2 Two provider types

| Provider                   | VS Code interface                | File                                       | Why                                                                                      |
| -------------------------- | -------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `OfficeViewerProvider`   | `CustomReadonlyEditorProvider` | `src/provider/officeViewerProvider.ts`   | PDFs are binary/immutable — no text-document round trip needed                          |
| `MarkdownEditorProvider` | `CustomTextEditorProvider`     | `src/provider/markdownEditorProvider.ts` | Markdown is a real`TextDocument`; the editor must cooperate with undo/dirty/other tabs |

### 4.3 Entry points

- **Desktop:** `src/extension.ts` → `out/extension.js` (`package.json#main`).
- **Web:** `src/extension.web.ts` → `out/extension.web.js` (`package.json#browser`), chosen on
  `vscode.dev`/github.dev. Uses `setExtensionHostContext()` to flag web mode.

### 4.4 Source layout

```
src/
  extension.ts                     desktop entry
  extension.web.ts                 web entry
  provider/
    officeViewerProvider.ts        PDF custom (read-only) editor
    markdownEditorProvider.ts      Markdown custom (text) editor + host↔webview protocol
  service/
    markdownService.ts             export (pdf/docx/html) + clipboard image + editor switch
    viewerSettingsService.ts       shared per-workspace editor settings file
    telemetryService.ts            Application Insights wrapper (disabled in this build)
    officeViewType.ts              suffix → view-type/telemetry helpers
    autoClearCacheStorage.ts       one-shot legacy webview storage migration
    ai/customAIClient.ts           OpenAI/Anthropic/Gemini/Ollama streaming client
    ai/aiOutputLanguage.ts         language instruction for AI Polish
    markdown/
      documentSync.ts              serialise + debounce webview→TextDocument writes
      blockScroll.ts               webview registry + pending fragment scroll
      linkedFile.ts                "open linked file" with error reporting
      holder.ts                    last active TextDocument
      wikilink/**                  [[wiki]] parsing/resolution/opening
      ext/*.js                     markdown-it plugins (katex, mermaid, obsidian, front-matter)
      markdown-pdf.js              Markdown → HTML for export
      html-export.js               HTML / DOCX / PDF rendering
      outline.js                   PDF outline generation (pdf-lib)
      yamlProperties.js            front-matter properties panel
  common/
    global.ts handler.ts util.ts fileUtil.ts fileSuffix.ts extensionResource.ts
    webviewUri.ts workspaceFs.ts Output.ts simpleEventEmitter.ts extensionHost.ts
    vscode-nls-i18n/               runtime localisation (bundle loader)
  shims/                           Node built-in + package stubs for the web build
resource/
  pdf/**                           vendored pdf.js viewer (+ OfficeTools css/js additions)
  markdown/**                      prebuilt Vditor editor + OfficeTools glue
  lib/vscode.js                    webview↔host postMessage bridge
  sponsor/**                       small sponsor logos
template/                          HTML/CSS templates used by PDF/DOCX export
out/                               build output (git-ignored)
```

### 4.5 Webview ↔ host protocol

Everything flows through `resource/lib/vscode.js`, which wraps
`acquireVsCodeApi().postMessage`. The host side is `common/handler.ts` (`Handler`), which
attaches `panel.webview.onDidReceiveMessage` and exposes `.on(event, cb)` / `.emit(event, payload)`.

> **No `acquireVsCodeApi` outside webviews.** All host work is plain VS Code APIs.

#### PDF channel (`officetools.pdfViewer`)

| Direction       | Message                            | Payload                                                                       | Notes                                                                      |
| --------------- | ---------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| webview → host | `init`                           | –                                                                            | Sent once on`window.load`                                                |
| host → webview | `open`                           | `{ ext, path, fileName }` or `{ ext, fileName, buffer }` or `{ error }` | `path` = webview URL for real files; `buffer` = bytes for virtual docs |
| webview → host | `editInVSCode`                   | `full: boolean`                                                             | Reserved; handled by the host but not emitted by the bundled pdf.js viewer |
| webview → host | `developerTool`                  | –                                                                            | Toggle DevTools (also`F12`)                                              |
| webview → host | `openSponsor` / `openExternal` | url                                                                           | External links                                                             |
| host → webview | `fileChange` (internal)          | –                                                                            | Emitted by the file watcher bound in`Handler.bind`                       |

> **Critical invariant:** the viewer renders **nothing** until it receives `open`. The
> `init → open` handshake is the single most fragile part of the PDF path — see §9.1.

#### Markdown channel (`officetools.markdownEditor`)

| Direction       | Message                                                                                          | Payload                                                                                                                   | Notes                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| webview → host | `init`                                                                                         | –                                                                                                                        | Host replies with`open`                                                                            |
| host → webview | `open`                                                                                         | `{ content, rootPath, workspaceBaseUrl, documentCacheId, pendingFragment, shouldRestoreFocus, config, viewerSettings }` | Initial render (`fileName` is read by the webview but not sent upstream → falls back to `Note`) |
| webview → host | `save`                                                                                         | markdown                                                                                                                  | Debounced 400 ms write                                                                               |
| webview → host | `doSave`                                                                                       | markdown                                                                                                                  | Immediate write then`workbench.action.files.save`                                                  |
| host → webview | `update`                                                                                       | markdown                                                                                                                  | External/agent edit pushed in                                                                        |
| webview → host | `img` / `insertImage`                                                                        | image data / –                                                                                                           | Save image, reply`insertImageMarkdown`                                                             |
| host → webview | `insertImageMarkdown`                                                                          | `![…](…)`                                                                                                             | Insert into editor                                                                                   |
| webview → host | `export`                                                                                       | `{ type: 'pdf'\|'docx'\|'html', withoutOutline? }`                                                                        | Triggers`MarkdownService.exportMarkdown`                                                           |
| webview → host | `command`                                                                                      | command id                                                                                                                | e.g.`office.markdown.paste`                                                                        |
| webview → host | `openLink`                                                                                     | uri /`wiki:…`                                                                                                          | Resolve + open local/remote/URL                                                                      |
| host ↔ webview | `openLinkError`, `gotoBlock`, `markdownConfig`, `viewerSettings`, `viewerSettingsSync` | –                                                                                                                        | Links, config sync, settings sync                                                                    |
| webview → host | `editorTheme`, `codeMirrorTheme`, `mermaidTheme`, `editMode`                             | value                                                                                                                     | Persisted via`Global.updateConfig`                                                                 |
| webview → host | `syncViewerSettings`, `editViewerSettings`                                                   | settings                                                                                                                  | Shared editor settings file                                                                          |
| webview → host | `queryAIAvailable`, `queryVSCodeModels`, `aiPolish`, `aiPolishCancel`                    | –                                                                                                                        | AI Polish                                                                                            |
| host → webview | `aiAvailable`, `vscodeModels`, `aiPolishChunk`, `aiPolishEnd`                            | –                                                                                                                        | AI Polish streaming                                                                                  |
| webview → host | `telemetry`                                                                                    | `{ event, properties }`                                                                                                 | Telemetry (no-op while disabled)                                                                                    |
| webview → host | `editInVSCode`, `showInFolder`, `developerTool`, `openSponsor`, `openExternal`         | –                                                                                                                        | Standard actions                                                                                     |

### 4.6 Why the Markdown webview uses the TextDocument

`MarkdownEditorProvider` keeps the `vscode.TextDocument` authoritative:

1. webview `input` → `save` → `MarkdownDocumentSync` (serialise) → `WorkspaceEdit.replace`
   over the whole range, debounced 400 ms;
2. `onDidChangeTextDocument` → `externalUpdate` → pushes new text back to the webview
   (skipped if it is our own write-back, so the caret doesn't jump);
3. Because writes go through `WorkspaceEdit`, VS Code's native **Save / undo / dirty / hot-exit**
   and multi-view consistency all work for free.

`viewerSettingsService.ts` stores shared editor/viewer settings in a workspace file named
`.vscode-office-viewer.json` (name retained from upstream).

### 4.7 Wiki links

`src/service/markdown/wikilink/**` implements `[[Page]]`, `[[Page#Heading]]`, `[[Page|label]]`
and `![[embed]]`:

- `parse.ts` → `WikiLinkTarget`, `normalizePage`;
- `searchRoots.ts` / `fileSearch.ts` → find candidate files in the workspace;
- `resolve.ts` → pick the best match (extension-agnostic, heading-aware);
- `open.ts` → open with the correct editor, scrolling to `#fragment`.
  The webview converts `wiki:` hrefs into `openLink` messages; the host replies with
  `openLinkError` (rendered as a toast) when resolution fails.

---

## 5. PDF viewer deep dive

### 5.1 What is vendored

`resource/pdf/**` is a pdf.js viewer build plus OfficeTools styling/glue:

| File                                                              | Role                                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `viewer.html`                                                   | Shell,`<base href="{{baseUrl}}/">`, toolbar markup                                |
| `viewer.js`, `pdf.js`, `pdf.worker.js`                      | pdf.js runtime + worker                                                             |
| `viewer.css`, `viewer_adjust.css`                             | Base styles + OfficeTools overrides                                                 |
| `main.js`                                                       | **OfficeTools glue**: theming, sidebar resize, scale dropdown, open handshake |
| `locale/**`, `cmaps/**`, `standard_fonts/**`, `images/**` | pdf.js resources                                                                    |

### 5.2 The additions in `main.js`

1. **Theme adapt** — adds `office-adaptive-theme` to `<body>`; button `#themeAdaptToggle`;
   `Ctrl/Cmd+Shift+L`; persisted (`office-pdf-adaptive-theme`).
2. **Dark mode** — adds `office-dark`; button `#darkModeToggle`; `Ctrl/Cmd+L`; forces theme-adapt
   on; persisted (`office-pdf-dark-mode`).
3. **Custom scale dropdown** — rebuilds the page-scale `<select>` into a styled menu
   (`#scaleSelectContainer` / `#scaleSelectMenu`), keeping the native `<select>` as the model.
4. **Resizable sidebar** — `#sidebarResizer` pointer-drag resizes `--sidebar-width`, clamps to
   half the container, dispatches a pdf.js `resize` event, and persists width/open state.
5. **Open handshake** — on load: `vscodeEvent.on('open', openPdfDocument)` then
   `vscodeEvent.emit('init')`. `openPdfDocument` calls `PDFViewerApplication.open(...)` with the
   URL (`payload.path`) or bytes (`payload.buffer`).
6. **Defaults on `documentloaded`** — select tool, vertical scroll, no spread, restore sidebar.

### 5.3 The host side (`officeViewerProvider.ts`)

```ts
const handler = Handler.bind(webviewPanel, uri);
handler.on('init', sendOpen).on('fileChange', sendOpen).on('editInVSCode', …)…;
// sendOpen:
//   file:/vscode-remote:/vscode-vfs: → { path: webview.asWebviewUri(uri) }
//   anything else (git:, untitled:, …) → { buffer: Array.from(await fs.readFile(uri)) }
void this.loadPdfViewer(webview);   // reads viewer.html, substitutes {{baseUrl}}
```

`localResourceRoots` includes the extension root **and the PDF's folder**, so
`asWebviewUri` is permitted to serve the file.

---

## 6. Build & packaging

### 6.1 Build pipeline

```
npm run build  =  node build.ts --mode=production
```

`build.ts` (esbuild):

| Target  | Entry                    | Output                   | Platform      | Notes                                                                                          |
| ------- | ------------------------ | ------------------------ | ------------- | ---------------------------------------------------------------------------------------------- |
| Desktop | `src/extension.ts`     | `out/extension.js`     | node (cjs)    | all deps bundled,`vscode` external; copies `template/**` → `out/`                       |
| Web     | `src/extension.web.ts` | `out/extension.web.js` | browser (cjs) | Node built-ins +`puppeteer-core`/`chrome-finder`/`file-type` replaced by `src/shims/*` |

The desktop bundle is **self-contained** (≈8 MB) — no runtime `node_modules` needed, which is
why packaging uses `--no-dependencies`.

`out/template/template.html` and `out/styles/*.css` are produced from `template/` and are read
by the exporter via `__dirname`-relative paths.

### 6.2 Scripts

| Script                | Command                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `build`             | `node build.ts --mode=production`                                  |
| `watch`             | `node build.ts` (esbuild watch, dev)                               |
| `compile`           | `tsc --noEmit -p tsconfig.json`                                    |
| `package`           | `npx --yes @vscode/vsce package --no-dependencies`                 |
| `publish`           | `vsce publish --no-dependencies && ovsx publish --no-dependencies` |
| `vscode:prepublish` | `npm run build`                                                    |

### 6.3 Packaging

`.vscodeignore` excludes `src/`, `template/` (source), `node_modules/`, `build.ts`,
`**/*.ts`, maps and the vsix itself. The packaged extension ships:
`out/` (bundles + template/styles), `resource/` (pdf + markdown + lib + sponsor),
`package*.json`/`package.nls*.json`, `image/logo.png`, `telemetry.json`, `LICENSE`,
`README.md`, `THIRD_PARTY_NOTICES.md`.

> **Do not add `"type": "module"`** to `package.json`: `out/extension.js` is CJS and the Node
> warning from `build.ts` is harmless.

### 6.4 Running / debugging

- **F5** → *Run OfficeTools Extension* (`.vscode/launch.json`; `preLaunchTask: npm: build`).
- `npm run watch` for incremental host rebuilds; reload the extension host after changes.
- Webview debugging: `F12` / `Developer: Toggle Developer Tools` (the glue forwards `developerTool`).

---

## 7. Dependencies (runtime)

19 runtime deps, all bundled:

- **Editor runtime is vendored** — the PDF viewer (pdf.js) and Markdown editor (Vditor) are
  static assets under `resource/`, so most "editor" dependency cost is not in `node_modules`.
- Rendering for export: `markdown-it` (+ anchor, checkbox, front-matter, mark, obsidian-callouts,
  plantuml, toc-done-right), `highlight.js`, `katex`, `mermaid`, `mustache`, `node-html-parser`.
- Export: `puppeteer-core`, `chrome-finder`, `vscode-html-to-docx`, `pdf-lib`, `file-type`.
- Telemetry: `@vscode/extension-telemetry`.
- Dev-only: `esbuild`, `esbuild-plugin-copy`, `typescript`, `@types/node`, `@types/vscode`.

---

## 8. Compatibility & namespacing

To avoid clashing with `cweijan.vscode-office` and `officefiles` when installed side by side:

| Thing              | Value                           | Rationale                                 |
| ------------------ | ------------------------------- | ----------------------------------------- |
| PDF view type      | `officetools.pdfViewer`       | unique custom-editor id                   |
| Markdown view type | `officetools.markdownEditor`  | unique custom-editor id                   |
| Markdown preview   | `officetools.markdownPreview` | on-demand preview                         |
| Settings namespace | `officetools.*`               | unique settings                           |
| Activation         | `onCustomEditor:*` only       | no`onStartupFinished`; activates lazily |

Internal identifiers that were intentionally left as upstream names:

- the shared editor-settings file `.vscode-office-viewer.json`;
- PDF `localStorage` keys (`vscode-office.pdf.*`, `office-pdf-*`) — webview-scoped, harmless;
- a couple of CSS class names (`vscode-office-docx-image-shot`, etc.).

---

## 9. Known limitations & troubleshooting

### 9.1 PDF opens but shows **0 pages**  ✅ fixed

**Root cause:** the pdf.js page renders only after the host answers its `init` message with an
`open` payload. The trimmed provider originally never replied.
**Fix:** `officeViewerProvider.ts` now binds a `Handler` and replies on `init`/`fileChange`
(webview URL for real files, bytes for virtual documents). Verified by driving
`resolveCustomEditor` and simulating the webview `init`.

If it ever regresses, check, in order: (1) an `open` message is posted; (2) `pdf.worker.js`
loads (DevTools console); (3) `localResourceRoots` includes the PDF's folder.

### 9.2 Export PDF fails / "no Chromium"

Install a Chromium-based browser, or set `officetools.chromiumPath`. On Linux-as-root,
`--no-sandbox` is added automatically; add more via `officetools.puppeteerArgs`.

### 9.3 Clipboard image paste (`office.markdown.paste`)

The upstream helper shells out to `./lib/pc.ps1`, `./lib/mac.applescript`, `./lib/linux.sh`
at the extension root; those scripts are **not vendored** in OfficeTools. Practically, use
**drag-and-drop** or **Insert Image** (both work). The keybinding is harmless when the scripts
are absent.

### 9.4 Web (vscode.dev / github.dev)

`extension.web.ts` activates, but desktop-only features are hidden/disabled: clipboard paste
and PDF/DOCX export (the context-menu items are marked `--desktop-only` and gated by
`body.is-web`). Node-only helpers are shimmed in the web bundle.

### 9.5 Dev environment: `node_modules` symlink

During development `vscode-officetools/node_modules` may be a symlink to a sibling checkout to
speed up builds. It is git-ignored. For an isolated tree run a real `npm install` from the
trimmed `package.json`.

### 9.6 Worker / CSP

`viewer.html` runs the pdf.js worker from `resource/pdf/pdf.worker.js` via the page's `<base>`.
If you front the viewer with a stricter CSP, allow `worker-src`/`script-src` for the webview
origin.

### 9.7 Telemetry is disabled

`src/service/telemetryService.ts` ships with an **empty** `TELEMETRY_CONNECTION_STRING`, so
`TelemetryReporter` is never constructed and `trackViewOpen` / `trackEvent` are no-ops — nothing
is sent, even with `officetools.enableTelemetry` set to `true`. To enable it for a future
publisher account, set your own Application Insights connection string there (the upstream
`vscode-office` key has been removed).

---

## 10. Verification log

| Check              | Command                                                     | Result                                                                              |
| ------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Type-check         | `npx tsc --noEmit -p tsconfig.json`                       | clean                                                                               |
| Build              | `node build.ts --mode=production`                         | `out/extension.js` + `out/extension.web.js` + `out/template` + `out/styles` |
| Activate (desktop) | stub`vscode` harness                                      | `activate() OK` (7 subscriptions)                                                 |
| Activate (web)     | stub`vscode` harness                                      | `activate() OK` (6 subscriptions)                                                 |
| PDF handshake      | drive`resolveCustomEditor` + `init`                     | `open` emitted with correct path (file + virtual)                                 |
| Package            | `npx @vscode/vsce package --no-dependencies`              | `officetools-0.0.1.vsix` (359 files, ~7.4 MB)                                     |
| Install            | `code --install-extension officetools-0.0.1.vsix --force` | installed                                                                           |

---

## 11. Credits & licenses

- **vscode-office** (MIT, © Weijan Chen) — origin of the PDF viewer, Vditor Markdown editor,
  Markdown services, and the webview bridge. https://github.com/cweijan/vscode-office
- **pdf.js** (Apache-2.0) — PDF rendering.
- **Vditor** (MIT) — Markdown editing engine.
- **markdown-it** + plugins (MIT), **mermaid** (MIT), **katex** (MIT), **highlight.js** (BSD-3),
  **pdf-lib** (MIT), **node-html-parser** (MIT), **mustache** (MIT), **puppeteer-core** (Apache-2.0),
  **vscode-html-to-docx** (MIT), **file-type** (MIT), **chrome-finder** (MIT).

See `THIRD_PARTY_NOTICES.md` for the full list.

---

## 12. Notebook — decisions & change log

### 12.1 Extraction decisions

- **Kept only PDF + Markdown.** Everything else (agent/MCP surface, other formats, HTTP, Git,
  themes, syntaxes) removed to shrink surface area and maintenance.
- **Preferred dropping the agent layer entirely** (per product decision) rather than keeping
  `DocumentOps`/LM tools, so OfficeTools has no MCP server, no LM tool API, and no IPC bridge.
- **React/grid/vite removed.** The Markdown editor is the *vendored prebuilt Vditor* under
  `resource/markdown/**`; there is no webview bundler step anymore.
- **esbuild is the only build.** Simpler CI; the desktop bundle is self-contained.
- **Renamed view types + settings to `officetools.*`** to prevent collisions with the parent
  extensions when installed together.

### 12.2 Change log

| Commit      | Summary                                                                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ea8dbbd` | Add vscode-officetools: PDF + Markdown only viewer/editor extension (extraction, trimmed package.json/build/tsconfig/itignore, vendored`resource/`) |
| `eaf024f` | Use unique viewTypes +`officetools.*` settings namespace; remove `onStartupFinished`                                                              |
| `2b1df84` | **Fix PDF viewer stuck at 0 pages** — restore the `init → open` handshake in `officeViewerProvider`                                       |
| `f352418` | Add `tech-report-notebook.md` — user + developer reference for the PDF/Markdown extension                                                          |
| `19f8207` | Add local `.gitignore`; prune unused files (`resource/sponsor/`, `vscode.svg`, `ai-i18n.js`, dead `wikilink/fragment.ts`)                          |
| `fb9f988` | **Disable telemetry** — empty connection string (upstream key removed); `officetools.enableTelemetry` defaults to `false` and is a no-op for now   |

### 12.3 Open questions / possible next steps

- **Enable telemetry under our own publisher account** — supply our Application Insights
  connection string in `src/service/telemetryService.ts` and (optionally) flip
  `officetools.enableTelemetry` back to `true` when we publish (see §9.7).
- Optionally rename the shared settings file `.vscode-office-viewer.json` → `.officetools-viewer.json`
  (kept upstream name for compatibility).
- Optionally wire the clipboard-image scripts (or replace with the VS Code clipboard API).
- Optionally add a minimal smoke test for the Markdown `open`/`save` round-trip to CI
  (PDF is already covered by the harness in §10).
- Optionally expose a "render current page to image" command to complement PDF reading
  (out of scope today — no agent surface by design).

---

## Appendix A — File map (quick reference)

| Path                                            | Purpose                                              |
| ----------------------------------------------- | ---------------------------------------------------- |
| `src/extension.ts` / `src/extension.web.ts` | Register PDF + Markdown providers                    |
| `src/provider/officeViewerProvider.ts`        | PDF viewer host +`init→open` handshake            |
| `src/provider/markdownEditorProvider.ts`      | Markdown editor host + full protocol                 |
| `src/service/markdownService.ts`              | Export PDF/DOCX/HTML, clipboard image, switch editor |
| `src/service/viewerSettingsService.ts`        | `.vscode-office-viewer.json` settings              |
| `src/service/telemetryService.ts`             | Telemetry (disabled — ships without an endpoint)      |
| `src/service/ai/*`                            | AI Polish clients                                    |
| `src/service/markdown/**`                     | wiki links, sync, outline, export helpers            |
| `resource/pdf/**`                             | pdf.js viewer runtime + OfficeTools glue             |
| `resource/markdown/**`                        | prebuilt Vditor editor runtime                       |
| `resource/lib/vscode.js`                      | webview↔host bridge                                 |
| `template/**` → `out/**`                   | HTML/CSS for export                                  |
| `build.ts`                                    | esbuild build                                        |
| `package.json`                                | Manifest: contributions, settings, deps              |

## Appendix B — Manifest summary

```
name        officetools
displayName OfficeTools — PDF & Markdown viewers
version     0.0.1
publisher   officetools
engines     vscode ^1.94.0
main        out/extension.js
browser     out/extension.web.js
activation  onCustomEditor:officetools.markdownEditor
            onCustomEditor:officetools.pdfViewer
commands    office.markdown.switch, office.markdown.paste
keybindings Ctrl+Alt+E (⌘⌃E) switch · Ctrl+V (⌘V) paste (desktop)
customEditors officetools.markdownEditor (*.md, *.markdown, file/vfs/remote)
              officetools.pdfViewer    (*.pdf)
```

## Appendix C — PDF control id index (from `viewer.html`)

Navigation: `firstPage` `previous` `next` `lastPage` `pageNumber` · Zoom: `zoomOut` `zoomIn`
`pageFitOption` `pageWidthOption` `pageAutoOption` `pageActualOption` `customScaleOption`
`scaleSelect*` · Layout: `pageRotateCcw` `pageRotateCw` `scrollVertical` `scrollHorizontal`
`scrollWrapped` `spreadNone` `spreadOdd` `spreadEven` `presentationMode` · Cursor:
`cursorSelectTool` `cursorHandTool` · Find: `findbar` `findInput` `findPrevious` `findNext`
`findMatchCase` `findEntireWord` `findHighlightAll` `findResultsCount` · Sidebar:
`viewThumbnail` `viewOutline` `viewAttachments` `viewLayers` `sidebarToggle` `sidebarResizer` ·
Properties: `documentProperties*` (`titleField` `authorField` `subjectField` `keywordsField`
`creationDateField` `modificationDateField` `creatorField` `producerField` `versionField`
`pageSizeField` `linearizedField` `fileSizeField` `pageCountField`) · Files: `download`
`openFile` `print` · OfficeTools: `themeAdaptToggle` `darkModeToggle` `scaleSelectContainer`.
