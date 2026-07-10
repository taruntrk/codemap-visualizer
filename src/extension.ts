import * as vscode from 'vscode';
import { walkFolder, filterCodeFiles } from './scanner/scanner';
import { parsePythonFile } from './parsers/pythonParser';
import { parseJsTsFile } from './parsers/jstsParser';
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
        const jsFiles    = codeFiles.filter(f => f.endsWith('.js') || f.endsWith('.jsx'));
        const tsFiles    = codeFiles.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));

        const totalCount = pythonFiles.length + jsFiles.length + tsFiles.length;
        vscode.window.showInformationMessage(
            `Parsing ${pythonFiles.length} Python, ${jsFiles.length} JS/JSX, ${tsFiles.length} TS/TSX files...`
        );

        const results = [];

        for (const filePath of pythonFiles) {
            const parsed = await parsePythonFile(filePath, rootPath, extensionPath);
            results.push(parsed);
        }

        for (const filePath of jsFiles) {
            const parsed = await parseJsTsFile(filePath, rootPath, extensionPath);
            results.push(parsed);
        }

        for (const filePath of tsFiles) {
            const parsed = await parseJsTsFile(filePath, rootPath, extensionPath);
            results.push(parsed);
        }

        const graph = buildGraph(workspaceFolders[0].name, results);

        const totalFunctions = results.reduce((sum, r) => sum + r.functions.length, 0);
        const totalImports   = results.reduce((sum, r) => sum + r.imports.length, 0);
        const importEdges    = graph.edges.filter(e => e.type === 'import').length;
        const callEdges      = graph.edges.filter(e => e.type === 'call').length;

        vscode.window.showInformationMessage(
            `Done! Parsed ${totalCount} files (${pythonFiles.length} py, ${jsFiles.length} js, ${tsFiles.length} ts). ` +
            `Found ${totalFunctions} functions, ${totalImports} imports, ${importEdges} import-edges, ${callEdges} call-edges.`
        );

        CodeMapPanel.createOrShow(graph, rootPath);
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(generateMapCommand);
}

export function deactivate() {}