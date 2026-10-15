# 07 — Agent Connection Guide: Wiring AI Agents to OfficeFiles

OfficeFiles exposes **four agent surfaces**, all backed by one capability registry
(`src/host/ops/documentOps.ts`). This guide explains each connection, when to use it, and
exact configuration.

```
┌─────────────────────────────── VS Code window ───────────────────────────────┐
│  Copilot Chat (LM Tools API) ──┐                                             │
│  Command palette / scripts ────┤→ documentOps registry → live editors        │
│  In-window MCP tools ──────────┘        ▲                                    │
│                                         │ IPC socket (tmp dir / named pipe)  │
└─────────────────────────────────────────┼────────────────────────────────────┘
                                          │
   Claude Desktop / Cursor / Zed ── stdio MCP ── out/mcp-ipc-proxy.js
   headless CI agents ──────────── stdio MCP ── out/mcp-standalone.js (no VS Code)
```

---

## Surface A — Inside VS Code: Copilot Chat Language Model Tools

**Best for:** the “user writes a prompt, agent edits the open spreadsheet” loop with zero
external setup. Requires GitHub Copilot Chat extension (VS Code ≥ 1.94).

The extension registers LM tools at activation (`src/host/ops/agentSurface.ts`), so they are
available to chat participants automatically:

1. Install OfficeFiles (§06) and open a `.csv`/`.md` in an OfficeFiles editor.
2. Open Copilot Chat (⌃⌥I / Ctrl+Alt+I).
3. Prompt naturally — the model can discover tools like `officefiles.readDocument`,
   `officefiles.applyEdits`:
   > *“Add a column ‘Total’ = Price × Qty to this CSV and save.”*
4. Writes respect `officefiles.agent.allowWrite`; edits go through `WorkspaceEdit` so the
   user sees dirty state + can undo (Ctrl+Z) in the grid instantly.

Notes:
- Tool invocations show approval prompts per Copilot’s tool-calling UX.
- If tools don’t appear, run **Developer: Reload Window** (registration happens on activate;
  `onStartupFinished` ensures early availability).

---

## Surface B — Commands as a Tool Surface (any IDE CLI / scripted agents)

Every capability is also a VS Code command — usable by **anyone who can execute commands**:
the Command Palette, `code --command`-style harnesses, tests, or agent frameworks that shell
out to VS Code.

| Command | Args | Notes |
|---|---|---|
| `officefiles.agent.listDocuments` | — | returns docId list of open OfficeFiles docs |
| `officefiles.agent.readDocument` | `{ docId, range? }` | JSON IR; `range.rows=[start,end]` pages big tables |
| `officefiles.agent.searchDocuments` | `{ query }` | locations like `Sheet1!B:42` or `block:7` |
| `officefiles.agent.applyEdits` | `{ docId, ops: EditOp[] }` | atomic, undoable, gated by allowWrite |
| `officefiles.agent.saveDocument` | `{ docId }` | persist to disk |
| `officefiles.openCsvAsGrid` | uri | convenience opener |

Drive from terminal via an automation host:
```bash
code --extensionDevelopmentPath=. # then use "Runner"-style e2e harness, or
# inside Extension Tests (vscode-test): await vscode.commands.executeCommand('officefiles.agent.readDocument', docId)
```

---

## Surface C — External MCP Clients → Live Editors (IPC proxy)

**Best for:** Claude Desktop, Cursor, Zed, Windsurf, Continue, or any MCP client driving the
documents **currently open in your VS Code window** (unsaved buffers included). This is the
flagship “prompt in Claude Desktop → my open spreadsheet updates” flow.

### How it works
- The extension hosts an IPC bridge (`src/host/ipc/bridge.ts`, enabled by default via
  `officefiles.agent.ipcBridge=true`). Socket path is advertised next to it:
  - Linux/macOS: `$TMPDIR/officefiles-<machineId8>.sock` (+ `.sock.json` registry file)
  - Windows: `\\.\pipe\officefiles-<machineId8>`
- `out/mcp-ipc-proxy.js` is a dependency-free **stdio MCP server**: it auto-discovers the
  registry files, connects to the live window, and forwards `tools/list` / `tools/call`.

