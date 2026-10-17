# Contributing to OfficeTools

Thanks for helping improve **OfficeTools** — the VS Code extension that provides a PDF viewer
and a Markdown editor/preview. This guide is for anyone changing the code: how the project is
laid out, how to build and run it, the conventions it follows, and how to ship a change safely.

> **Scope of this extension.** OfficeTools is a focused fork of the MIT-licensed
> [`cweijan/vscode-office`](https://github.com/cweijan/vscode-office) that keeps **only PDF**
> and **Markdown**. It intentionally contains **no** MCP/agent surface, no other file formats
> (CSV/XLSX/DOCX/PPTX/EPUB/images/archives/…), and no icon/colour themes. Please keep it that
> way unless a change is explicitly about PDF or Markdown.

Related docs:

| Document | What it covers |
| --- | --- |
| `README.md` | What the extension does, high-level build/layout |
| `tech-report-notebook.md` | Deep reference: full message protocol, PDF/Vditor internals, settings, troubleshooting |
| `THIRD_PARTY_NOTICES.md` | Vendored/dependency licences |
| this file | Contributor workflow, conventions, verification, release |

---

## 1. Prerequisites

| Tool | Version used by this repo |
| --- | --- |
| Node.js | 18+ (the build uses ESM + esbuild `^0.28`); any current LTS works |
| npm | ships with Node |
| VS Code | `^1.94.0` (`package.json#engines.vscode`) — also the minimum you can debug against |
| Git | any recent version |
| Chromium-based browser | **optional**, only needed to test Markdown → PDF export (Chrome/Chromium/Edge/Brave) |

The extension is written in TypeScript and bundled with esbuild. There is no React app, no Vite
step, and no webview bundler — the PDF viewer and the Markdown editor are prebuilt assets under
`resource/`.

---

## 2. Get started

```bash
git clone https://github.com/mathelatics/vscode-sheetkit
cd vscode-sheetkit/vscode-officetools
npm install
npm run build
```

Then press **F5** in VS Code (`Run and Debug → "Run OfficeTools Extension"`). This launches an
Extension Development Host with the built extension loaded. The launch config runs `npm: build`
as a pre-launch task, so you don't have to build manually before pressing F5.

Open a `.pdf` or `.md` file in the new window to exercise the extension.

### Useful commands

| Command | What it does |
| --- | --- |
| `npm run build` | Production build: bundles `out/extension.js` + `out/extension.web.js`, copies `template/**` → `out/` |
| `npm run watch` | Dev build in watch mode (esbuild `context().watch()`) |
| `npm run compile` | Type-check only (`tsc --noEmit -p tsconfig.json`) — no output |
| `npm run package` | Produces `officetools-<version>.vsix` (runs the prepublish build) |
| `npm run publish` | Publishes to the VS Code Marketplace and Open VSX (maintainers only) |
| `npm run vscode:prepublish` | Wrapper that runs `npm run build` before packaging |

### Building one target during development

`build.ts` builds **both** desktop and web bundles in production, and **one** target in dev.
Control it with the `OFFICE_EXTENSION_TARGET` env var:

```bash
OFFICE_EXTENSION_TARGET=web node build.ts   # build/watch the web bundle only
node build.ts                               # default: build/watch the desktop bundle
```

Both dev runs use esbuild watch mode. Reload the Extension Development Host after a rebuild.

### Debugging the webview

The webviews are sandboxed iframes. Press **F12** inside a viewer (or run
`Developer: Toggle Developer Tools`) — the bridge forwards an `F12` keydown as a `developerTool`
message so the host opens DevTools. The host output (diagnostics, export errors) goes to the
**Office Viewer** output channel (`src/common/Output.ts`).

---

## 3. Repository layout

```
vscode-officetools/
├─ package.json                 manifest: contributions (editors, commands, settings), deps, scripts
├─ build.ts                     esbuild build for desktop + web bundles (the only build step)
├─ tsconfig.json                type-check config; path alias "@/*" -> "./src/*"
├─ .vscodeignore                what is excluded from the .vsix
├─ .vscode/
│  ├─ launch.json               "Run OfficeTools Extension" (extensionHost)
│  └─ tasks.json                npm: build (default) + npm: watch (background)
├─ src/
│  ├─ extension.ts              desktop entry (activate/deactivate)
│  ├─ extension.web.ts          web entry (vscode.dev / github.dev)
│  ├─ provider/
│  │  ├─ officeViewerProvider.ts      PDF CustomReadonlyEditorProvider
│  │  └─ markdownEditorProvider.ts    Markdown CustomTextEditorProvider (+ full message protocol)
│  ├─ service/
│  │  ├─ markdownService.ts           export PDF/DOCX/HTML, clipboard image, editor switch
│  │  ├─ viewerSettingsService.ts     shared editor settings file (.vscode-office-viewer.json)
│  │  ├─ telemetryService.ts          telemetry (currently DISABLED — empty connection string)
│  │  ├─ officeViewType.ts            file-suffix -> view-type/telemetry helpers
│  │  ├─ autoClearCacheStorage.ts     one-shot legacy webview storage migration
│  │  ├─ ai/                          AI Polish clients (VS Code LM + custom HTTP endpoints)
│  │  └─ markdown/                    wiki links, sync, outline, export helpers
│  ├─ common/                   Handler (message bridge), Global (config/i18n), file/webview utils
│  └─ shims/                    Node-builtin + package stubs for the web bundle
├─ resource/
│  ├─ pdf/**                    vendored pdf.js viewer (+ OfficeTools css/js additions)
│  ├─ markdown/**               prebuilt Vditor editor + OfficeTools glue
│  └─ lib/vscode.js             webview <-> host postMessage bridge
├─ template/**                  HTML/CSS templates used by the Markdown export (copied to out/)
├─ image/logo.png               extension icon
├─ tech-report-notebook.md      deep technical reference
└─ package.nls*.json            UI strings for i18n
```

Generated output (never commit): `out/`, `*.vsix`. See `.gitignore`.

---

## 4. Architecture

### 4.1 Entry points

| Entry | File | Registered in |
| --- | --- | --- |
| Desktop | `src/extension.ts` | `package.json#main` → `./out/extension.js` |
| Web | `src/extension.web.ts` | `package.json#browser` → `./out/extension.web.js` |

Both call `Global.init(context)` (sets up config + i18n), then register the same providers. The
web entry additionally calls `setExtensionHostContext()` (sets the `office.extensionHost.web`
context key) and passes `{ isWeb: true }` to the Markdown provider.

`activate()` registers:

```ts
vscode.commands.registerCommand('office.markdown.switch', uri => markdownService.switchEditor(uri))
vscode.commands.registerCommand('office.markdown.paste',  () => markdownService.loadClipboardImage())
vscode.window.registerCustomEditorProvider('officetools.markdownEditor',  markdownEditorProvider, viewOption)
vscode.window.registerCustomEditorProvider('officetools.markdownPreview', markdownEditorProvider, viewOption)
...viewerInstance.bindCustomEditors(viewOption)   // registers 'officetools.pdfViewer'
```

### 4.2 Verified identifiers

Do **not** rename these without checking both `package.json` and the code — they are the public
contract.

| Kind | Identifier | Declared in |
| --- | --- | --- |
| PDF view type | `officetools.pdfViewer` | `contributes.customEditors`, `activationEvents`, `officeViewerProvider.bindCustomEditors` |
| Markdown view type | `officetools.markdownEditor` | `contributes.customEditors`, `activationEvents`, `extension.ts` |
| Markdown preview view type | `officetools.markdownPreview` | registered in code only (not in `contributes`) |
| Command | `office.markdown.switch` | `contributes.commands` (+ `editor/title` menu, `ctrl+alt+e` / `Ctrl+Cmd+E`) |
| Command | `office.markdown.paste` | `contributes.commands` (+ `ctrl+v` / `cmd+v`, desktop only) |
| Settings prefix | `officetools.*` | `contributes.configuration` + `Global.getConfig` (`prefix = 'officetools'`) |
| Context key | `office.extensionHost.web` | set by `setExtensionHostContext()` |

### 4.3 The two provider types (and why)

| Provider | Interface | Concept |
| --- | --- | --- |
| `OfficeViewerProvider` | `vscode.CustomReadonlyEditorProvider` | PDFs are binary and immutable — there is no `TextDocument` round trip. It serves the pdf.js viewer and answers the viewer's `init` with `open`. |
| `MarkdownEditorProvider` | `vscode.CustomTextEditorProvider` | Markdown is a real `TextDocument`. The provider keeps VS Code's built-in Save/undo/dirty/multi-tab behaviour by writing edits through `WorkspaceEdit`. |

### 4.4 The message bridge

All webview ↔ host traffic goes through one small abstraction.

**Webview side** (`resource/lib/vscode.js`) exposes `window.vscodeEvent` / `window.handler`:

```js
handler.emit('save', markdown)          // -> postMessage({ type: 'save', content: markdown })
handler.on('open', md => { /* render */ })
```

**Host side** (`src/common/handler.ts`):

```ts
const handler = Handler.bind(webviewPanel, uri);
handler.on('save', content => { /* ... */ });
handler.emit('update', text);           // -> postMessage({ type: 'update', content: text })
```

Wire shape: `{ type: string, content?: any }`. Details worth knowing:

- `Handler.bind` also emits `fileChange` (filesystem watcher) and `externalUpdate`
  (`onDidChangeTextDocument`) automatically, and emits `dispose` when the panel is disposed.
- `handler.emit` becomes a no-op after dispose (guards against posting to a dead webview).
- `handler.on(type, cb)` **replaces** any previous listener for the same `type` (except `init`),
  so registering the same message twice does not double-handle it.
- Callback exceptions are logged to the Office Viewer channel and surfaced as an error toast.

The **PDF handshake** is the one invariant to remember: the viewer emits `init` on load and
renders nothing until the host replies with `open` (a webview URL for on-disk files, or the raw
bytes for virtual documents). Breaking this leaves the viewer stuck at "0 pages".

The Markdown provider's message names (host side) are documented in full in
`tech-report-notebook.md` §4.5; read it before adding a message so you match naming.

### 4.5 Markdown ↔ TextDocument sync

`MarkdownEditorProvider` treats the `TextDocument` as the **single source of truth**:

1. Webview `input` → `save` → `MarkdownDocumentSync` → `WorkspaceEdit.replace` (debounced 400 ms).
2. `onDidChangeTextDocument` → `externalUpdate` → pushed back to the webview, unless it is our
   own write-back (`documentSync.isWriteback`) or unchanged — this prevents cursor resets.
3. Because the write goes through `WorkspaceEdit`, undo/redo, dirty state, and multiple views
   work for free.

Do not let the webview hold authoritative state; always round-trip through the document.

### 4.6 Services

| Service | Responsibility |
| --- | --- |
| `MarkdownService` | Export to PDF/DOCX/HTML, clipboard-image paste, `switchEditor` |
| `ViewerSettingsService` | Shared per-workspace editor settings file `.vscode-office-viewer.json` |
| `TelemetryService` | Application Insights wrapper — **disabled** (empty connection string) |
| `blockScroll` / `documentSync` / `linkedFile` / `holder` | Webview registry, write serialization, link opening, active-doc tracking |
| `wikilink/**` | `[[Page]]`, `[[Page#heading]]`, `[[Page\|label]]`, `![[embed]]` resolution + open |
| `ai/**` | AI Polish via VS Code Language Models or a custom OpenAI/Anthropic/Gemini/Ollama endpoint |

### 4.7 The web (browser) build

`src/extension.web.ts` runs on `vscode.dev` / `github.dev`, where Node built-ins and desktop-only
packages are unavailable. `build.ts` swaps them for stubs in `src/shims/`:

- Node built-ins (`fs`, `os`, `path`, `child_process`, `assert`, `url`, …) → `src/shims/*.ts`.
- `puppeteer-core`, `chrome-finder`, `file-type` → `src/shims/*.ts`.
- `markdown/markdown-pdf` and `markdown/html-export` → `src/shims/markdown-pdf.ts`.

If you import a new Node-only module, add a matching shim and a `build.onResolve` rule, or the
web build will fail. Features that cannot work on the web (clipboard scripts, PDF/DOCX export)
are gated with `!office.extensionHost.web` and `body.is-web` in the webview.

---

## 5. Conventions

Follow the surrounding code; these are the rules that are easy to get wrong.

**Code**
- TypeScript, no framework. Reuse `Handler`, `Global`, `FileUtil`, `Output`, `Util`.
- Import from `src/` with the `@/` alias (e.g. `import { Handler } from '@/common/handler'`).
  The alias is defined in `tsconfig.json` and resolved by esbuild via `tsconfig` paths.
- Prefer `vscode.workspace.fs` over Node `fs` in extension code (works on remote/virtual
  filesystems and in the web host).
- Never read a path supplied by a webview for privileged operations. Resolve the document URI in
  the host from the provider's `document.uri`, then use VS Code filesystem APIs.
- Keep `out/extension.js` CommonJS: **do not** add `"type": "module"` to `package.json`. The ESM
  warning printed by `build.ts` is harmless.

**Identifiers**
- View types: `officetools.<thing>`.
- Commands: `office.<area>.<action>`.
- Settings: `officetools.<camelCase>`.
- Message types: `camelCase` verbs matching existing names (`save`, `doSave`, `openLink`,
  `insertImage`, `export`, …). Add to both the webview and the host.

**i18n**
- User-facing strings come from `package.nls.json` (+ locale files) and are read with
  `i18n('some.key', ...args)` from `@/common/global`. Placeholders use `$1`, `$2`, ….

**Errors**
- Log diagnostics with `Output.debug(err)` / `Output.log(err)` (the "Office Viewer" channel).
- Show actionable toasts via `vscode.window.showErrorMessage(...)`.

### Recipe: add a new webview message

1. Webview (`resource/markdown/index.js` or `resource/pdf/main.js`): `handler.emit('myAction', payload)`.
2. Host (`markdownEditorProvider.ts` / `officeViewerProvider.ts`):
   `handler.on('myAction', async payload => { ... })`.
3. If the host must reply, `handler.emit('myActionResult', result)` and add
   `handler.on('myActionResult', ...)` on the webview.
4. Type the payload and validate it (view types and payloads are untyped over `postMessage`).

### Recipe: add a setting

1. Add the property under `contributes.configuration` in `package.json` (`officetools.*`).
2. Read it with `Global.getConfig<T>('mySetting', defaultValue)` (or the local
   `vscode.workspace.getConfiguration('officetools')` in the provider).
3. If the webview needs it live, include it in the `open` payload and/or broadcast a
   `markdownConfig` patch via `MarkdownEditorProvider.registerConfigSync` (see
   `MARKDOWN_SYNC_CONFIG_KEYS`).

---

## 6. Testing & verification

> **Current state:** there is **no automated test framework** in this repository — no Jest/
> Vitest/Mocha config, no `test/` directory, and no `test` npm script. Do not assume otherwise.
> Verification today is compile + build + manual/scripted checks. If you add a test framework,
> keep it dependency-light and document how to run it here.

Run these before opening a PR:

```bash
npm run compile     # must be clean
npm run build       # must succeed (both bundles)
npm run package     # produces the .vsix; confirm it succeeds
```

### Manual regression checklist

PDF:

- [ ] Open a PDF — it renders (not stuck at "0 pages").
- [ ] Navigate pages, zoom, rotate, scroll modes, find, sidebar/thumbnails/outline.
- [ ] Toggle theme-adapt and dark mode; resize the sidebar.

Markdown:

- [ ] Open, edit, and save a `.md` file (toolbar Save and `Ctrl/Cmd+S`).
- [ ] Undo/redo works; dirty indicator behaves; a second view stays in sync.
- [ ] Edit the file in the plain text editor and confirm the webview updates.
- [ ] Export to HTML (and PDF, if a Chromium is available) from the context menu.
- [ ] Wiki links and file links open the target; broken links show a toast.

Also confirm the web bundle still activates logically (no new Node-only import without a shim).

### Safe testing patterns

- Automate host logic with a small `vscode` stub and `require('./out/extension.js')` when
  possible (this is how the PDF `init → open` handshake was verified). Keep such harnesses out
  of the packaged extension.
- Never assert OCR/export/render correctness from a successful API call alone — inspect the
  actual output artifact.

---

## 7. Packaging & release

```bash
npm run package     # -> officetools-<version>.vsix
```

`npm run package` runs `@vscode/vsce package --no-dependencies`. `--no-dependencies` is required
because the desktop bundle is self-contained (esbuild inlines all runtime deps), so the VSIX does
not ship `node_modules`.

`.vscodeignore` controls the artifact. It excludes `.vscode/**`, `src/**`, `template/**`,
`node_modules/**`, `build.ts`, `**/*.ts`, `**/*.map`, `*.vsix`, `package-lock.json`, and
`CONTRIBUTING.md`, while keeping `out/**`, `resource/**`, `package.nls*.json`, `LICENSE`,
`README.md`, `image/logo.png`, and `telemetry.json`.

Release checklist:

1. Bump `version` in `package.json`.
2. `npm run compile && npm run build && npm run package`.
3. Install and smoke-test the `.vsix`
   (`code --install-extension officetools-<version>.vsix --force`).
4. Commit (source + docs only; `out/` and `*.vsix` are git-ignored).
5. Publish (`npm run publish`, maintainers).

---

## 8. Configuration reference (short)

Settings live under `officetools.*`. The full table is in `tech-report-notebook.md` §2.5.
Groups:

- **Markdown** — `editMode`, `editorTheme`, `codeMirrorTheme`, `mermaidTheme`,
  `restoreViewState`, `preventMacOptionKey`, `workspacePathAsImageBasePath`,
  `pasteImageToWorkspacePath`, `pasterImgPath`.
- **Markdown PDF** — `chromiumPath`, `puppeteerArgs`, `pdfMarginTop`.
- **Telemetry** — `enableTelemetry` (default `false`; currently a no-op — see §9).

---

## 9. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| PDF opens but shows **0 pages** | The host is not answering the viewer's `init` with `open`. Check `officeViewerProvider.ts` `handler.on('init', …)` and that `localResourceRoots` includes the PDF's folder. |
| PDF styles/scripts 404 | Wrong `{{baseUrl}}` substitution or a `viewer.html`/resource path mismatch. |
| Export PDF fails / "no Chromium" | Install a Chromium-based browser or set `officetools.chromiumPath`. On Linux-as-root, `--no-sandbox` is added automatically; add more via `officetools.puppeteerArgs`. |
| Clipboard image paste does nothing | The upstream helper scripts (`lib/pc.ps1`, `lib/mac.applescript`, `lib/linux.sh`) are **not** vendored. Use drag-and-drop or **Insert Image** instead. |
| `build.ts` prints a `MODULE_TYPELESS_PACKAGE_JSON` warning | Harmless. Do **not** add `"type": "module"` — the extension bundle must stay CJS. |
| Web build fails on a Node import | Add a shim in `src/shims/` and a resolve rule in `build.ts`. |
| `node_modules` is a symlink to a sibling checkout | Development shortcut in this workspace; it is git-ignored. For an isolated tree, run a real `npm install`. |
| Telemetry seems inert | It is — `telemetryService.ts` ships with an empty connection string, so nothing is sent even with the setting on. |
| Changed code but the dev host looks stale | Rebuild, then **Developer: Reload Window** in the Extension Development Host. |

---

## 10. Contribution workflow

1. Branch off `main` (`feature/<short-name>` or `fix/<short-name>`).
2. Make focused changes; keep unrelated refactors out of the PR.
3. Run `npm run compile && npm run build && npm run package` and the manual regression list (§6).
4. Update docs when behaviour, settings, or messages change (`README.md`,
   `tech-report-notebook.md`, and this file).
5. Commit with a clear, imperative message. Scope it, e.g.:

   ```
   officetools: fix PDF viewer stuck at 0 pages

   Restore the init -> open handshake in officeViewerProvider ...
   ```

6. Open a PR describing what changed, why, how you verified it, and any known limitations.

Do not commit `out/`, `*.vsix`, or any secrets/keys.

---

## 11. Licence & credits

OfficeTools is MIT-licensed. The PDF viewer and Markdown editor are vendored/adapted from the
MIT-licensed `cweijan/vscode-office`; pdf.js is Apache-2.0 and Vditor is MIT. See
`THIRD_PARTY_NOTICES.md` and `LICENSE`. By contributing you agree your changes are licensed
under the project's MIT licence.
