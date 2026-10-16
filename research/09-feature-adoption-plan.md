# 09 — Feature Adoption Plan: what to take from vscode-office, and how

Turns the raw marketplace dump (formats · commands · custom editors · settings · themes) into a
**decisive, prioritized build list** for our `vscode-officefiles` extension.

We adopt the **breadth + polish** that makes Office Viewer feel like a real product, but implement it
through our own **ops-first, agent-editable** architecture (research/04, 05). We copy assets/code patterns
from `rough/vscode-office/` where MIT-licensed, and **rewrite** anything that conflicts with our design.

---

## 1. Snapshot — where each project stands

| Dimension | vscode-office (reference, MIT) | officefiles (ours, today) |
|---|---|---|
| Formats | ~40 (xls/xlsx/xlsm/csv/ods/tsv, docx/dotx, pptx/pptm, pdf/epub, ttf/otf/woff, svg, icns, psd, xmind, heic/tiff, zip/7z/tar/rar/apk/jar/vsix/crx, parquet, .class, html, md, http) | ~12 working / more scaffolded (csv/tsv/md/json grids; xlsx/docx/pptx/epub via ooxml; pdf/image/archive preview) |
| Editing | Markdown (vditor) real; CSV via switch command; docx/xlsx emerging | **all text formats editable via IR**; xlsx write in progress; agent-edit path built |
| Agent surface | none (raw LLM HTTP call for md assist only) | **MCP (in-IDE + standalone) + LM tools + commands** ✅ our differentiator |
| Event bus | single-listener `{type,content}` | versioned multi-subscriber `DocBus` ✅ |
| Activation | `onStartupFinished` (eager) | `onCustomEditor:` + `onStartupFinished` (lazy target) ✅ |
| Themes / icons | ships One Dark Modern ×2 + Material Icon Theme; syntaxes+snippets | none yet ❌ |
| i18n | 10 `package.nls*.json` locales | none ❌ |
| Templates | blank docx/xlsx/pptx in `template/` | none ❌ |
| HTTP client / Git history | full `.http` runner + Git graph | none (out of current scope) |

---

## 2. Decision principles

1. **Differentiator first.** Agent-editable + MCP is our reason to exist; every format we ship should be
   reachable by the ops service, not just renderable.
2. **Parity for what users open daily** (xlsx/csv/md/docx/pdf/images) beats exotic formats.
3. **Cheap perceived quality wins first** — selectors, view-type switching, icon theme, editor switch
   commands cost hours and remove most "feels unfinished" complaints.
4. **Copy assets, rewrite logic.** Theme JSON, icon SVGs, syntaxes, snippets are safe to copy (MIT).
   Viewers/providers we rewrite against `DocumentOps` so agents get the same capabilities.
5. **No Node-only deps in phase 1** where a pure-JS path exists (web/vscode.dev keeps working).

---

## 3. Adoption matrix

Legend: **P0** = build next (parity-critical), **P1** = high value / differentiator, **P2** = breadth,
**Later** = roadmap, **Skip** = deliberate no.

### P0 — Foundation, coverage & "not missing anything" UX

