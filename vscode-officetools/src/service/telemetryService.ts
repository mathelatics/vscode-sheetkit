import { TelemetryReporter } from '@vscode/extension-telemetry';
import { env, ExtensionContext, workspace } from 'vscode';
import { fileTypeFromPath, resolveOfficeViewType } from './officeViewType';

/**
 * Telemetry is intentionally DISABLED in this build.
 *
 * OfficeTools currently ships with no Application Insights connection string, so
 * `TelemetryReporter` is never constructed and no events ever leave the machine.
 *
 * To enable telemetry for your own publisher account, set this to your own
 * connection string and restore the `officetools.enableTelemetry` default.
 */
const TELEMETRY_CONNECTION_STRING = '';

export class TelemetryService {
    private static instance: TelemetryService | undefined;
    private static readonly VIEW_OPEN_INTERVAL_MS = 180 * 60 * 1000;
    private reporter: TelemetryReporter | undefined;
    private viewOpenLastSentByFileType = new Map<string, number>();

    static init(context: ExtensionContext): TelemetryService {
        if (!TelemetryService.instance) {
            TelemetryService.instance = new TelemetryService(context);
        }
        return TelemetryService.instance;
    }

    static get(): TelemetryService | undefined {
        return TelemetryService.instance;
    }

    private constructor(context: ExtensionContext) {
        if (!TELEMETRY_CONNECTION_STRING) {
            return;
        }
        this.reporter = new TelemetryReporter(TELEMETRY_CONNECTION_STRING);
        context.subscriptions.push(this.reporter);
    }

    private enabled(): boolean {
        if (!this.reporter || !env.isTelemetryEnabled) {
            return false;
        }
        return workspace.getConfiguration('officetools').get<boolean>('enableTelemetry', true);
    }

    private getCommonProperties(): Record<string, string> {
        const theme = workspace.getConfiguration('workbench').get<string>('colorTheme');
        return {
            theme,
            app_name: env.appName,
            language: env.language,
        };
    }

    trackViewOpen(viewType: string, fileType?: string, properties?: Record<string, string>): void {
        if (!this.enabled()) {
            return;
        }
        const rateLimitKey = fileType ?? viewType;
        const now = Date.now();
        const lastSent = this.viewOpenLastSentByFileType.get(rateLimitKey);
        if (lastSent !== undefined && now - lastSent < TelemetryService.VIEW_OPEN_INTERVAL_MS) {
            return;
        }
        this.viewOpenLastSentByFileType.set(rateLimitKey, now);
        this.reporter!.sendTelemetryEvent('view.open', {
            viewType,
            ...(fileType ? { fileType } : {}),
            ...properties,
            ...this.getCommonProperties(),
        });
    }

    trackOfficeViewOpen(fsPath: string, route?: string, fileType?: string): void {
        const viewType = resolveOfficeViewType(fsPath, route);
        if (!viewType) {
            return;
        }
        this.trackViewOpen(viewType, fileType || fileTypeFromPath(fsPath));
    }

    trackEvent(event: string, properties?: Record<string, string>): void {
        if (!this.enabled()) {
            return;
        }
        this.reporter!.sendTelemetryEvent(event, {
            ...properties,
            ...this.getCommonProperties(),
        });
    }

}