### Setup (Claude Desktop example)
`claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`):
```jsonc
{
  "mcpServers": {
    "officefiles-live": {
      "command": "node",
      "args": ["/ABS/PATH/TO/officefiles/out/mcp-ipc-proxy.js"]
    }
  }
}
```
For a **marketplace-installed** extension, point at the installed folder:
```
~/.vscode/extensions/<publisher>.officefiles-<ver>/out/mcp-ipc-proxy.js
```
Restart Claude Desktop → ask: *“List the documents open in my editor”* → you’ll see the
`office_*` tools connect.

### Setup (Cursor / Zed)
Cursor `~/.cursor/mcp.json` — same shape as above. Zed `settings.json`:
```jsonc
{ "context_servers": { "officefiles-live": { "command": "node", "args": ["…/out/mcp-ipc-proxy.js"] } } }
```

### Exposed tools (proxy forwards these into the live window)
| Tool | Purpose |
|---|---|
| `office_list_documents` | enumerate open docs (docId, format, dirty?) |
| `office_open` | open a file by absolute path → returns docId |
| `office_read` | JSON IR read, row-range paging |
| `office_search` | cross-document search with locations |
| `office_apply_edits` | atomic typed edit ops (undoable by the human) |
| `office_save` | write buffer to disk |
| `office_capabilities` | editable vs preview-only formats + EditOp vocabulary |
| `office_extract_pdf_text` | PDF text extraction (headless standalone only) |

Multiple VS Code windows: the proxy picks a live registered socket; run separate client
configs per window if needed (advanced: set env to pin a specific pid — see
`discoverSocket()` in `src/host/mcp/ipcProxy.ts`).

---

## Surface D — Headless Standalone MCP Server (no VS Code required)

**Best for:** CI pipelines, servers, agents without an IDE, batch transforms. Operates
directly on files via the same codecs/IR.

```jsonc
// any MCP client config
{
  "mcpServers": {
    "officefiles-headless": {
      "command": "node",
      "args": ["/ABS/PATH/out/mcp-standalone.js"]
    }
  }
}
```
Tools: `office_read`, `office_search`, `office_apply_edits`, `office_save`,
`office_extract_pdf_text` (uri-based, no docIds — paths instead).

Quick manual smoke test (stdio handshake):
```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"office_read","arguments":{"uri":"/tmp/data.csv"}}}' \
 | node out/mcp-standalone.js
```

---

## Security & Permission Model (applies to all surfaces)

| Control | Default | Recommendation |
|---|---|---|
| `officefiles.agent.allowWrite` | `true` | Set `false` in shared/org repos; flips gate reads-vs-mutations on every surface |
| `officefiles.agent.ipcBridge` | `true` | Disable (`false`) on kiosk/multi-user machines — socket is unauthenticated local IPC |
| Undo safety | always on | All writes flow through `workspace.applyEdit` → human can Ctrl+Z; prefer this over direct file writes |
| Scope | open docs only (A/B/C) | Headless D touches any path Node can read — run with least-privilege FS perms |
| Audit | console log | For orgs: wrap proxy in a logging shim to record every `apply_edits` payload |

**Threat notes:** the IPC socket trusts any local process (standard local-IPC tradeoff);
mitigate with OS file permissions on the socket (0700 tmpdir) or disable the bridge. MCP
clients should treat `apply_edits` as a high-risk tool and request human confirmation in
their policy (Claude Desktop tool approval, Cursor confirmations, etc.).

---

## End-to-End Recipes

1. **“Clean up this CSV”** (in-IDE): open CSV in Grid Editor → Copilot Chat prompt →
   Surface A applies header rename + dedupe ops → inspect dirty diff → Ctrl+S.
2. **“Draft from phone”**: Claude Desktop on laptop, VS Code open → Surface C:
   `office_open` report.csv → `office_apply_edits` add rows → human reviews live in grid.
3. **CI normalization**: PR job runs Surface D: `office_apply_edits` to enforce column order
   across all `*.csv` fixtures, then `git diff --exit-code` fails build on drift.
4. **Agent handoff**: Surface A agent saves; Surface D nightly agent re-reads from disk —
   identical IR schema guarantees lossless round-trip (covered by vitest round-trip suite).

Next doc: **`08-troubleshooting-faq.md`** for connection-level debugging.
