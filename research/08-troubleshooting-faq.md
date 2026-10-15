# 08 — Troubleshooting & FAQ (Deployment + Agent Connections)

Companion to `06-deployment-guide.md` and `07-agent-connection-guide.md`. Each entry:
**Symptom → Check → Fix**.

---

## Build / Package

**Q: `vsce package` fails with “the version field must be updated”.**
Check: did you bump `package.json > version`? vsce refuses republishing the same version.
Fix: bump semver, or for local-only sideloads it doesn’t apply (that error is publish-time).

**Q: Packaged vsix has no webview assets (blank editors).**
Check: `unzip -l officefiles-*.vsix | grep dist/webview`.
Fix: run `npm run build` **before** packaging; verify `.vscodeignore` doesn’t exclude `dist/**`.

**Q: Extension activates but throws “Cannot find module vscode”.**
Check: you ran `node out/extension.js` directly.
Fix: that bundle is extension-host-only (`vscode` is external). Use `out/mcp-standalone.js`
for headless Node usage.

**Q: esbuild/vite build OOM on CI.**
Fix: `NODE_OPTIONS=--max-old-space-size=4096 npm run build`; cache `node_modules` with
`actions/cache` keyed on `package-lock.json`.

---

## Installing / Running in VS Code

**Q: Files still open in the default editor; OfficeFiles not offered.**
Check: our customEditors register with `"priority": "option"`.
Fix: right-click file → *Open With…* → pick **OfficeFiles … Editor**; optionally set
`"workbench.editorAssociations": { "*.csv": "officefiles.csvEditor" }` to make it default.

**Q: Activation never happens.**
Check: Output panel → channel “OfficeFiles” / Dev Tools console.
Fix: `onStartupFinished` should fire within seconds; if disabled globally, re-enable the
extension (`Extensions: Show Installed Extensions`).

**Q: Copilot Chat doesn’t see the LM tools.**
Check: VS Code ≥ 1.94 + Copilot Chat installed; reload window after install.
Fix: tools are registered at activation — open any OfficeFiles document once, then ask the
model to list available tools. Enterprise policies blocking tool calls will hide them too.

---

## MCP Connection Issues

**Q: Claude Desktop/Cursor shows server red / “connection closed”.**
Checks, in order:
1. `node out/mcp-ipc-proxy.js` from a terminal — it should sit idle waiting on stdin (no crash).
2. Absolute path correctness in the client config (`command` must be node’s absolute path on
   some macOS GUI launchers: `/usr/local/bin/node` — GUI apps don’t inherit your shell PATH).
3. Is VS Code running with the extension active? The proxy needs the IPC socket.
4. `officefiles.agent.ipcBridge` setting is `true`.

**Q: Proxy starts but “no live window found”.**
Check: `$TMPDIR/officefiles-*.sock.json` exists (Linux/macOS) or named pipe
`officefiles-*` exists (Windows), and its recorded `pid` is alive.
Fix: the bridge writes registry files on activation; fully quit and relaunch VS Code. On
macOS note `$TMPDIR` differs per-user — match env between VS Code and the proxy process
(export `TMPDIR` in the client config `env` block if needed).

**Q: Two VS Code windows open — which one does the proxy drive?**
Current behavior: first live pid discovered wins (`discoverSocket()` in
`src/host/mcp/ipcProxy.ts`). Workaround: close the other window, or fork the proxy to pin a
socket via env var (small enhancement tracked as TODO).

**Q: Handshake works but `tools/call` returns empty content.**
Check: protocol framing — MCP stdio expects **one JSON-RPC message per line**, no
Content-Length headers. Test manually:
```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}\n' \
 | node out/mcp-standalone.js
```
Expect a single-line `result` response with `serverInfo.name = "officefiles"`.

**Q: `office_apply_edits` rejected.**
Check: `officefiles.agent.allowWrite === true` in the *window* hosting the doc (user or
workspace settings). Error message names the gate explicitly.

**Q: Headless standalone can’t read a .xlsx with formulas.**
Fix: rich writer/reader lives in `src/core/codecs/xlsx.ts` — values+styles round-trip is
covered by tests; if a specific workbook breaks, file an issue with the fixture — fallback is
opening it in VS Code and using Surface C instead.

---

## Data Integrity

**Q: Did an agent edit corrupt my CSV quoting?**
Check: `npm test` includes RFC-4180 round-trip cases. In-app: edits only touch cells/blocks
via IR ops; delimiters/line-endings preserved by codec detection. Undo (Ctrl+Z) always works
because writes go through `WorkspaceEdit`.

**Q: Markdown formatting lost on save?**
Fix: markdown codec is block-level; inline styling is preserved verbatim inside block text.
If you hand-edited raw text while the block editor was open, save conflicts surface as dirty
state — resolve via normal VS Code conflict UX.

---

## Performance

**Q: Huge CSV (1M rows) slow to open?**
Fix: grid streams rows in pages of `officefiles.grid.maxRowsPerPage` (default 500); agents
should page reads with `range.rows=[start,end]` rather than full `office_read`.

**Q: PDF extraction hangs on scanned books.**
Note: extraction is text-layer only (pdf.js); scanned images have no text layer — expected
empty result. OCR is out of scope (candidate feature).

---

## Escalation Checklist (when filing a bug)

Collect:
```bash
code --list-extensions --show-versions | grep -i officefiles
node --version && code --version
cat "$TMPDIR"/officefiles-*.sock.json 2>/dev/null || dir \\.\pipe\officefiles* 2>nul
# Output panel logs (Extension host), repro steps, failing fixture file
```
