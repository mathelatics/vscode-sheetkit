# 10 — Human & Agent Capability Report

What the OfficeFiles extension provides **today**, described from two audiences:

- **Humans** — read and write files through rich viewers/editors (the visual interface).
- **Agents** — read and write the same files efficiently through structured, typed operations (commands, VS Code LM tools, and MCP).

The report is deliberately honest about boundaries: it separates what is **read/write**, what is **read-only**, and what is **preview-only**.

---

## 1. The thesis

> One operations core over office/document files. Agents drive it programmatically; humans drive it visually; both act on the same live state — same undo stack, same validation.

Capability is **defined once** (`DocumentIR` + `EditOp` + the `ops` registry + the codec registry) and **exposed twice**:

```
                     ┌─────────────────────────────────────────┐
                     │            CAPABILITY CORE               │
                     │  core/ir.ts   core/codecs/*   host/ops   │
                     │  (IR, EditOp, parse/serialize, ops)      │
                     └───────────────┬─────────────┬───────────┘
                                     │             │
                 HUMAN SURFACES      │             │      AGENT SURFACES
        ┌────────────────────────────┘             └───────────────────────────┐
        │  Custom editors (webviews):              │  Commands (officefiles.agent.*)
        │   xlsx/csv/tsv grid, markdown, docx,     │  VS Code LM tools (#officefiles*)
        │   pptx, pdf, epub, image, archive,       │  In-IDE MCP  (contributes.mcpServerDefinitionProviders)
        │   font, svg, psd, parquet, html, ...     │  External MCP (stdio: standalone / ipc-proxy)
        └──────────────────────────────────────────┴───────────────────────────┘
```

This is the key differentiator: the human UI and the agent tools are **not two separate products** — they are two front doors onto the *same* operations service. An agent edit lands in the human's undo stack; a human save is visible to the agent.

---

## 2. Architecture at a glance

| Layer              | Location                                                                         | Responsibility                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| IR + edit ops      | `src/core/ir.ts`                                                               | Format-agnostic document model + typed`EditOp`s. No `vscode` imports — reusable by host, webview, headless, MCP. |
| Codecs             | `src/core/codecs/*`                                                            | `csv`/`tsv`, `markdown`, `json`, and OOXML (`xlsx`, `docx`), plus read-only `pptx`/`epub` parsers.    |
| Format registry    | `src/core/codecs/registry.ts`                                                  | Single source of truth: extension → codec + editor + capability.                                                     |
| Ops service        | `src/host/ops/documentOps.ts`                                                  | The one capability registry used by every surface.                                                                    |
| OOXML host service | `src/host/ops/ooxmlService.ts`                                                 | Binary read/write (JSZip) kept in the extension host.                                                                 |
| Agent surface      | `src/host/ops/agentSurface.ts`                                                 | Commands + VS Code LM chat tools.                                                                                     |
| MCP                | `src/host/mcp/*`                                                               | In-IDE provider, headless stdio server, live IPC proxy, config helper.                                                |
| IPC bridge         | `src/host/ipc/bridge.ts`                                                       | Live-edit socket so external clients drive the open editors.                                                          |
| Human viewers      | `src/react/**`, `src/provider/**` (vendored, MIT) + `src/host/providers/*` | Custom editors / webviews.                                                                                            |

---

## 3. The shared capability core

### 3.1 Intermediate Representation (`src/core/ir.ts`)

Two document shapes, both JSON-serializable so they can cross an agent transport:

- **Table documents** — `TableDocIR { kind: 'table'; sheets: SheetIR[] }`, where a sheet is row-major `CellValue[][]` (`string | number | boolean | null`), ragged rows allowed.
- **Document documents** — `DocIR { kind: 'document'; blocks: BlockIR[] }`, with block types `paragraph | heading | list | code | quote | image | table`.

Internal side-channels (`__xml`, `__runs`, `__sheetMeta`, `__sheetPaths`) ride along for lossless binary round-trips but are **stripped by `publicIr()`** before anything is sent to an agent (`documentOps.ts:134`).

### 3.2 Typed edit operations (`EditOp`)

Agent-friendly, minimal, batchable. A batch is atomic from the caller's point of view.

| Domain    | Operations                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------- |
| Tables    | `setCell`, `insertRow`, `deleteRow`, `insertColumn`, `replaceSheet`, `replaceText` |
| Documents | `appendBlock`, `insertBlock`, `replaceBlock`, `deleteBlock`, `replaceText`           |

`applyOps()` validates ranges and throws on invalid ones (e.g. `deleteRow` out of range) as a pre-check, so a bad batch fails before any bytes are written.

