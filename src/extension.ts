import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { walkFolder, filterCodeFiles, filterCssFiles, filterEnvFiles, filterDbFiles } from './scanner/scanner';
import { parsePythonFile } from './parsers/pythonParser';
import { parseJsTsFile } from './parsers/jstsParser';
import { parseCssFile } from './parsers/cssParser';
import { parseEnvFile } from './parsers/envParser';
import { parseDbFile } from './parsers/dbParser';
import { buildGraph, buildGraphWithSpecial, FileParseResult } from './scanner/graphBuilder';
import { CodeMapPanel } from './webview/panel';

// ── Parse a single code file ──────────────────────────────
async function parseFile(
    filePath: string,
    rootPath: string,
    extensionPath: string
): Promise<FileParseResult> {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.py') return parsePythonFile(filePath, rootPath, extensionPath);
    return parseJsTsFile(filePath, rootPath, extensionPath);
}

// ── Get immediate subfolders of a directory ───────────────
function getSubFolders(dirPath: string): string[] {
    try {
        return fs.readdirSync(dirPath, { withFileTypes: true })
            .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '__pycache__' && e.name !== '.git')
            .map(e => e.name)
            .sort();
    } catch {
        return [];
    }
}

// ── Check if a directory has any code files directly inside it ───
function getRootCodeFileCount(dirPath: string): number {
    try {
        return fs.readdirSync(dirPath, { withFileTypes: true })
            .filter(e => e.isFile() && ['.py', '.js', '.jsx', '.ts', '.tsx'].includes(path.extname(e.name).toLowerCase()))
            .length;
    } catch {
        return 0;
    }
}

// ── Scan selected paths and build + show graph ────────────
async function buildAndShowGraph(
    scanPaths: string[],   // absolute paths to scan (dirs or __ROOT_FILES__ tokens)
    rootPath: string,
    projectName: string,
    extensionPath: string
) {
    // Resolve __ROOT_FILES__ tokens (only immediate files in that dir)
    const allFiles: string[] = [];

    for (const p of scanPaths) {
        if (p.endsWith('/__ROOT_FILES__')) {
            const dir = p.replace('/__ROOT_FILES__', '');
            try {
                fs.readdirSync(dir, { withFileTypes: true })
                    .filter(e => e.isFile())
                    .forEach(e => allFiles.push(path.join(dir, e.name)));
            } catch { /* skip */ }
        } else {
            allFiles.push(...walkFolder(p));
        }
    }

    const uniqueFiles = [...new Set(allFiles)];
    const codeFiles   = filterCodeFiles(uniqueFiles);

    if (codeFiles.length === 0) {
        vscode.window.showWarningMessage('No code files found in selected folders!');
        return;
    }

    vscode.window.showInformationMessage(`Scanning ${codeFiles.length} code files...`);

    const cssFiles = filterCssFiles(uniqueFiles);
    const envFiles = filterEnvFiles(uniqueFiles);
    const dbFiles  = filterDbFiles(uniqueFiles);

    const codeResults: FileParseResult[] = [];
    for (const f of codeFiles) {
        codeResults.push(await parseFile(f, rootPath, extensionPath));
    }

    const cssResults = cssFiles.map(f => parseCssFile(f, rootPath));
    const envResults = envFiles.map(f => parseEnvFile(f, rootPath));
    const dbResults  = dbFiles.map(f => parseDbFile(f, rootPath));

    const baseGraph = buildGraph(projectName, codeResults);
    const fullGraph = buildGraphWithSpecial(baseGraph, cssResults, envResults, dbResults);

    const importEdges = fullGraph.edges.filter(e => e.type === 'import').length;
    const callEdges   = fullGraph.edges.filter(e => e.type === 'call').length;

    vscode.window.showInformationMessage(
        `Done! ${fullGraph.nodes.length} nodes, ${importEdges} imports, ${callEdges} calls.`
    );

    CodeMapPanel.createOrShow(fullGraph, rootPath);
}

