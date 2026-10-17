// OfficeTools extension entry (desktop).
//
// Scope: PDF viewing + Markdown viewing/editing only.
// The rich PDF viewer and the Vditor-based Markdown editor/preview are vendored from the
// MIT-licensed cweijan/vscode-office project (see src/provider + resource/).
import * as vscode from 'vscode';
import { Global } from './common/global';
import { FileUtil } from './common/fileUtil';
import { TelemetryService } from './service/telemetryService';
import { MarkdownService } from './service/markdownService';
import { MarkdownEditorProvider } from './provider/markdownEditorProvider';
import { OfficeViewerProvider } from './provider/officeViewerProvider';
import { autoClearCacheStorage } from './service/autoClearCacheStorage';

export async function activate(context: vscode.ExtensionContext) {
	await Global.init(context);
	autoClearCacheStorage(context);
	TelemetryService.init(context);
	FileUtil.init(context);

	const viewOption = { webviewOptions: { retainContextWhenHidden: true } };
	const markdownService = new MarkdownService(context);
	const markdownEditorProvider = new MarkdownEditorProvider(context);
	const viewerInstance = new OfficeViewerProvider(context);

	context.subscriptions.push(
		// Markdown
		vscode.commands.registerCommand('office.markdown.switch', (uri) => { markdownService.switchEditor(uri) }),
		vscode.commands.registerCommand('office.markdown.paste', () => { markdownService.loadClipboardImage() }),
		vscode.window.registerCustomEditorProvider('cweijan.markdownViewer', markdownEditorProvider, viewOption),
		vscode.window.registerCustomEditorProvider('cweijan.markdownPreview', markdownEditorProvider, viewOption),
		// PDF
		...viewerInstance.bindCustomEditors(viewOption),
	);
}

export function deactivate() { }
