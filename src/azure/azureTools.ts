import { window } from 'vscode';
import { kubernetesTools } from '../kubernetes/kubernetesTools';
import { ClusterProvider, ConfigMap } from '../kubernetes/kubernetesTypes';
import { shell, ShellResult } from '../shell';
import { parseJson } from '../utils/jsonUtils';
import { ClusterContextNode } from '../views/nodes/clusterContextNode';
import { askUserForAzureMetadata } from './getAzureMetadata';

export type AzureClusterProvider = ClusterProvider.AKS | ClusterProvider.AzureARC;

/**
 * Return true when the cluster provider is either AKS or Azure Arc.
 */
export function isAzureProvider(provider: ClusterProvider): provider is AzureClusterProvider {
	return provider === ClusterProvider.AKS || provider === ClusterProvider.AzureARC;
}


export const enum AzureConstants {
	ArcNamespace = 'azure-arc',
	KubeSystemNamespace = 'kube-system',
	FluxExtensionName = 'flux',
}

class AzureTools {

	/**
	 * 1. Prompt user for: (cluster name, resource group, subscription)
	 * 2. Infer cluster type (AKS - managedClusters, Azure Arc - connectedClusters)
	 * 3. Execute the command and return ShellResult.
	 *
	 * @param command azure command to execute
	 * @param clusterNode target cluster node
	 * @param clusterProvider target cluster provider
	 */
	private async invokeAzCommand(
		command: string,
		contextName: string,
		clusterProvider: AzureClusterProvider,
	): Promise<undefined | ShellResult> {

		let azureMetadata = await this.getAzureMetadata(contextName, clusterProvider);
		if (!azureMetadata) {
			window.showWarningMessage('Failed to get Azure resource name or resource group or subscription ID.');
			azureMetadata = await askUserForAzureMetadata(contextName);
		}

		if (!azureMetadata) {
			return;
		}

		const clusterType = clusterProvider === ClusterProvider.AKS ? 'managedClusters' : 'connectedClusters';

		const metadata = `--cluster-name ${azureMetadata.resourceName} --cluster-type ${clusterType} --resource-group ${azureMetadata.resourceGroup} --subscription ${azureMetadata.subscriptionId}`;

		return await shell.execWithOutput(`${command} ${metadata}`);
	}

	/**
	 * Get azure data from the configmaps.
	 * @param clusterNode target cluster node
	 * @param clusterProvider target cluster provider
	 */
	async getAzureMetadata(
		contextName: string,
		clusterProvider: AzureClusterProvider,
	) {

		let configMapShellResult: ShellResult | undefined;
		if (clusterProvider === ClusterProvider.AKS) {
			configMapShellResult = await kubernetesTools.invokeKubectlCommand(`get configmaps extension-manager-config -n ${AzureConstants.KubeSystemNamespace} --context=${contextName} --ignore-not-found -o json`);
		} else {
			configMapShellResult = await kubernetesTools.invokeKubectlCommand(`get configmaps azure-clusterconfig -n ${AzureConstants.ArcNamespace} --context=${contextName} --ignore-not-found -o json`);
		}

		if (configMapShellResult?.code !== 0) {
			return;
		}

		const configMap: ConfigMap | undefined = parseJson(configMapShellResult.stdout);
		if (configMap === undefined) {
			return;
		}

		const result = {
			resourceGroup: configMap.data['AZURE_RESOURCE_GROUP'],
			resourceName: configMap.data['AZURE_RESOURCE_NAME'],
			subscriptionId: configMap.data['AZURE_SUBSCRIPTION_ID'],
		};

		if (!result.resourceGroup || !result.resourceName || !result.subscriptionId) {
			return;
		}

		return result;
	}