// ── 3-level folder picker ─────────────────────────────────
//
//  Step 1: Show all top-level folders of rootPath
//          User picks one or more (canPickMany: true)
//
//  Step 2: For EACH folder picked in Step 1:
//            - If it has no subfolders → include it directly
//            - If it has subfolders    → show them, user picks specific ones
//              (includes "✅ Select ALL" and "📄 root files" options)
//
//  Step 3: For EACH subfolder picked in Step 2 that has further subfolders:
//            - Show sub-subfolders picker
//            - Same pattern: "✅ Select ALL", "📄 root files", or specific sub-subfolders
//
async function pickFoldersAndGenerate(
    rootPath: string,
    projectName: string,
    extensionPath: string
) {
    // ══ STEP 1 ════════════════════════════════════════════
    const topSubFolders  = getSubFolders(rootPath);
    const rootFileCount  = getRootCodeFileCount(rootPath);

    const step1Items: vscode.QuickPickItem[] = [];

    if (rootFileCount > 0) {
        step1Items.push({
            label:       '📄 (root files)',
            description: `${rootFileCount} code file(s) directly in root`,
            picked:      false,
        });
    }

    for (const folder of topSubFolders) {
        step1Items.push({
            label:       '📁 ' + folder,
            description: path.join(rootPath, folder),
            picked:      false,
        });
    }

    if (step1Items.length === 0) {
        vscode.window.showErrorMessage('No folders or code files found in this project!');
        return;
    }

    const step1Picked = await vscode.window.showQuickPick(step1Items, {
        canPickMany:  true,
        placeHolder:  'Step 1 of 3 — Select top-level folders to explore (multi-select OK)',
        title:        `CodeMap: ${projectName} — Choose Folders`,
        ignoreFocusOut: true,
    });

    if (!step1Picked || step1Picked.length === 0) {
        vscode.window.showInformationMessage('CodeMap: Cancelled.');
        return;
    }

    // ══ STEP 2 ════════════════════════════════════════════
    const finalScanPaths: string[] = [];

    for (const item of step1Picked) {

        // ── root-level files ──────────────────────────────
        if (item.label === '📄 (root files)') {
            finalScanPaths.push(rootPath + '/__ROOT_FILES__');
            continue;
        }

        const folderName = item.label.replace('📁 ', '');
        const folderPath = path.join(rootPath, folderName);
        const subFolders = getSubFolders(folderPath);

        // ── no subfolders → add whole folder directly ─────
        if (subFolders.length === 0) {
            finalScanPaths.push(folderPath);
            continue;
        }

        // ── has subfolders → show step 2 picker ───────────
        const folderRootFileCount = getRootCodeFileCount(folderPath);
        const step2Items: vscode.QuickPickItem[] = [];

        step2Items.push({
            label:       '✅ Select ALL  (entire ' + folderName + ')',
            description: 'Scan everything inside this folder recursively',
            picked:      false,
        });

        if (folderRootFileCount > 0) {
            step2Items.push({
                label:       '📄 (root files in ' + folderName + ')',
                description: `${folderRootFileCount} file(s) directly in ${folderName}/`,
                picked:      false,
            });
        }

        for (const sub of subFolders) {
            step2Items.push({
                label:       '  📁 ' + sub,
                description: path.join(folderPath, sub),
                picked:      false,
            });
        }

        const step2Picked = await vscode.window.showQuickPick(step2Items, {
            canPickMany:  true,
            placeHolder:  `Step 2 of 3 — Which parts of "${folderName}" to include?`,
            title:        `CodeMap: ${folderName} — Select Subfolders`,
            ignoreFocusOut: true,
        });

        // User dismissed step 2 → include whole folder
        if (!step2Picked || step2Picked.length === 0) {
            finalScanPaths.push(folderPath);
            continue;
        }

        // "✅ Select ALL" was chosen → include whole folder
        if (step2Picked.some(p => p.label.startsWith('✅'))) {
            finalScanPaths.push(folderPath);
            continue;
        }

        // ══ STEP 3 ════════════════════════════════════════
        for (const s2 of step2Picked) {

            // root files of the Step-1 folder
            if (s2.label.startsWith('📄')) {
                finalScanPaths.push(folderPath + '/__ROOT_FILES__');
                continue;
            }

            const subName   = s2.label.trim().replace('📁 ', '');
            const subPath   = path.join(folderPath, subName);
            const subSubs   = getSubFolders(subPath);

            // no deeper subfolders → add directly
            if (subSubs.length === 0) {
                finalScanPaths.push(subPath);
                continue;
            }

            // has sub-subfolders → show step 3 picker
            const subRootFileCount = getRootCodeFileCount(subPath);
            const step3Items: vscode.QuickPickItem[] = [];

            step3Items.push({
                label:       '✅ Select ALL  (entire ' + subName + ')',
                description: 'Scan everything inside this subfolder recursively',
                picked:      false,
            });

            if (subRootFileCount > 0) {
                step3Items.push({
                    label:       '📄 (root files in ' + subName + ')',
                    description: `${subRootFileCount} file(s) directly in ${subName}/`,
                    picked:      false,
                });
            }

            for (const subsub of subSubs) {
                step3Items.push({
                    label:       '    📁 ' + subsub,
                    description: path.join(subPath, subsub),
                    picked:      false,
                });
            }

            const step3Picked = await vscode.window.showQuickPick(step3Items, {
                canPickMany:  true,
                placeHolder:  `Step 3 of 3 — Which parts of "${subName}" to include?`,
                title:        `CodeMap: ${folderName}/${subName} — Select Sub-subfolders`,
                ignoreFocusOut: true,
            });

            // User dismissed step 3 → include whole subfolder
            if (!step3Picked || step3Picked.length === 0) {
                finalScanPaths.push(subPath);
                continue;
            }

            // "✅ Select ALL" → include whole subfolder
            if (step3Picked.some(p => p.label.startsWith('✅'))) {
                finalScanPaths.push(subPath);
                continue;
            }

            // Add specific step 3 selections
            for (const s3 of step3Picked) {
                if (s3.label.startsWith('📄')) {
                    finalScanPaths.push(subPath + '/__ROOT_FILES__');
                } else {
                    const subsubName = s3.label.trim().replace('📁 ', '');
                    finalScanPaths.push(path.join(subPath, subsubName));
                }
            }
        }
    }

    if (finalScanPaths.length === 0) {
        vscode.window.showInformationMessage('CodeMap: Nothing selected.');
        return;
    }

    await buildAndShowGraph(finalScanPaths, rootPath, projectName, extensionPath);
}

