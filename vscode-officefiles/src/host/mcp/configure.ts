// Helpers to point external MCP clients at our headless server.
//
// VS Code-native chat agents discover our server automatically via
// `contributes.mcpServerDefinitionProviders` (see server.ts). Every other agent
// (opencode, Cline, Claude Code, Cursor, Claude Desktop, ...) is an independent
// MCP client and must be configured explicitly with the stdio command below.
import * as vscode from 'vscode';

interface Scripts { standalone: string; live: string; }

function scriptPaths(context: vscode.ExtensionContext): Scripts {
  return {
    standalone: vscode.Uri.joinPath(context.extensionUri, 'out', 'mcp-standalone.js').fsPath,
    live: vscode.Uri.joinPath(context.extensionUri, 'out', 'mcp-ipc-proxy.js').fsPath,
  };
}

type Flavor = 'vscode-stdio' | 'mcpServers' | 'opencode' | 'claude-cli';

function jsonFor(flavor: Flavor, script: string): string {
  const node = process.execPath;
  switch (flavor) {
    case 'vscode-stdio':
      return JSON.stringify({ servers: { officefiles: { type: 'stdio', command: node, args: [script] } } }, null, 2);
    case 'mcpServers':
      return JSON.stringify({ mcpServers: { officefiles: { command: node, args: [script], disabled: false } } }, null, 2);
    case 'opencode':
      return JSON.stringify({ mcp: { officefiles: { type: 'local', command: [node, script], enabled: true } } }, null, 2);
    case 'claude-cli':
      return `claude mcp add --transport stdio officefiles -- "${node}" "${script}"`;
  }
}

interface ClientChoice extends vscode.QuickPickItem { flavor: Flavor; }

const CLIENTS: ClientChoice[] = [
  { label: 'VS Code / Copilot (.vscode/mcp.json)', description: 'write into this workspace', flavor: 'vscode-stdio' },
  { label: 'opencode (opencode.json)', description: 'copy to clipboard', flavor: 'opencode' },
  { label: 'Cline / Roo / Cursor / Claude Desktop', description: 'mcpServers — copy to clipboard', flavor: 'mcpServers' },
  { label: 'Claude Code (CLI)', description: 'copy command to clipboard', flavor: 'claude-cli' },
];

/** officefiles.mcp.configure — show the stdio config for a chosen client (write or copy). */
export function registerMcpConfigure(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('officefiles.mcp.configure', async () => {
      const { standalone } = scriptPaths(context);
      const picked = await vscode.window.showQuickPick(CLIENTS, {
        title: 'Configure an MCP client for OfficeFiles',
        placeHolder: 'VS Code agents are already wired via the extension; pick another client to configure',
      });
      if (!picked) return;

      const text = jsonFor(picked.flavor, standalone);

      if (picked.flavor === 'vscode-stdio') {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return void vscode.window.showWarningMessage('Open a workspace folder first.');
        const file = vscode.Uri.joinPath(folder.uri, '.vscode', 'mcp.json');
        let merged: Record<string, unknown> = {};
        try {
          merged = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(file)));
        } catch { /* new or unreadable — start fresh */ }
        merged.servers = { ...(merged.servers as object ?? {}), ...(JSON.parse(text).servers) };
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.vscode'));
        await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(JSON.stringify(merged, null, 2) + '\n'));
        const open = 'Open file';
        if (await vscode.window.showInformationMessage(`Wrote ${vscode.workspace.asRelativePath(file)}`, open) === open) {
          await vscode.window.showTextDocument(file);
        }
        return;
      }

      await vscode.env.clipboard.writeText(text);
      vscode.window.showInformationMessage(`Copied ${picked.label} config to clipboard.`);
    }),
  );
}
