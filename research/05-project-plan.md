# 05 — What We Can Build: "vscode-officefiles" (scope, phases, deviations)

Answers the question *"what can you build?"* — a smaller, self-contained first app that already delivers
the differentiators (agent control + real editing), then grows toward full vscode-office parity.
MIT-licensed patterns from `rough/` are reusable per file with attribution notes.

## Product concept
**OfficeFiles** — VS Code custom editors for office/data files where BOTH humans and AI agents are
first-class actors: WYSIWYG-ish webview UIs backed by an operations service exposed as commands,
LM tools, and an MCP server. User writes a prompt → agent reads/edits the open document live.

## Architecture deltas vs vscode-office (the "more robust/efficient/friendly" list)
1. **Ops-first core**: `packages/core` = format codecs (parse↔IR↔serialize) + typed edit ops, NO vscode import
   → unit-testable, reusable by headless MCP server & CLI. vscode-office welds logic to Handler closures.
2. **Every format editable via IR** (csv/xlsx/docx/pptx/md/json/yaml). Their binary viewers are readonly.
3. **Versioned multi-subscriber message bus** with request/ack/error envelope `{id,type,payload,error,seq}`
   replacing their single-listener `{type,content}`; supports human+agent concurrent edits.
4. **TextDocument-backed sync for text-representable formats; IR+dirty-save for binaries**, both routed through
   `WorkspaceEdit` so native undo/dirty/conflict UX comes free (generalizing their markdown trick).
5. **MCP server in-process** (`vscode.lm.registerMcpServerDefinition`) + standalone stdio entry for external
   agents; LM tools mirror same ops; all also plain commands (their app has none of this).
6. **Lazy activation** (`onCustomEditor:viewType`, `onLanguage:`) instead of their `onStartupFinished` eager load;
   per-view dynamic imports shrink initial cost (their single SPA bundle is ~heavy).
7. **Streaming/chunking for big files** (sheet rows, doc blocks paged to webview) instead of whole-buffer base64.
8. **Structured error channel + user-facing fixups** (corrupt zip partial recovery) vs bare showErrorMessage.
9. **Accessibility + keyboard grid nav**; command palette entries for every op; i18n from day one (nls files).
10. **Safety layer for agents**: allowlists, diff-preview before destructive ops, edit audit trail tagged by
    actor (user|copilot|mcp:clientName), global kill-switch setting.
11. Web (vscode.dev) support path kept simple: pure-JS codecs only in phase 1 (skip Node-only deps they use
    like puppeteer-core/7z-wasm initially).

## MVP scope (build now) — self-contained but extensible
Formats: **Markdown (WYSIWYG+source dual view), CSV/TSV (grid editor), XLSX (multi-sheet grid, formulas display,
basic write), DOCX (paragraph-level editor via IR), PPTX (phase 2 read/render)**. PDF/images viewer phase 2
(copy their pdf.js bundling approach). Archives/XMind/PSD/fonts/parquet = later roadmap (all proven in rough/).
Agent surface: MCP + LM tools + commands for open/read/search/applyEdits/save/export/create/list.
Export: md→html/pdf(print), csv↔xlsx, docx→md. Templates for new files (reuse blank template dir idea).

## Repo layout (in /workspace/vscode-officefiles)
```
vscode-officefiles/
  package.json            # extension manifest (customEditors, mcpServers?, lmTools docs, commands, config)
  tsconfig.json
  esbuild.mjs             # host bundle (node+web) ; vite for webview OR simple react-less phase1? -> react+vite
  src/
    extension.ts          # activate: register providers, ops service, MCP/LM tools, commands
    host/
      bus.ts              # versioned RPC (Handler successor)
      providers/{markdown,csv,xlsx,docx}.ts
      ops/documentOps.ts  # THE single capability registry (used by bus+MCP+commands)
      mcp/{server.ts,standalone.ts}
      lmTools.ts
    webview/              # React SPA, route-injected like ReactApp but code-split per view
      main.tsx views/{grid,md,docx}/ util/api.ts (typed bus client)
    core/                 # no-vscode: ir.ts, codecs/{csv,xlsx,docx,md}.*, ops schema (zod), json schemas for MCP
  test/                   # vitest codec round-trips + ops tests
  research-link           # ../research/*.md referenced in README
```

## Milestones
- M0 scaffold: build pipeline (esbuild host + vite webview), {{configs}} injection clone, empty grid view. ✅ goal today
- M1 CSV grid fully editable + save + file-watch reload (proves bus+provider+ops loop end-to-end)
- M2 Markdown dual view (clone their CustomTextEditorProvider pattern, improved sync)
- M3 Ops service + commands + LM tool + MCP in-process server; agent demo "add column Q = sum…"
- M4 XLSX read/write via exceljs-style codec in core (IR), formulas render; DOCX paragraph IR editor
- M5 Export/convert (pdf print via webview, md/html), templates, i18n, a11y pass
- M6 Standalone stdio MCP bin for external clients; headless ops on files without IDE open
- Roadmap beyond: pptx render, pdf annotate layer, archives, parquet, xmind, psd (all exist in rough/ to learn from)

## Success criteria for "prompt → result"
From Copilot Chat with our MCP server enabled: "open data.csv, add average column, save" completes with ≤1
approval click, visible live in editor, undoable, logged in audit view. That single flow validates the design.
