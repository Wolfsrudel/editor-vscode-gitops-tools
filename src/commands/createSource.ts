import { workspace } from 'vscode';
import { getExtensionContext } from '../extensionContext';
import { getOpenedFolderGitInfo } from '../git/getOpenedFolderGitInfo';
import { CreateSourcePanel } from '../webviews/createSourceWebview';

/**
 * Open the webview editor with a form to enter all the flags
 * needed to create the source (and possibly Kustomization
 * if the current cluster is Azure)
 *
 * Also prefill new git source name/branch/url if possible.
 */
export async function createSource() {
	let gitInfo;
	if (workspace.workspaceFolders && workspace.workspaceFolders.length === 1) {
		// if only 1 folder is opened - get git remote url & branch & new source name
		gitInfo = await getOpenedFolderGitInfo(workspace.workspaceFolders[0].uri);
	}

	CreateSourcePanel.createOrShow(getExtensionContext().extensionUri, gitInfo);
}
