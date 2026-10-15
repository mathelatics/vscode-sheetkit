# 04 — Agent Control via MCP (research for "user prompts → agent edits office files")

Goal restated: the office-file editors must be operable BY AI AGENTS, not only by humans. A user types a
prompt into Copilot Chat / Cursor / Claude Code / any MCP client, and the agent can open, read, edit,
export, and transform xlsx/docx/pptx/csv/md/pdf files live in the editor. vscode-office has ZERO of this
(verified: no mcp references; its "AI" is a raw LLM HTTP call). Here's how we add it.

## Option matrix (VS Code extension + agents)
| Route | What it is | Pros | Cons |
|---|---|---|---|
| **A. MCP Server inside our extension** (`vscode.lm.registerMcpServerDefinition` / stdio server) | VS Code 1.99+ ships an API for extensions to contribute MCP servers that appear in Copilot Chat's tool list; also publish a standalone Node MCP server so ANY MCP client (Claude Desktop, Cursor, Zed…) can connect. | Standard protocol; works with external agents too; discoverable in chat UI | Newer API, desktop-first |
| **B. Language Model Tools API** (`vscode.lm.registerTool`, VS Code ≥1.90) | Native chat participant tools (`#officeEditSheet`) invocable by Copilot/other participants. | Zero extra processes; secure; inline in chat | Only agents running INSIDE the IDE |
| **C. Commands-as-tools** | Every capability = `vscode.executeCommand('officefiles.sheet.write', …)`; agents (Copilot CLI/extensions) or users invoke commands; document them. | Trivially easy; MCP server becomes thin wrapper over commands | No schema discovery |
| **D. Custom control channel** (local WebSocket/IPC bridge w/ JSON-RPC) | For non-MCP agents & scripts; also powers multi-window sync. | Language-agnostic | Security/auth burden; reinvents MCP |

**Recommendation: A + B + C combined.** Implement every capability ONCE as a typed internal service
(`DocumentOps`), then expose it three ways: LM tool, MCP tool (in-IDE + standalone stdio server), and command.
The MCP server is literally a ~100-line adapter over the same service. This is the robustness win over
vscode-office, where logic is welded to one webview Handler per file type.

## Concrete MCP surface to build (tool list)
```
office.open(uri, viewType?)                    -> opens custom editor, returns docId
office.read(docId|uri, {range?})               -> structured JSON (cells/paragraphs/slides/blocks)
office.search(query, regex?, scope?)           -> locations (sheet!cell, doc paragraph idx, slide n)
office.applyEdits(docId, edits[])              -> atomic batch: setCell(range,value,format), insertRows,
                                                 replaceText(range,newText), addParagraph, setSlideTitle…
office.undoRedo(docId, steps)                  -> history control (uses native TextDocument/WorkspaceEdit stack)
office.save(docId) / office.revert(docId)
office.export(docId, format: pdf|png|md|csv|xlsx|docx|pptx)
office.convert(uri, targetFormat)              -> e.g. md->docx, csv->xlsx
office.create(template, uri)                   -> blank/new doc from template dir
office.listOpenDocuments()                     -> id, uri, dirty, activeViewType
office.comment/annotate(...)                   -> optional review layer
```
Rules baked into the service (robustness beyond vscode-office):
- All writes go through `workspace.applyEdit` / `WorkspaceEdit` batches → undo-safe, dirty-tracked,
  conflict-checked, and instantly mirrored to any open webview via `onDidChangeTextDocument`.
- Binary formats: keep a canonical intermediate representation (IR) per format (see 05), edits mutate IR,
  save serializes IR→file. Agent never needs to understand OOXML zip internals.
- Permission tiers: read-only tools always on; mutating tools gated by setting `officefiles.agent.allowWrite`
  + VS Code's built-in tool-approval prompt. Audit log of agent edits (source=mcp) in document history view.

## How existing MCP infrastructure helps (external knowledge, stable facts)
- `@modelcontextprotocol/sdk` (TS) provides `Server` + `StdioServerTransport`; VS Code auto-discovers servers
  declared in package.json `"contributes": { "mcpServers": [...] }` (GA since 1.99, `chat.mcp.*` settings),
  and `vscode.lm.registerMcpServerDefinition(provider)` lets an extension host the server IN-PROCESS
  (no separate node spawn, direct access to vscode API — ideal for us).
- Clients outside VS Code (Claude Desktop/Cursor/Windsurf/Zed) all speak stdio MCP → ship a tiny
  `bin/mcp-server.js` entry that connects to the extension over an IPC socket (or embeds the same ops
  library headlessly using Node fs) → same tools everywhere.
- Anthropic/OpenAI function-calling parity: MCP tool schemas are JSON Schema → describe IR ranges precisely
  (A1 notation for sheets, block index for docs, slide index for ppt) so LLMs make valid edits first try.

## Prompt-to-action UX loop (what "user just writes a prompt" means concretely)
1. User opens report.xlsx (our grid editor renders).
2. In Copilot Chat: "add a SUM column and highlight rows under budget".
3. Agent calls `office.read` (sees sheet JSON) → `office.applyEdits` (typed ops) → VS Code marks dirty,
   webview re-renders live; user sees cells animate in; Ctrl+Z still works; user saves manually (or approves
   `office.save`).
Safety: diff preview before apply for destructive ops (delete rows/sheets), rate-limit, and per-session opt-in.

## Deviations from vscode-office that enable this
- Its readonly providers have NO mutation path at all → we make EVERY format editable via IR + ops service.
- Its single-listener event bus can't host concurrent actors (human + agent) → versioned multi-subscriber bus.
- Its eager activation is fine for us too (MCP registration happens at activation) but heavy views lazy-load.
