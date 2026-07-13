import * as vscode from 'vscode';
import { walkFolder, filterCodeFiles, filterCssFiles, filterEnvFiles, filterDbFiles } from './scanner/scanner';
import { parsePythonFile } from './parsers/pythonParser';
import { parseJsTsFile } from './parsers/jstsParser';
import { parseCssFile } from './parsers/cssParser';
import { parseEnvFile } from './parsers/envParser';
import { parseDbFile } from './parsers/dbParser';
import { buildGraph, buildGraphWithSpecial } from './scanner/graphBuilder';
import { CodeMapPanel } from './webview/panel';

export function activate(context: vscode.ExtensionContext) {
    console.log('CodeMap Visualizer is now active!');

    const disposable = vscode.commands.registerCommand('codemap-visualizer.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from codemap-visualizer!');
    });

    const generateMapCommand = vscode.commands.registerCommand('codemap-visualizer.generate', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('Please open a folder first!');
            return;
        }

        const rootPath      = workspaceFolders[0].uri.fsPath;
        const extensionPath = context.extensionPath;
        const allFiles      = walkFolder(rootPath);

        // ── Code files ──────────────────────────────────────
        const codeFiles   = filterCodeFiles(allFiles);
        const pythonFiles = codeFiles.filter(f => f.endsWith('.py'));
        const jsFiles     = codeFiles.filter(f => f.endsWith('.js') || f.endsWith('.jsx'));
        const tsFiles     = codeFiles.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));

        // ── Special files ────────────────────────────────────
        const cssFiles = filterCssFiles(allFiles);
        const envFiles = filterEnvFiles(allFiles);
        const dbFiles  = filterDbFiles(allFiles);

        vscode.window.showInformationMessage(
            `Scanning: ${pythonFiles.length} py, ${jsFiles.length} js, ${tsFiles.length} ts, ` +
            `${cssFiles.length} css, ${envFiles.length} env, ${dbFiles.length} db/schema files...`
        );

        // ── Parse code files ─────────────────────────────────
        const codeResults = [];

        for (const f of pythonFiles) {
            codeResults.push(await parsePythonFile(f, rootPath, extensionPath));
        }
        for (const f of jsFiles) {
            codeResults.push(await parseJsTsFile(f, rootPath, extensionPath));
        }
        for (const f of tsFiles) {
            codeResults.push(await parseJsTsFile(f, rootPath, extensionPath));
        }

        // ── Parse special files ──────────────────────────────
        const cssResults = cssFiles.map(f => parseCssFile(f, rootPath));
        const envResults = envFiles.map(f => parseEnvFile(f, rootPath));
        const dbResults  = dbFiles.map(f => parseDbFile(f, rootPath));

        // ── Build graph ──────────────────────────────────────
        const baseGraph  = buildGraph(workspaceFolders[0].name, codeResults);
        const fullGraph  = buildGraphWithSpecial(baseGraph, cssResults, envResults, dbResults);

        // ── Stats ────────────────────────────────────────────
        const totalFunctions = codeResults.reduce((s, r) => s + r.functions.length, 0);
        const importEdges    = fullGraph.edges.filter(e => e.type === 'import').length;
        const callEdges      = fullGraph.edges.filter(e => e.type === 'call').length;

        vscode.window.showInformationMessage(
            `Done! ${fullGraph.nodes.length} nodes (${codeResults.length} code, ${cssResults.length} css, ` +
            `${envResults.length} env, ${dbResults.length} db). ` +
            `${totalFunctions} functions, ${importEdges} imports, ${callEdges} calls.`
        );

        CodeMapPanel.createOrShow(fullGraph, rootPath);
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(generateMapCommand);
}

export function deactivate() {}
