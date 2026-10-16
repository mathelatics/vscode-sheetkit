import * as vscode from 'vscode';

// In-IDE MCP wiring for VS Code chat agents (Copilot etc.). We expose the LIVE proxy
// (out/mcp-ipc-proxy.js, built from ./ipcProxy.ts) because in-IDE the IPC bridge is already
// running and agent edits should land in the open document's undo stack. The proxy speaks the
// shared protocol + tool vocabulary (./protocol.ts, ./officeTools.ts), identical to the
// headless server — so external and in-IDE agents see the same tools.
//
// Tool metadata used to live here as a dead `mcpTools[]` array (never registered); it has been
// removed — the single source of truth is ./officeTools.ts.
export function registerMcpServerDefinition(context: vscode.ExtensionContext) {
  const lm = (vscode as any).lm;
  if (!lm?.registerMcpServerDefinitionProvider) return; // older VS Code: LM tools + commands still work
  const script = vscode.Uri.joinPath(context.extensionUri, 'out', 'mcp-ipc-proxy.js').fsPath;
  const Stdio = (vscode as any).McpStdioServerDefinition;
  if (!Stdio) return;
  try {
    context.subscriptions.push(lm.registerMcpServerDefinitionProvider('officefilesTools', {
      provideMcpServerDefinitions: async () => [
        new Stdio('OfficeFiles (live)', process.execPath, [script]),
      ],
    }));
  } catch { /* API shape drift across Insiders builds — degrade silently to LM tools/commands */ }
}