	/**
	 * Enable GitOps
	 * @see https://docs.microsoft.com/en-us/cli/azure/k8s-extension?view=azure-cli-latest#az_k8s_extension_create
	 *
	 * @param clusterNode target cluster node
	 * @param clusterProvider target cluster provider
	 */
	async enableGitOps(
		clusterNode: ClusterContextNode,
		clusterProvider: AzureClusterProvider,
	) {
		await this.invokeAzCommand(
			`az k8s-extension create --name ${AzureConstants.FluxExtensionName} --extension-type microsoft.flux --scope cluster`,
			clusterNode.contextName,
			clusterProvider,
		);
	}

	/**
	 * Disable GitOps
	 * @see https://docs.microsoft.com/en-us/cli/azure/k8s-extension?view=azure-cli-latest#az_k8s_extension_delete
	 *
	 * @param clusterNode target cluster node
	 * @param clusterProvider target cluster provider
	 */
	async disableGitOps(
		clusterNode: ClusterContextNode,
		clusterProvider: AzureClusterProvider,
	) {
		const fluxConfigurations = await this.listFluxConfigurations(clusterNode, clusterProvider);

		if (!fluxConfigurations) {
			return;
		}

		const namesOfFluxConfigs: string[] = fluxConfigurations.map((configuration: {name: string;}) => configuration.name);

		// delete all flux configurations
		await Promise.all(namesOfFluxConfigs.map(fluxConfigName => this.invokeAzCommand(
			`az k8s-configuration flux delete -n ${fluxConfigName} --yes`,
			clusterNode.contextName,
			clusterProvider,
		)));

		// delete flux extension
		await this.invokeAzCommand(
			`az k8s-extension delete --name ${AzureConstants.FluxExtensionName} --yes`,
			clusterNode.contextName,
			clusterProvider,
		);
	}

	/**
	 * Return all flux resources managed by Azure.
	 * @see https://docs.microsoft.com/en-us/cli/azure/k8s-configuration/flux?view=azure-cli-latest#az_k8s_configuration_flux_list
	 *
	 * @param clusterNode target cluster node
	 * @param clusterProvider target cluster provider
	 */
	private async listFluxConfigurations(
		clusterNode: ClusterContextNode,
		clusterProvider: AzureClusterProvider,
	): Promise<undefined | any[]> {
		const configurationShellResult = await this.invokeAzCommand(
			'az k8s-configuration flux list',
			clusterNode.contextName,
			clusterProvider,
		);

		if (configurationShellResult?.code !== 0) {
			return;
		}

		return parseJson(configurationShellResult.stdout);
	}

	/**
	 * Create git repository source (optionally, with a Kustomization).
	 * @see https://docs.microsoft.com/en-us/cli/azure/k8s-configuration/flux?view=azure-cli-latest#az_k8s_configuration_flux_create
	 *
	 * @param newGitRepositorySourceName kubernetes resource name
	 * @param gitUrl git repository url
	 * @param gitBranch git repository active branch
	 * @param isSSH true when the git url protocol is SSH
	 * @param clusterNode target cluster node
	 * @param clusterProvider target cluster provider
	 * @param kustomizationName new kustomization name
	 * @param kustomizationPath new kustozmiation path
	 */
	async createGitRepository(
		newGitRepositorySourceName: string,
		gitUrl: string,
		gitBranch: string,
		isSSH: boolean,
		clusterNode: ClusterContextNode,
		clusterProvider: AzureClusterProvider,
		kustomizationName?: string,
		kustomizationPath?: string,
	): Promise<{ deployKey: string; } | undefined> {

		let kustomizationQueryPart = '';
		if (kustomizationName !== undefined && kustomizationPath !== undefined) {
			kustomizationQueryPart = `--kustomization name=${kustomizationName} path=${kustomizationPath} prune=true`;
		}

		const gitCreateShellResult = await this.invokeAzCommand(
			`az k8s-configuration flux create -n ${newGitRepositorySourceName} --scope cluster -u ${gitUrl} --branch ${gitBranch} ${kustomizationQueryPart}`,
			clusterNode.contextName,
			clusterProvider,
		);

		if (!isSSH || gitCreateShellResult?.code !== 0) {
			return;
		}

		const output = parseJson(gitCreateShellResult.stdout);
		if (!output) {
			return;
		}

		return {
			deployKey: output.repositoryPublicKey,
		};
	}

