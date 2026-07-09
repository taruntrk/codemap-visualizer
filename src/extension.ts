import * as vscode from 'vscode';
import { walkFolder, filterCodeFiles } from './scanner/scanner';

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "codemap-visualizer" is now active!');

	const disposable = vscode.commands.registerCommand('codemap-visualizer.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from codemap-visualizer!');
	});

	const generateMapCommand = vscode.commands.registerCommand('codemap-visualizer.generate', () => {
		const workspaceFolders = vscode.workspace.workspaceFolders;

		if (!workspaceFolders) {
			vscode.window.showErrorMessage('Please open a folder first!');
			return;
		}

		const rootPath = workspaceFolders[0].uri.fsPath;
		const files = walkFolder(rootPath);
		const codeFiles = filterCodeFiles(files);

		console.log(`Found ${files.length} total files, ${codeFiles.length} code files:`);
		console.log(codeFiles);

		vscode.window.showInformationMessage(`Scan complete! Found ${codeFiles.length} code files (out of ${files.length} total).`);
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(generateMapCommand);
}

export function deactivate() {}