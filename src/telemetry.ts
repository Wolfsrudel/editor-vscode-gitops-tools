import { env, ExtensionContext, ExtensionMode } from 'vscode';
import TelemetryReporter from 'vscode-extension-telemetry';


export const enum SpecificErrorEvent {
	/**
	 * Uncaught exception. Doesn't tell much. Need to see stack trace attached.
	 */
	UNCAUGHT_EXCEPTION = 'UNCAUGHT_EXCEPTION',
	/**
	 * There is no check at the startup for whether or not
	 * the `git` is installed.
	 * User tried to execute one of the commands that required git cli,
	 * bit it's not found on the machine.
	 */
	GIT_NOT_INSTALLED = 'GIT_NOT_INSTALLED',
	KUBERNETES_TOOLS_API_UNAVAILABLE = 'KUBERNETES_TOOLS_API_UNAVAILABLE',
	FAILED_TO_GET_KUBECTL_CONFIG = 'FAILED_TO_GET_KUBECTL_CONFIG',
	FAILED_TO_GET_CURRENT_KUBERNETES_CONTEXT = 'FAILED_TO_GET_CURRENT_KUBERNETES_CONTEXT',
	FAILED_TO_SET_CURRENT_KUBERNETES_CONTEXT = 'FAILED_TO_SET_CURRENT_KUBERNETES_CONTEXT',
	FAILED_TO_GET_CHILDREN_OF_A_WORKLOAD = 'FAILED_TO_GET_CHILDREN_OF_A_WORKLOAD',
	FAILED_TO_GET_NODES_TO_DETECT_AKS_CLUSTER = 'FAILED_TO_GET_NODES_TO_DETECT_AKS_CLUSTER',
	FAILED_TO_GET_CONFIGMAPS_TO_DETECT_ARC_CLUSTER = 'FAILED_TO_GET_CONFIGMAPS_TO_DETECT_ARC_CLUSTER',
	FAILED_TO_GET_PODS_OF_A_DEPLOYMENT = 'FAILED_TO_GET_PODS_OF_A_DEPLOYMENT',
	FAILED_TO_GET_KUSTOMIZATIONS = 'FAILED_TO_GET_KUSTOMIZATIONS',
	FAILED_TO_GET_HELM_RELEASES = 'FAILED_TO_GET_HELM_RELEASES',
	FAILED_TO_GET_GIT_REPOSITORIES = 'FAILED_TO_GET_GIT_REPOSITORIES',
	FAILED_TO_GET_HELM_REPOSITORIES = 'FAILED_TO_GET_HELM_REPOSITORIES',
	FAILED_TO_GET_BUCKETS = 'FAILED_TO_GET_BUCKETS',
	FAILED_TO_GET_NAMESPACES = 'FAILED_TO_GET_NAMESPACES',
	FAILED_TO_GET_RESOURCE = 'FAILED_TO_GET_RESOURCE',
	FAILED_TO_GET_FLUX_CONTROLLERS = 'FAILED_TO_GET_FLUX_CONTROLLERS',
	FAILED_TO_GET_AVAILABLE_RESOURCE_KINDS = 'FAILED_TO_GET_AVAILABLE_RESOURCE_KINDS',
	FAILED_TO_DETECT_CLUSTER_PROVIDER = 'FAILED_TO_DETECT_CLUSTER_PROVIDER',

	FAILED_TO_OPEN_RESOURCE = 'FAILED_TO_OPEN_RESOURCE',
	// flux
	FAILED_TO_RUN_FLUX_CREATE_KUSTOMIZATION = 'FAILED_TO_RUN_FLUX_CREATE_KUSTOMIZATION',
	FAILED_TO_RUN_FLUX_DELETE_SOURCE = 'FAILED_TO_RUN_FLUX_DELETE_SOURCE',
	FAILED_TO_RUN_FLUX_CHECK = 'FAILED_TO_RUN_FLUX_CHECK',
	FAILED_TO_RUN_FLUX_TREE = 'FAILED_TO_RUN_FLUX_TREE',
	FAILED_TO_RUN_FLUX_INSTALL = 'FAILED_TO_RUN_FLUX_INSTALL',
	FAILED_TO_RUN_FLUX_UNINSTALL = 'FAILED_TO_RUN_FLUX_UNINSTALL',
	FAILED_TO_RUN_FLUX_SUSPEND = 'FAILED_TO_RUN_FLUX_SUSPEND',
	FAILED_TO_RUN_FLUX_RESUME = 'FAILED_TO_RUN_FLUX_RESUME',
	FAILED_TO_RUN_FLUX_RECONCILE = 'FAILED_TO_RUN_FLUX_RECONCILE',
	FAILED_TO_RUN_FLUX_TRACE = 'FAILED_TO_RUN_FLUX_TRACE',
	// git
	FAILED_TO_RUN_GIT_CLONE = 'FAILED_TO_RUN_GIT_CLONE',
}