### 3.3 The ops registry (`ops`)

Every surface funnels through the same object (`documentOps.ts:57`):

`listDocuments`, `read`, `search`, `applyEdits`, `save`, plus registry `register`/`unregister`/`onRegistryChange`.

---

## 4. Human capabilities (read + write via interface)

Humans get the full vendor viewer/editor suite (MIT, from `cweijan/vscode-office`) plus our optional grid editors. Default editors are the reference viewers; our grid editors are registered at `priority: option` (choose via **Open With…**).

### 4.1 Viewers / editors by file type

| Viewer                       | Custom editor id               | Handles                                                                                                             | Human can…                                                             |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Office Viewer                | `cweijan.officeViewer`       | `xls xlsx xlsm csv tsv ods docx dotx pptx pptm pdf epub ttf woff woff2 otf svg icns psd xmind tiff tif heif heic` | view/edit spreadsheets, view docs/PDFs, view fonts/SVG/PSD/XMind/images |
| Archive Viewer               | `cweijan.archiveViewer`      | `jar zip 7z rar tar.gz tgz tar apk vsix crx`                                                                      | browse/extract archives                                                 |
| Image Preview                | `cweijan.imageViewer`        | `jpg png gif apng bmp ico cur jpeg pjpeg pjp webp`                                                                | view images                                                             |
| Markdown (WYSIWYG)           | `cweijan.markdownViewer`     | `md markdown`                                                                                                     | edit markdown with live preview (vditor)                                |
| HTML Viewer                  | `cweijan.htmlViewer`         | `htm html xhtml`                                                                                                  | preview HTML                                                            |
| Parquet Viewer               | `cweijan.parquetViewer`      | `parquet`                                                                                                         | view tabular data                                                       |
| Java Decompiler              | `cweijan.classViewer`        | `class`                                                                                                           | decompile/view                                                          |
| **Grid Editor (ours)** | `officefiles.csvEditor`      | `csv tsv`                                                                                                         | edit cells in a grid                                                    |
| **Markdown (ours)**    | `officefiles.markdownEditor` | `md markdown`                                                                                                     | edit markdown (vditor IR/SV)                                            |
| **JSON Editor (ours)** | `officefiles.jsonEditor`     | `json`                                                                                                            | edit JSON as a grid                                                     |
| **Grid (beta, ours)**  | `officefiles.xlsxViewer`     | `xlsx xlsm`                                                                                                       | edit sheets directly                                                    |

Additionally, image/font/media/PDF/archive previews and an HTML source+preview viewer live in `src/host/providers/*` (used by our option surface).

### 4.2 Human write path