// ── Extension activate ────────────────────────────────────
export function activate(context: vscode.ExtensionContext) {
    console.log('CodeMap Visualizer is now active!');

    // Command 1: Ctrl+Shift+P → "Generate Codebase Map"
    const generateMapCommand = vscode.commands.registerCommand(
        'codemap-visualizer.generate',
        async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage('Please open a folder first!');
                return;
            }
            const rootPath = workspaceFolders[0].uri.fsPath;
            await pickFoldersAndGenerate(
                rootPath,
                workspaceFolders[0].name,
                context.extensionPath
            );
        }
    );

    // Command 2: Right-click folder in Explorer → "Generate CodeMap for this folder"
    const generateForFolderCommand = vscode.commands.registerCommand(
        'codemap-visualizer.generateForFolder',
        async (uri: vscode.Uri) => {
            let folderPath: string;

            if (uri && uri.fsPath) {
                folderPath = uri.fsPath;
            } else {
                const picked = await vscode.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles:   false,
                    canSelectMany:    false,
                    openLabel:        'Generate CodeMap for this folder',
                });
                if (!picked || picked.length === 0) { return; }
                folderPath = picked[0].fsPath;
            }

            const folderName = path.basename(folderPath);
            await pickFoldersAndGenerate(folderPath, folderName, context.extensionPath);
        }
    );

    context.subscriptions.push(generateMapCommand);
    context.subscriptions.push(generateForFolderCommand);
}

export function deactivate() {}