export type TelemetryErrorEvent = SpecificErrorEvent | string;

export const enum TelemetryEventNames {
	/**
	 * Extension startup event.
	 */
	Startup = 'STARTUP',
	/**
	 * First ever extension activation.
	 */
	NewInstall = 'NEW_INSTALL',
	/**
	 * Enable gitops event (flux install).
	 */
	EnableGitOps = 'ENABLE_GITOPS',
	/**
	 * Disable gitops event (flux uninstall).
	 */
	DisableGitOps = 'DISABLE_GITOPS',
	/**
	 * Pressed `+` button to open the webview editor.
	 */
	CreateSourceOpenWebview = 'CREATE_SOURCE_OPEN_WEBVIEW',
	/**
	 * Create Flux Source event.
	 */
	CreateSource = 'CREATE_SOURCE',
	/**
	 * Delete Flux Source event.
	 */
	DeleteSource = 'DELETE_SOURCE',
}

/**
 * Map event names with the data type of payload sent
 * When undefined - send only the event name.
 */
interface TelemetryEventNamePropertyMapping {
	[TelemetryEventNames.Startup]: undefined;
	[TelemetryEventNames.EnableGitOps]: {
		clusterProvider: string;
	};
	[TelemetryEventNames.DisableGitOps]: {
		clusterProvider: string;
	};
	[TelemetryEventNames.NewInstall]: undefined;
	[TelemetryEventNames.CreateSourceOpenWebview]: undefined;
	[TelemetryEventNames.CreateSource]: {
		kind: string;
	};
	[TelemetryEventNames.DeleteSource]: {
		kind: string;
	};
}

export class Telemetry {

	private context: ExtensionContext;
	private reporter: TelemetryReporter;

	constructor(context: ExtensionContext, extensionVersion: string, extensionId: string) {
		this.context = context;
		const key = 'da19a1446ba2-369b-0484-b857-e706cf38'.split('').reverse().join('');
		this.reporter = new TelemetryReporter(extensionId, extensionVersion, key);
	}

	/**
	 * Check if it's allowed to send the telemetry.
	 */
	private canSend(): boolean {
		// Don't send telemetry when developing or testing the extension
		if (this.context.extensionMode !== ExtensionMode.Production) {
			return false;
		}
		// Don't send telemetry when user disabled it in Settings
		if (!env.isTelemetryEnabled) {
			return false;
		}
		return true;
	}

	/**
	 * Send custom events.
	 *
	 * @param eventName sent message title
	 * @param payload custom properties to add to the message
	 */
	send<T extends TelemetryEventNamePropertyMapping, E extends keyof T>(eventName: E, payload?: T[E]): void {
		if (!this.canSend()) {
			return;
		}

		// @ts-ignore
		this.reporter.sendTelemetryEvent(eventName, payload);
	}

	/**
	 * Send caught or uncaught errors.
	 *
	 * @param eventName sent message title
	 * @param error error object of the uncaught exception
	 */
	sendError(eventName: TelemetryErrorEvent, error?: Error): void {
		if (!this.canSend()) {
			return;
		}

		if (!error) {
			error = new Error(eventName);
		}

		this.reporter.sendTelemetryException(error, {
			name: eventName,
		});

	}

	dispose(): void {
		this.reporter.dispose();
	}
}