Human edits in a webview post messages → our providers → `ops.applyEdits` (or the provider's `WorkspaceEdit`). For text formats the source of truth is the live `TextDocument`; writes go through VS Code's edit pipeline, so they are **undoable and dirty-tracked**, and every open view updates instantly.

---

## 5. Agent capabilities (read + write efficiently)

Agents get **three surfaces**, all backed by the same `ops`:

### 5.1 Plain commands (`officefiles.agent.*`)

| Command                               | Effect                                     |
| ------------------------------------- | ------------------------------------------ |
| `officefiles.agent.listDocuments`   | list open documents (id, uri, kind, dirty) |
| `officefiles.agent.readDocument`    | read IR (optionally a row range)           |
| `officefiles.agent.searchDocuments` | substring/regex search across open docs    |
| `officefiles.agent.applyEdits`      | apply typed`EditOp[]` (undoable)         |
| `officefiles.agent.saveDocument`    | persist to disk                            |

Useful for other extensions, scripts, and keybindings.

### 5.2 VS Code LM chat tools (`#officefiles*`)

Registered with `vscode.lm.registerTool` (`agentSurface.ts:31`) for Copilot Chat and any LM-tool-capable agent inside the IDE:

| Tool                          | Purpose                                                |
| ----------------------------- | ------------------------------------------------------ |
| `#officefilesListDocuments` | enumerate open documents                               |
| `#officefilesReadDocument`  | read structured IR (`docId`, optional `range`)     |
| `#officefilesSearch`        | locate cells/blocks before editing                     |
| `#officefilesApplyEdits`    | apply typed ops instead of blind file writes           |
| `#officefilesSaveDocument`  | persist                                                |
| `#officefilesOpenOffice`    | open an`xlsx`/`docx` path so it can be read/edited |
| `#officefilesCapabilities`  | report editable vs preview-only formats                |

### 5.3 In-IDE MCP (automatic for VS Code agents)

Declared in `package.json` under `contributes.mcpServerDefinitionProviders`
(`{ id: "officefilesTools", label: "OfficeFiles" }`) and registered with
`vscode.lm.registerMcpServerDefinitionProvider` (`src/host/mcp/server.ts`). VS Code / Copilot
chat agents discover the server on activation — the user starts/trusts it once from the
**Extensions → MCP SERVERS** view. It exposes the **live** tools by launching
`out/mcp-ipc-proxy.js`, so agent edits hit the open document and land in the undo stack.

### 5.4 External MCP (stdio) — for independent clients

External agents are separate MCP clients and must be pointed at one of two entrypoints:

```bash
# (a) headless: operates directly on files, no VS Code required (csv/tsv/md, pdf text)
node out/mcp-standalone.js
#   tools: office_read, office_search, office_apply_edits, office_save, office_extract_pdf_text

# (b) live: forwards into a running VS Code window via the IPC bridge
node out/mcp-ipc-proxy.js
#   tools: live_list_documents, live_read_document, live_search,
#          live_apply_edits, live_save_document
```

| Headless tool (`mcp-standalone.js`) | Purpose                                 |
| ------------------------------------- | --------------------------------------- |
| `office_read`                       | read csv/tsv/markdown as structured IR  |
| `office_search`                     | locate matches (sheet/row/col or block) |
| `office_apply_edits`                | apply typed ops and save                |
| `office_save`                       | re-serialize IR to disk                 |
| `office_extract_pdf_text`           | per-page PDF text (read-only)           |

| Live tool (`mcp-ipc-proxy.js`) | Purpose                               |
| -------------------------------- | ------------------------------------- |
| `live_list_documents`          | list docs open in the user's window   |
| `live_read_document`           | read live IR (includes unsaved edits) |
| `live_search`                  | search across open docs               |
| `live_apply_edits`             | edit the live doc via the undo stack  |
| `live_save_document`           | save the open doc                     |

Wiring helper: run **`OfficeFiles: Configure MCP Client…`** (`officefiles.mcp.configure`) to write
`.vscode/mcp.json` or copy a ready snippet for opencode / Cline / Cursor / Claude Desktop / Claude Code.

---

## 6. Read path (agent)

```
agent → ops.read(idOrUri, range)
      → ooxml.get(idOrUri)            # binary: xlsx/docx/pptx/epub/pdf
        └─ or registry.get(idOrUri)   # text: csv/tsv/md/json  (source = live TextDocument)
      → currentIr(doc)                # codec.parse(text) → DocumentIR
      → publicIr(ir)                  # strip __xml/__runs/__sheetMeta/__sheetPaths
      → JSON back to the agent
```

Range reads slice rows for large sheets (default `[0,1000]`) so an agent does not need the whole workbook.

## 7. Write path (agent)

```
agent → ops.applyEdits(idOrUri, edits, actor)
      → gate: officefiles.agent.allowWrite   (documentOps.ts:108)
      ├─ binary: ooxml.applyEdits → applyOps(ir) → dirty (bytes written on save)
      └─ text:   structuredClone(currentIr) → applyOps → writeIrBack()
                 └─ WorkspaceEdit → vscode.workspace.applyEdit()
                    (undo stack + dirty tracking + onDidChange to ALL open views)
      → save: ooxml.save (xlsx zip rebuild / docx pristine-zip rewrite)
              or textDocument.save()
```

**Why this matters:** because text writes go through `WorkspaceEdit`, an agent edit is
indistinguishable from a human edit to VS Code — the user can **undo** it, sees the document go
dirty, and every open view (grid, markdown, plain text) refreshes.

---

## 8. Format capability matrix

| Format                                                 | Read (agent)     | Write (agent)         | Human view       | Human edit | Notes                                               |
| ------------------------------------------------------ | ---------------- | --------------------- | ---------------- | ---------- | --------------------------------------------------- |
| `.csv` / `.tsv`                                    | yes (IR)         | yes                   | grid             | yes        | delimiter/eol preserved via codec meta              |
| `.md` / `.markdown`                                | yes (blocks)     | yes                   | WYSIWYG (vditor) | yes        | source of truth =`TextDocument`                   |
| `.json`                                              | yes              | yes                   | grid (ours)      | yes        | optional editor                                     |
| `.xlsx` / `.xlsm`                                  | yes (sheets)     | yes (beta)            | grid/viewer      | yes (beta) | JSZip model;`replaceSheet` drops stale style meta |
| `.docx` / `.dotx`                                  | yes (paragraphs) | yes (paragraph-level) | viewer           | via ops    | re-opens pristine zip on each save                  |
| `.pptx` / `.pptm`                                  | yes (IR)         | no (preview-only)     | viewer           | no         | parser exists; no writer yet                        |
| `.epub`                                              | yes (IR)         | no (preview-only)     | viewer           | no         | parser exists; no writer yet                        |
| `.pdf`                                               | text extraction  | no (read-only)        | viewer           | no         | `unpdf`; image-only/encrypted may yield nothing   |
| images / fonts / svg / psd / archive / parquet / class | n/a              | n/a                   | viewer           | n/a        | human-facing viewers                                |

---

## 9. Safety, trust, and correctness

ConcernMechanismAgent writes are opt-out`officefiles.agent.allowWrite` (default `true`) gates all agent edits (`documentOps.ts:108`)No leaking internal XML to agents`publicIr()` strips `__xml`/`__runs`/`__sheetMeta`/`__sheetPaths`Bad edits fail before writing`applyOps()` throws on out-of-range indices (pre-check)Edits are reversibletext writes go through`WorkspaceEdit` (undo stack)Multi-view consistency`onRegistryChange` + VS Code change events refresh all open viewsLive vs headless separationheaderless`mcp-standalone.js` writes directly (agent approval is the gate); live `mcp-ipc-proxy.js` respects the running window's settings

---

## 10. Configuration

Our settings (agent-related):

| Setting                             | Default  | Meaning                                              |
| ----------------------------------- | -------- | ---------------------------------------------------- |
| `officefiles.agent.allowWrite`    | `true` | allow agents to modify documents                     |
| `officefiles.agent.ipcBridge`     | `true` | start the live-edit socket the IPC proxy connects to |
| `officefiles.grid.maxRowsPerPage` | —       | grid paging (our xlsx grid editor)                   |

The vendored reference viewers also contribute their own theming/preview settings (exposed under
both `vscode-office.*` and `officefiles.*` keys after the merge).

---

## 11. How to connect a given agent

| Agent                  | Automatic?                                       | How                                                                                                                        |
| ---------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| VS Code / Copilot chat | **Yes** (after Start/Trust in MCP SERVERS) | `contributes.mcpServerDefinitionProviders` (`officefilesTools`)                                                        |
| opencode               | No                                               | `opencode.json` → `"mcp": { "officefiles": { "type": "local", "command": ["node", "<ext>/out/mcp-standalone.js"] } }` |
| Cline / Roo            | No                                               | `cline_mcp_settings.json` → `mcpServers` block                                                                        |
| Cursor                 | No                                               | `~/.cursor/mcp.json` → `mcpServers` block                                                                             |
| Claude Desktop         | No                                               | `claude_desktop_config.json` → `mcpServers` block                                                                     |
| Claude Code            | No                                               | `claude mcp add --transport stdio officefiles -- node <ext>/out/mcp-standalone.js`                                       |

Run `officefiles.mcp.configure` to generate these automatically. For live editing from an external
client, use `out/mcp-ipc-proxy.js` instead of `out/mcp-standalone.js` (requires a running window with
`officefiles.agent.ipcBridge=true`).

---

## 12. Verification / current evidence

| Check              | Result                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`   | 0 errors                                                                                                              |
| `vitest run`     | 19/19 passing                                                                                                         |
| `npm run build`  | green (host + reference webview + grid webview)                                                                       |
| Packaging          | `2485 files, ~21.4 MB` VSIX, installs as `officefiles.officefiles`                                                |
| Standalone MCP e2e | `initialize` → `tools/list` → `office_read` → `office_apply_edits` mutated disk (`Ada,36` → `Ada,99`) |
| In-IDE MCP         | provider + contribution registered (schema path guarded for older VS Code)                                            |

---

## 13. Known limitations / next

- **Writers:** `pptx` and `epub` are preview-only; `pdf` is read-only. The codecs exist for reading; writers are the gap.
- **`.docx` registry flag:** the ooxml service has a paragraph-level writer, but the registry currently marks `.docx` `editable:false` — wiring/UX is incomplete.
- **`.xlsx` grid editor is beta** (`officefiles.xlsxViewer`, `option` priority).
- **LM tool API** is accessed through a guarded `any` (stable across recent VS Code; degrades silently on old builds).
- **In-IDE MCP** exposes the live proxy; a distinct "file-scoped" in-IDE server could be added if desired.
- **`.mcp.json` writes** target `.vscode/mcp.json` only; opencode/Cline/etc. are copy-to-clipboard by design.

---

## 14. One-line summary

> OfficeFiles gives **humans** a rich viewer/editor for ~40 file types and gives **agents** a typed,
> token-efficient read/write API over the same documents — with a shared IR, shared validation, and a
> shared undo stack, so the two audiences operate on one live state rather than two disconnected tools.
