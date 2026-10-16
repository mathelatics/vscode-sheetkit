# Connecting agents to OfficeFiles MCP

OfficeFiles exposes the same `office_*` tools over MCP in two modes:

| Entrypoint | Mode | Use when |
| --- | --- | --- |
| `out/mcp-standalone.js` | **headless** — reads/writes files directly on disk | CI, scripts, agents with no VS Code |
| `out/mcp-ipc-proxy.js` | **live** — forwards into the running VS Code window (edits are undoable, views refresh) | an agent should edit the docs the user has open |

Both speak the same JSON-RPC protocol and the same tool vocabulary, so a client only needs one of them.

## VS Code / Copilot agents: nothing to add

The extension self-registers via `contributes.mcpServerDefinitionProviders`. Open **Extensions → MCP SERVERS**, find **OfficeFiles (live)**, and Start/Trust it once. No repo file required.

## Other agents: add one file

Independent agents (opencode, Cursor, Claude Code, Cline/Roo, Claude Desktop, Windsurf) must be configured explicitly. Use the template matching your client from this folder:

| Agent | Template here | Real path in your repo / machine |
| --- | --- | --- |
| VS Code / Copilot | `vscode.mcp.json` | `.vscode/mcp.json` |
| opencode | `opencode.json` | `opencode.json` (repo root or `~/.config/opencode/`) |
| Cursor | `cursor.mcp.json` | `.cursor/mcp.json` |
| Claude Code | `claude-code.mcp.json` | `.mcp.json` (repo root) |
| Cline / Roo | `cline_mcp_settings.json` | `cline_mcp_settings.json` (global settings) |
| Claude Desktop | `claude_desktop_config.json` | `~/…/claude_desktop_config.json` |
| Windsurf | `windsurf.mcp.json` | `~/.codeium/windsurf/mcp_config.json` |

Every template uses a placeholder:

```
/ABS/PATH/TO/officefiles/out/mcp-standalone.js
```

Replace it with the **absolute** path to the server. Two common locations:

- Installed extension: `~/.vscode/extensions/officefiles.officefiles-0.0.1/out/mcp-standalone.js`
- This repo (after `npm run build:host`): `<repo>/vscode-officefiles/out/mcp-standalone.js`

To use **live** mode instead, swap the filename to `out/mcp-ipc-proxy.js` (requires a running VS Code window with `officefiles.agent.ipcBridge` enabled).

## Portability caveat

All of these embed an **absolute path**, which is machine-specific — committing them verbatim breaks on other machines. Prefer one of:

1. Let the extension generate it per machine: run **OfficeFiles: Configure MCP Client…** (`officefiles.mcp.configure`) — writes `.vscode/mcp.json` or copies the snippet.
2. Commit a template with the placeholder + a short README setup note.
3. Future: publish the server to npm and use `npx officefiles-mcp` (portable, no path).

## Verify

After connecting, the client should list these tools:

```
office_capabilities  office_list  office_read  office_search  office_apply_edits  office_save
 (+ office_open in live mode, + office_extract_pdf_text in headless mode)
```

Quick smoke test:

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| node out/mcp-standalone.js
```

## Safety

Agent writes are gated by `officefiles.agent.allowWrite` (default `true`). `office_apply_edits` is destructive — call it with `dryRun:true` first when previewing.
