import * as vscode from 'vscode';
import { walkFolder, filterCodeFiles } from './scanner/scanner';
import { parsePythonFile } from './parsers/pythonParser';
import { buildGraph } from './scanner/graphBuilder';
import { CodeMapPanel } from './webview/panel';

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "codemap-visualizer" is now active!');

	const disposable = vscode.commands.registerCommand('codemap-visualizer.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from codemap-visualizer!');
	});

	const generateMapCommand = vscode.commands.registerCommand('codemap-visualizer.generate', async () => {
		const workspaceFolders = vscode.workspace.workspaceFolders;

		if (!workspaceFolders) {
			vscode.window.showErrorMessage('Please open a folder first!');
			return;
		}

		const rootPath = workspaceFolders[0].uri.fsPath;
		const extensionPath = context.extensionPath;

		const files = walkFolder(rootPath);
		const codeFiles = filterCodeFiles(files);
		const pythonFiles = codeFiles.filter(f => f.endsWith('.py'));

		vscode.window.showInformationMessage(`Parsing ${pythonFiles.length} Python files...`);

		const results = [];
		for (const filePath of pythonFiles) {
			const parsed = await parsePythonFile(filePath, rootPath, extensionPath);
			results.push(parsed);
		}

		console.log('Parsed results:', JSON.stringify(results, null, 2));

		const graph = buildGraph(workspaceFolders[0].name, results);
		console.log('Final Graph:', JSON.stringify(graph, null, 2));

		const totalFunctions = results.reduce((sum, r) => sum + r.functions.length, 0);
		const totalImports = results.reduce((sum, r) => sum + r.imports.length, 0);
		const importEdges = graph.edges.filter(e => e.type === 'import').length;
		const callEdges = graph.edges.filter(e => e.type === 'call').length;

		vscode.window.showInformationMessage(
			`Done! Parsed ${pythonFiles.length} Python files. Found ${totalFunctions} functions, ${totalImports} imports, ${importEdges} import-edges, ${callEdges} call-edges.`
		);

		CodeMapPanel.createOrShow(graph);
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(generateMapCommand);
}

export function deactivate() {}