| # | Feature (from reference) | Decision | How |
|---|---|---|---|
| P0-1 | Full `contributes.customEditors` **selector matrix** incl. `file:`, `vscode-vfs:`, `vscode-remote:`, `vsls:` schemes | **Adopt (copy)** | Extend `package.json` selectors; add all missing extensions. Research/01 notes remote/vfs support is essential. |
| P0-2 | **Per-format view types** so "Open With…" lets users choose editor (`officeViewer/htmlViewer/imageViewer/parquetViewer`) | **Adopt** | We already multiplex; add `priority: option` to every viewer and document the list. |
| P0-3 | **Editor switch commands** `office.csv.switch`, `office.markdown.switch` (grid ↔ text) | **Adopt (rewrite names)** | Register `officefiles.csv.switch` / `officefiles.markdown.switch` toggling `vscode.openWith` between our custom editor and `default` text editor. Highest-value missing command. |
| P0-4 | **Real, offline PDF viewer** (reference bundles pdf.js) | **Adopt (rewrite)** | Replace our CDN `<iframe>` + 2 MB cap (binaryPreview.ts:50) with bundled `pdfjs-dist` served from `localResourceRoots` — works offline/webview CSP-safe. |
| P0-5 | **Image viewer** w/ zoom/rotate/background + SVG export | **Adopt** | Promote `binaryPreview` image path to a small webview with toolbar; add `.apng/.cur/.pjpeg/.pjp/.avif`. |
| P0-6 | **Icon theme + color themes** shipped by the extension | **Adopt (copy assets)** | Copy `theme/material-icons.json` + onedark jsons and register under `contributes.iconThemes/themes`. Material Icon Theme is MIT — verify upstream NOTICE. |
| P0-7 | **Settings for editor UX**: `editMode` (wysiwyg/source), `editorTheme`/`codeMirrorTheme` Auto, `restoreViewState`, `pasteImageToWorkspacePath`, `pasterImgPath`, `preventMacOptionKey` | **Adopt** | Add to `contributes.configuration` under `officefiles.*`; wire into webview config injection (our `window.__OFFICEFILES__`). |
| P0-8 | **Command menu/keybinding wiring** (`editor/title`, `editor/context`, `explorer/context`, keys Ctrl+Shift+V etc.) | **Adopt** | Mirror reference `menus`/`keybindings` with `officefiles.*` ids. |
| P0-9 | **Templates** for new blank office files (`template/` blank docx/xlsx/pptx) | **Adopt (copy assets)** | Add `officefiles.newFile` command + copy blank templates. |

### P1 — Differentiator depth & daily-format editing quality

| # | Feature | Decision | How |
|---|---|---|---|
| P1-1 | **Markdown WYSIWYG** (reference uses vditor: paste-image, mermaid, katex, CodeLens, wikilinks) | **Adopt (adapt)** | Keep our TextDocument-backed sync (better than theirs, research/03) and either vendor vditor (MIT) or implement the same feature set in our CM view. Non-negotiable: paste-image writes via `workspace.fs` then inserts link (settings P0-7). |
| P1-2 | **XLSX full grid** (multi-sheet, formulas display, styles, charts) | **Adopt (adapt)** | Grow `ooxmlService` + webview grid; reference routes xlsx/csv/ods through one SheetJS view — we keep IR + write. Supports `.xlsm/.ods` after. |
| P1-3 | **DOCX paragraph editor** (their ProseMirror/docx-editor-react) | **Adopt (adapt)** | We already have `parseOoxml`/write tombstones; expose blocks as editable, keep round-trip tests. |
| P1-4 | **HTTP/REST client** (`.http/.rest`: run, variables, env, redirect, preview) | **Adopt (adapt)** | Copy `provider/http/*` patterns (axios host-side, response to webview) + the reference settings (`followredirect`, `logLevel`, `environmentVariables`, `previewOption/Column`, `decodeEscapedUnicodeCharacters`, `formParamEncodingStrategy`). Also expose `officefiles.http.request` as an **agent tool**. |
| P1-5 | **Export / convert**: md→html/pdf (print), csv↔xlsx, docx→md | **Adopt** | Webview print-to-PDF by default; optional `puppeteerArgs`/`chromiumPath` settings for headless. Pure-web fallback must exist. |
| P1-6 | **Additional text formats**: `.ods`, `.xlsm`, `.dotx`, `.pptm`, YAML/XML tree editors | **Adopt** | Routes into existing codecs/engines; XML/YAML use same grid/tree provider. |
| P1-7 | **i18n scaffolding** (`package.nls.json` + `%key%`, webview dictionary) | **Adopt** | Start with en + the reference locale keys copied as a base; ship zh-cn next. |
| P1-8 | **HTML live preview** (`office.html.preview`, Ctrl+Shift+V) | **Adopt** | Serve sibling assets via `localResourceRoots` (reference pattern) + live reload via watcher. |

### P2 — Breadth viewers (copy patterns, lower ROI)

