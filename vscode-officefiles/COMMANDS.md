
# OfficeFiles — Commands Cheatsheet

## GitHub Codespaces — exact commands (verified)

Run everything from the extension folder.

```bash
cd /workspaces/vscode-sheetkit/vscode-officefiles

# 1. install deps
npm ci

# 2. build host + webview
npm run build

# 3. package a .vsix
npx --yes @vscode/vsce package --no-dependencies

# 4. install it into this Codespace's VS Code
code --install-extension "$PWD/officefiles-0.0.1.vsix" --force
```

Verify it is installed:

```bash
code --list-extensions --show-versions | grep -i officefiles
# expected: officefiles.officefiles@0.0.1
```

## Activate (required after install)

In the Codespace VS Code window press `Ctrl+Shift+P` → **Developer: Reload Window**
(or click the reload icon in the bottom-right / use the browser reload).

## Check that it works

1. `Ctrl+Shift+P` → type **OfficeFiles** — you should see commands:
   - `Switch CSV editor`
   - `Switch markdown editor`
   - `OfficeFiles(Agent): List Open Documents`
2. In the Explorer open `vscode-officefiles/fixtures`.
3. Right-click a sample file → **Open With…** → choose an editor:
   - `budget.xlsx` → **Office Viewer** (default; use **OfficeFiles Grid (beta)** for our grid)
   - `report.docx` → **Office Viewer**
   - `deck.pptx` → **Office Viewer**
   - `book.epub` → **Office Viewer**
   - `site.zip` → **Archive Viewer**
   - `data.csv` / `notes.md` → **Office Viewer** (grid / markdown)
4. Toggle grid ↔ raw text: pencil icon in the editor title (`.csv`), or `Ctrl+Alt+E` (`.md`).
5. If something fails: `Ctrl+Shift+P` → **Developer: Show Logs…** → **Extension Host**, and look for `officefiles`.

## Rebuild + reinstall after code changes

```bash
cd /workspaces/vscode-sheetkit/vscode-officefiles
npm run build
npx --yes @vscode/vsce package --no-dependencies
code --install-extension "$PWD/officefiles-0.0.1.vsix" --force
# then: Developer: Reload Window
```

## Other checks

```bash
npm run compile     # typecheck
npm test            # unit tests (codecs + real sample files)
npm run fixtures    # regenerate fixtures/*.xlsx|docx|pptx|epub|zip
```

| Check           | How                                                                             |
| --------------- | ------------------------------------------------------------------------------- |
| Color theme     | `Preferences: Color Theme` → **One Dark Modern**                       |
| File icon theme | `Preferences: File Icon Theme` → **Material Icon Theme (OfficeFiles)** |
| Settings        | `Preferences: Open Settings (UI)` → search `officefiles.`                  |

## Uninstall

```bash
code --uninstall-extension officefiles.officefiles
```

## Agent / MCP

Three surfaces, all backed by the same `DocumentOps` service (`src/host/ops`):

1. **In-IDE chat tools** — `vscode.lm` tools `#officefilesListDocuments`, `#officefilesReadDocument`,
   `#officefilesSearch`, `#officefilesApplyEdits`, `#officefilesSaveDocument`, `#officefilesOpenOffice`,
   `#officefilesCapabilities` (enable `chat.tools.*` / use them from Copilot Chat).
2. **In-IDE MCP** — declared via `contributes.mcpServerDefinitionProviders` and
   `lm.registerMcpServerDefinitionProvider` (`src/host/mcp/server.ts`), so VS Code / Copilot chat agents
   discover the server automatically on activation (no config needed). It runs `out/mcp-ipc-proxy.js`
   (live mode). Start/trust it once from the Extensions view → **MCP SERVERS**.
3. **External MCP (stdio)** — independent clients (opencode, Cline, Claude Code, Cursor, Claude Desktop,
   Zed, scripts) do **not** see the extension automatically; point each one at an entrypoint below.
   Both servers expose the **same** tool vocabulary (`office_*`) plus `instructions` and safety
   annotations; only the document target differs (disk vs the open editor).

```bash
# (a) headless: operates directly on files, no VS Code needed
#     reads csv/tsv/md/json/xlsx/docx/pptx/epub/pdf/zip; writes csv/tsv/md/json/xlsx/docx
node out/mcp-standalone.js

# (b) live: forwards tools into a running VS Code window via the IPC bridge
#     (edits land in the undo stack; open webviews refresh instantly)
node out/mcp-ipc-proxy.js
```

Tools (identical on both; the live server adds `office_open`, headless adds `office_extract_pdf_text`):

| Tool | Purpose |
| ---- | ------- |
| `office_capabilities` | editable vs read-only formats + EditOp vocabulary + notes |
| `office_list`           | list open documents (live) or supported files in a dir (headless) |
| `office_read`           | read IR (tables/blocks); `range` pages large docs |
| `office_search`         | locate text → `location` (Sheet!col:row or block:index) |
| `office_apply_edits`    | atomic typed ops; `dryRun:true` previews without writing |
| `office_save`           | persist to disk |
| `office_open`           | open a file in the editor (live only) |
| `office_extract_pdf_text` | per-page PDF text (headless only) |

Use `OfficeFiles: Configure MCP Client…` (`officefiles.mcp.configure`) to pick a client and either
write `.vscode/mcp.json` or copy the ready-made snippet to the clipboard.

```jsonc
// VS Code / Copilot — .vscode/mcp.json  (or use the MCP SERVERS UI / `code --add-mcp`)
{ "servers": { "officefiles": { "type": "stdio", "command": "node",
    "args": ["/abs/path/vscode-officefiles/out/mcp-standalone.js"] } } }

// opencode — opencode.json
{ "mcp": { "officefiles": { "type": "local", "enabled": true,
    "command": ["node", "/abs/path/vscode-officefiles/out/mcp-standalone.js"] } } }

// Cline / Roo / Cursor / Claude Desktop — mcpServers block
// (Cline: cline_mcp_settings.json · Cursor: ~/.cursor/mcp.json
//  Claude Desktop: claude_desktop_config.json)
{ "mcpServers": { "officefiles": { "command": "node",
    "args": ["/abs/path/vscode-officefiles/out/mcp-standalone.js"], "disabled": false } } }
```

Claude Code (CLI):

```bash
claude mcp add --transport stdio officefiles -- node /abs/path/vscode-officefiles/out/mcp-standalone.js
```

For live editing from an external client, point it at `out/mcp-ipc-proxy.js` instead of
`out/mcp-standalone.js` (requires a running VS Code window with the IPC bridge enabled).

Settings: `officefiles.agent.allowWrite` (default `true`) gates all agent writes;
`officefiles.agent.ipcBridge` (default `true`) starts the live-edit socket the proxy connects to.

Commands palette (also usable by other extensions):

| Command                               | Purpose                                           |
| ------------------------------------- | ------------------------------------------------- |
| `officefiles.agent.listDocuments`   | list documents open in the workspace              |
| `officefiles.agent.readDocument`    | read a document as structured IR (or table rows)  |
| `officefiles.agent.searchDocuments` | substring/regex search across open docs           |
| `officefiles.agent.applyEdits`      | apply typed edit ops (undoable)                   |
| `officefiles.agent.saveDocument`    | persist a document to disk                        |
| `officefiles.openOffice`            | open a file in the matching OfficeFiles viewer    |
| `officefiles.capabilities`          | show the codec/IR capability report               |
| `officefiles.mcp.configure`         | write/copy MCP client config for our stdio server |
