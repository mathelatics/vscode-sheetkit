// OfficeFiles extension entry. Lazy-ish activation, registers providers + agent surface.
import * as vscode from 'vscode';
import { CsvEditorProvider } from './host/providers/csvProvider';
import { MarkdownEditorProvider } from './host/providers/markdownProvider';
import { registerAgentCommands, registerLanguageModelTools } from './host/ops/agentSurface';

export function activate(context: vscode.ExtensionContext) {
  const viewOption = { webviewOptions: { retainContextWhenHidden: true } }; // proven by vscode-office for UX
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(CsvEditorProvider.viewType, new CsvEditorProvider(context), viewOption),
    vscode.window.registerCustomEditorProvider(MarkdownEditorProvider.viewType, new MarkdownEditorProvider(context), viewOption),
  );
  registerAgentCommands(context);
  registerLanguageModelTools(context);
}

export function deactivate() { }