| Feature | Decision | Note |
|---|---|---|
| Font viewer `.ttf/.otf/.woff/.woff2` (opentype.js) | Adopt later | Copy `fontViewer` pattern; pure-JS. |
| PSD layers (`ag-psd`), XMind (`mind-elixir`), ICNS | Adopt later | Self-contained viewers; can be readonly. |
| Parquet (`hyparquet` + writer) | Adopt later | Reference parses host-side (memory guard) — reuse that idea. |
| HEIC/HEIF/TIFF (`.heic/.heif/.tiff/.tif`) | Adopt later | `heic2any`/`utif`; needed for iPhone photos. |
| Archives `.7z/.rar/.tar/.tar.gz/.tgz/.apk/.crx` | Adopt later | We have zip central-dir listing; 7z-wasm/tar add the rest. |
| Java `.class` decompiler | **Skip** | Needs a JVM/decompiler; niche. |
| Git History visualizer + Quick Sync | **Skip (for now)** | Orthogonal to office editing; large surface (`src/gitHistory/*`). Revisit if users ask. |
| Custom LLM HTTP client (`service/ai`) | **Skip** | Superseded by our MCP/LM-tools agent surface. |
| Telemetry (`@vscode/extension-telemetry`) | **Adopt (minimal, opt-in)** | Keep `officefiles.enableTelemetry`, honor VS Code global level (reference does this). |

---

## 4. Assets safe to copy (with MIT attribution)

Copy verbatim, keep upstream `LICENSE`/attribution in `THIRD_PARTY_NOTICES.md`:

- `rough/vscode-office/theme/material-icons.json` — Material Icon Theme (verify upstream MIT/NOTICE).
- `rough/vscode-office/theme/onedark-modern*.json` — color themes.
- `rough/vscode-office/syntaxes/*`, `snippets/*` for `http/kotlin/kusto/nginx/reg/toml`.
- `rough/vscode-office/template/*` blank docx/xlsx/pptx.
- `rough/vscode-office/icons/*.svg` (file-type icons) — sub-select the ones we reference.

**Rewrite, don't copy:** `src/provider/*`, `src/service/*`, `src/react/view/*` (viewer logic) — they
hardcode the single-listener bus and readonly model we deliberately replaced.

---

## 5. Issues found in the pasted listing (rewrite/clarify)

- **Duplicate `.apng`** in `cweijan.imageViewer` selector → dedupe.
- **`toml` extensions show `*.toml.`** (trailing dot typo) → correct to `.toml`.
- `nginx` patterns mix bare names (`nginx.conf`, `mime.types`) with `.conf*` — keep explicit filenames.
- Our `binaryPreview` PDF path uses a **CDN + 2 MB inline cap** (binaryPreview.ts:50–65) → replace with
  bundled pdf.js (P0-4); this is the clearest "issue" to fix.
- Reference `package.json` `contributes.configuration` has **0 properties** while the marketplace lists
  ~22 settings → settings likely come from a `capabilities`/unpacked path; when we copy settings we define
  them explicitly under `officefiles.*`.
- Reference activation is eager `onStartupFinished` even though it registers custom editors → we keep
  `onCustomEditor:` events and only add eager activation for MCP registration.

---

## 6. Mapping to milestones (extends research/05 §Milestones)

| Milestone | Add |
|---|---|
| **M1.5 (new, do now)** | P0-1/2/3/6/7/8/9 — selectors, view-type choice, switch commands, themes+icon theme, settings, menus, templates. Fast coverage win. |
| **M2** | P0-4/5 offline PDF + image toolbar; P1-8 HTML preview. |
| **M3** | Extend agent surface to every new format (MCP tool per capability). |
| **M4** | P1-1 Markdown WYSIWYG + P1-2 XLSX grid + P1-3 DOCX editing. |
| **M5** | P1-5 export/convert, P1-6 extra formats, P1-7 i18n, a11y + grid keyboard nav. |
| **M6** | P1-4 HTTP client (with agent tool), then P2 breadth viewers. |

---

## 7. Recommended immediate actions (in order)

1. **P0-1/P0-2** — expand `package.json` `customEditors` selectors to the full matrix with vfs/remote
   schemes; set every viewer to `priority: option`.
2. **P0-3** — implement `officefiles.csv.switch` and `officefiles.markdown.switch` commands.
3. **P0-6** — copy theme + icon-theme assets and register contributions (+ `THIRD_PARTY_NOTICES.md`).
4. **P0-7/P0-8** — add editor settings + menus/keybindings; wire settings into webview config injection.
5. **P0-4** — replace CDN PDF with bundled `pdfjs-dist` served offline.
6. Then start P1-1/P1-2 (markdown WYSIWYG, xlsx grid) — the two biggest UX differentiators.

> Success test for "no lack of features": a user can open `.xlsx`, `.md`, `.docx`, `.pdf`, `.png`, `.zip`
> and each opens in a polished, themed viewer; every text format is switchable back to raw text; and an
> agent can read/edit the same open document through MCP.
