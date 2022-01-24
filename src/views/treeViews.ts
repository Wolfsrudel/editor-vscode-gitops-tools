import { TreeItem, TreeView, window } from 'vscode';
import { isAzureProvider } from '../azure/azureTools';
import { Errorable, failed } from '../errorable';
import { kubernetesTools } from '../kubernetes/kubernetesTools';
import { ClusterProvider } from '../kubernetes/kubernetesTypes';
import { ClusterDataProvider } from './dataProviders/clusterDataProvider';
import { DocumentationDataProvider } from './dataProviders/documentationDataProvider';
import { SourceDataProvider } from './dataProviders/sourceDataProvider';
import { WorkloadDataProvider } from './dataProviders/workloadDataProvider';
import { ClusterContextNode } from './nodes/clusterContextNode';
import { TreeNode } from './nodes/treeNode';
import { Views } from './views';

let clusterTreeViewProvider: ClusterDataProvider;
let sourceTreeViewProvider: SourceDataProvider;
let workloadTreeViewProvider: WorkloadDataProvider;
let documentationTreeViewProvider: DocumentationDataProvider;

let clusterTreeView: TreeView<TreeItem>;
let sourceTreeView: TreeView<TreeItem>;
let workloadTreeView: TreeView<TreeItem>;
let documentationTreeView: TreeView<TreeItem>;

/**
 * Creates tree views for the GitOps sidebar.
 */
export function createTreeViews() {
	// create gitops tree view data providers
	clusterTreeViewProvider = new ClusterDataProvider();
	sourceTreeViewProvider =  new SourceDataProvider();
	workloadTreeViewProvider = new WorkloadDataProvider();
	documentationTreeViewProvider = new DocumentationDataProvider();

	// create gitops sidebar tree views
	clusterTreeView = window.createTreeView(Views.ClustersView, {
		treeDataProvider: clusterTreeViewProvider,
		showCollapseAll: true,
	});

	sourceTreeView = window.createTreeView(Views.SourcesView, {
		treeDataProvider: sourceTreeViewProvider,
		showCollapseAll: true,
	});

	workloadTreeView = window.createTreeView(Views.WorkloadsView, {
		treeDataProvider: workloadTreeViewProvider,
		showCollapseAll: true,
	});

	// create documentation links sidebar tree view
	documentationTreeView = window.createTreeView(Views.DocumentationView, {
		treeDataProvider: documentationTreeViewProvider,
		showCollapseAll: true,
	});
}

/**
 * Refreshes all GitOps tree views.
 */
export function refreshAllTreeViews() {
	refreshClustersTreeView();
	refreshSourcesTreeView();
	refreshWorkloadsTreeView();
}

/**
 * Reloads configured clusters tree view via kubectl.
 * When an argument is passed - only that tree item
 * and its children are updated.
 */
export function refreshClustersTreeView(node?: TreeNode) {
	clusterTreeViewProvider.refresh(node);
}

/**
 * Reloads sources tree view for the selected cluster.
 */
export function refreshSourcesTreeView(node?: TreeNode) {
	sourceTreeViewProvider.refresh(node);
}

/**
 * Reloads workloads tree view for the selected cluster.
 */
export function refreshWorkloadsTreeView(node?: TreeNode) {
	workloadTreeViewProvider.refresh(node);
}

interface CurrentClusterInfo {
	contextName: string;
	clusterName: string;
	clusterProvider: ClusterProvider;
	isAzure: boolean;
}

/**
 * Return current cluster name & current context & current cluster provider.
 */
export async function getCurrentClusterInfo(): Promise<Errorable<CurrentClusterInfo>> {
	const currentContextResult = await kubernetesTools.getCurrentContext();
	if (failed(currentContextResult)) {
		const error = `Failed to get current context ${currentContextResult.error[0]}`;
		window.showErrorMessage(error);
		return {
			succeeded: false,
			error: [error],
		};
	}
	const currentContextName = currentContextResult.result;
	const contextsResult = await kubernetesTools.getContexts();
	if (failed(contextsResult)) {
		window.showErrorMessage('Failed to get contexts');
		return {
			succeeded: false,
			error: ['Failed to get contexts'],
		};
	}
	const currentClusterName = contextsResult.result.find(context => context.name === currentContextName)?.context.clusterInfo?.name;
	if (!currentClusterName) {
		window.showErrorMessage('Failed to find current context.');
		return {
			succeeded: false,
			error: ['Failed to get currentClusterName'],
		};
	}
	const currentClusterProvider = await kubernetesTools.detectClusterProvider(currentContextName);

	return {
		succeeded: true,
		result: {
			clusterName: currentClusterName,
			contextName: currentContextName,
			clusterProvider: currentClusterProvider,
			isAzure: isAzureProvider(currentClusterProvider),
		},
	};
}

/**
 * Expand, focus or select a tree node inside the Clusters tree view.
 * @param clusterNode Target cluster node
 */
export async function revealClusterNode(clusterNode: ClusterContextNode, {
	expand = false,
	focus = false,
	select = false,
}: {
	expand?: boolean;
	focus?: boolean;
	select?: boolean;
} | undefined = {}) {
	return await clusterTreeView.reveal(clusterNode, {
		expand,
		focus,
		select,
	});
}