	/**
	 * Create Kustomization.
	 * @see https://docs.microsoft.com/en-us/cli/azure/k8s-configuration/flux/kustomization?view=azure-cli-latest#az_k8s_configuration_flux_kustomization_create
	 *
	 * @param kustomizationName name of the new kustomization
	 * @param gitRepositoryName git source name of the new kustomization
	 * @param kustomizationPath kustomization spec path property value
	 */
	async createKustomization(
		kustomizationName: string,
		gitRepositoryName: string,
		kustomizationPath: string,
		clusterNode: ClusterContextNode,
		clusterProvider: AzureClusterProvider,
	) {
		const createKustomizationShellResult = await this.invokeAzCommand(
			`az k8s-configuration flux kustomization create --kustomization-name ${kustomizationName} --name ${gitRepositoryName} --path "${kustomizationPath}" --prune true`,
			clusterNode.contextName,
			clusterProvider,
		);

		if (createKustomizationShellResult?.code !== 0) {
			window.showErrorMessage(createKustomizationShellResult?.stderr || '');
			return;
		}
	}

	/**
	 * @see https://docs.microsoft.com/en-us/cli/azure/k8s-configuration/flux?view=azure-cli-latest#az_k8s_configuration_flux_create
	 */
	async createSourceGit2(args: {
		sourceName: string;
		contextName: string;
		clusterProvider: AzureClusterProvider;
		url: string;
		branch: string;
		tag: string;
		semver: string;
		commit: string;
		interval: string;
		timeout: string;
		caCert: string;
		caCertFile: string;
		httpsKey: string;
		httpsUser: string;
		knownHosts: string;
		knownHostsFile: string;
		localAuthRef: string;
		sshPrivateKey: string;
		sshPrivateKeyFile: string;
		kustomizationName: string;
		kustomizationPath: string;
		kustomizationDependsOn: string;
		kustomizationTimeout: string;
		kustomizationSyncInterval: string;
		kustomizationRetryInterval: string;
		kustomizationPrune: boolean;
		kustomizationForce: boolean;
	}) {
		const urlArg = ` --url "${args.url}"`;
		const branchArg = args.branch ? ` --branch "${args.branch}"` : '';
		const tagArg = args.tag ? ` --tag "${args.tag}"` : '';
		const semverArg = args.semver ? ` --semver "${args.semver}"` : '';
		const commitArg = args.commit ? ` --commit "${args.commit}"` : '';
		const intervalArg = args.interval ? ` --interval "${args.interval}"` : '';
		const timeoutArg = args.timeout ? ` --timeout "${args.timeout}"` : '';
		const caCertArg = args.caCert ? ` --https-ca-cert "${args.caCert}"` : '';
		const caCertFileArg = args.caCertFile ? ` --https-ca-cert-file "${args.caCertFile}"` : '';
		const httpsKeyArg = args.httpsKey ? ` --https-key "${args.httpsKey}"` : '';
		const httpsUserArg = args.httpsUser ? ` --https-user "${args.httpsUser}"` : '';
		const knownHostsArg = args.knownHosts ? ` --known-hosts "${args.knownHosts}"` : '';
		const knownHostsFileArg = args.knownHostsFile ? ` --known-hosts-file "${args.knownHostsFile}"` : '';
		const localAuthRefArg = args.localAuthRef ? ` --local-auth-ref "${args.localAuthRef}"` : '';
		const sshPrivateKeyArg = args.sshPrivateKey ? ` --ssh-private-key "${args.sshPrivateKey}"` : '';
		const sshPrivateKeyFileArg = args.sshPrivateKeyFile ? ` --ssh-private-key-file "${args.sshPrivateKeyFile}"` : '';

		let kustomizationPart = '';
		const kustomizationName = args.kustomizationName ? ` name="${args.kustomizationName}"` : '';
		const kustomizationPath = args.kustomizationPath ? ` path="${args.kustomizationPath}"` : '';
		const kustomizationDependsOn = args.kustomizationDependsOn ? ` depends_on="${args.kustomizationDependsOn}"` : '';
		const kustomizationTimeout = args.kustomizationTimeout ? ` timeout="${args.kustomizationTimeout}"` : '';
		const kustomizationSyncInterval = args.kustomizationSyncInterval ? ` sync_interval="${args.kustomizationSyncInterval}"` : '';
		const kustomizationRetryInterval = args.kustomizationRetryInterval ? ` retry_interval="${args.kustomizationRetryInterval}"` : '';
		const kustomizationPrune = args.kustomizationPrune ? ' prune=true' : 'prune=false';
		const kustomizationForce = args.kustomizationForce ? ' force=true' : 'prune=false';

		if (kustomizationName || kustomizationPath || kustomizationDependsOn || kustomizationTimeout || kustomizationSyncInterval || kustomizationRetryInterval || kustomizationPrune || kustomizationForce) {
			kustomizationPart = ` --kustomization${kustomizationName}${kustomizationPath}${kustomizationDependsOn}${kustomizationTimeout}${kustomizationSyncInterval}${kustomizationRetryInterval}${kustomizationPrune}${kustomizationForce}`;
		}

		await this.invokeAzCommand(
			`az k8s-configuration flux create -n ${args.sourceName}${urlArg}${branchArg}${tagArg}${semverArg}${commitArg}${intervalArg}${timeoutArg}${caCertArg}${caCertFileArg}${httpsKeyArg}${httpsUserArg}${knownHostsArg}${knownHostsFileArg}${localAuthRefArg}${sshPrivateKeyArg}${sshPrivateKeyFileArg}${kustomizationPart}`,
			args.contextName,
			args.clusterProvider,
		);
	}

