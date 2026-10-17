import { basename, extname } from 'path';
import { getFileSuffix } from '@/common/fileSuffix';
import * as vscode from 'vscode';
import { Handler } from '@/common/handler';
import { TelemetryService } from '@/service/telemetryService';
import { extensionResource, getExtensionResourceRoots, readExtensionText } from '@/common/extensionResource';

/**
 * Read-only PDF viewer (pdf.js based).
 *
 * The viewer page (resource/pdf) posts an `init` message on load and waits for an
 * `open` message carrying the document (a webview URL for real files, or the raw
 * bytes for virtual documents). Without that reply the viewer stays at 0 pages.
 */
export class OfficeViewerProvider implements vscode.CustomReadonlyEditorProvider {

	constructor(private context: vscode.ExtensionContext) { }

	bindCustomEditors(viewOption: { webviewOptions: vscode.WebviewPanelOptions }) {
		return [
			vscode.window.registerCustomEditorProvider('officetools.pdfViewer', this, viewOption),
		];
	}

	public openCustomDocument(uri: vscode.Uri, _openContext: vscode.CustomDocumentOpenContext, _token: vscode.CancellationToken): vscode.CustomDocument | Thenable<vscode.CustomDocument> {
		return { uri, dispose: (): void => { } };
	}

	public resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel, _token: vscode.CancellationToken): void | Thenable<void> {
		const uri = document.uri;
		const webview = webviewPanel.webview;
		const folderPath = vscode.Uri.joinPath(uri, '..');
		webview.options = {
			enableScripts: true,
			localResourceRoots: [...getExtensionResourceRoots(this.context), folderPath],
		};

		const handler = Handler.bind(webviewPanel, uri);
		const sendOpen = async () => {
			// Files on disk (and remote/vfs files) can be loaded directly by URL so the
			// browser streams/range-requests them instead of copying the whole buffer.
			if (uri.scheme === 'file' || uri.scheme === 'vscode-remote' || uri.scheme === 'vscode-vfs') {
				handler.emit('open', {
					ext: extname(uri.fsPath),
					path: webview.asWebviewUri(uri).toString(),
					fileName: basename(uri.fsPath),
				});
				return;
			}
			// Virtual documents (git:, untitled:, custom schemes) must be read by the host.
			try {
				const data = await vscode.workspace.fs.readFile(uri);
				handler.emit('open', {
					ext: extname(uri.fsPath),
					path: uri.toString(),
					fileName: basename(uri.fsPath),
					buffer: Array.from(data),
				});
			} catch (error) {
				handler.emit('open', {
					ext: extname(uri.fsPath),
					fileName: basename(uri.fsPath),
					error: error instanceof Error ? error.message : 'Failed to read file',
				});
			}
		};

		handler
			.on('init', () => void sendOpen())
			.on('fileChange', () => void sendOpen())
			.on('editInVSCode', (full: boolean) => {
				const side = full ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside;
				vscode.commands.executeCommand('vscode.openWith', uri, 'default', side);
			})
			.on('developerTool', () => vscode.commands.executeCommand('workbench.action.toggleDevTools'))
			.on('openSponsor', () => { })
			.on('openExternal', (url: string) => {
				if (url) {
					vscode.env.openExternal(vscode.Uri.parse(url));
				}
			});

		const suffix = getFileSuffix(uri.fsPath);
		const fileType = suffix.startsWith('.') ? suffix.slice(1) : suffix;
		TelemetryService.get()?.trackOfficeViewOpen(uri.fsPath, 'pdf', fileType);
		void this.loadPdfViewer(webview);
	}

	private async loadPdfViewer(webview: vscode.Webview) {
		const html = await readExtensionText(this.context, 'resource', 'pdf', 'viewer.html');
		webview.html = html.replace('{{baseUrl}}', this.getBaseUrl(webview, 'pdf'));
	}

	private getBaseUrl(webview: vscode.Webview, path: string) {
		const baseUrl = webview.asWebviewUri(extensionResource(this.context, 'resource', path))
			.toString().replace(/\?.+$/, '').replace('https://git', 'https://file');
		return baseUrl;
	}

}