	/**
	 * Delete source.
	 * @see https://docs.microsoft.com/en-us/cli/azure/k8s-configuration/flux?view=azure-cli-latest#az_k8s_configuration_flux_delete
	 *
	 * @param sourceName target source name
	 * @param clusterNode target cluster node
	 * @param clusterProvider target cluster provider
	 */
	async deleteSource(
		sourceName: string,
		clusterNode: ClusterContextNode,
		clusterProvider: AzureClusterProvider,
	) {
		await this.invokeAzCommand(
			`az k8s-configuration flux delete -n ${sourceName} --yes`,
			clusterNode.contextName,
			clusterProvider,
		);
	}

	/**
	 * Suspend source reconciliation.
	 * @see https://docs.microsoft.com/en-us/cli/azure/k8s-configuration/flux?view=azure-cli-latest#az_k8s_configuration_flux_update
	 *
	 * @param sourceName target source name
	 * @param clusterNode target cluster node
	 * @param clusterProvider target cluster provider
	 */
	async suspend(
		sourceName: string,
		clusterNode: ClusterContextNode,
		clusterProvider: AzureClusterProvider,
	) {
		await this.invokeAzCommand(
			`az k8s-configuration flux update -n ${sourceName} --suspend true`,
			clusterNode.contextName,
			clusterProvider,
		);
	}

	/**
	 * Resume source reconciliation.
	 * @see https://docs.microsoft.com/en-us/cli/azure/k8s-configuration/flux?view=azure-cli-latest#az_k8s_configuration_flux_update
	 *
	 * @param sourceName target source name
	 * @param clusterNode target cluster node
	 * @param clusterProvider target cluster provider
	 */
	async resume(
		sourceName: string,
		clusterNode: ClusterContextNode,
		clusterProvider: AzureClusterProvider,
	) {
		await this.invokeAzCommand(
			`az k8s-configuration flux update -n ${sourceName} --suspend false`,
			clusterNode.contextName,
			clusterProvider,
		);
	}
}

/**
 * Helper methods for running `az` commands.
 */
export const azureTools = new AzureTools();
