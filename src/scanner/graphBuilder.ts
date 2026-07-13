import * as path from 'path';
import { FileParseResult } from '../parsers/pythonParser';

export interface GraphNode {
    id: string;
    fileName: string;
    folderPath: string;
    language: string;
    loc: number;
    functions: FileParseResult['functions'];
    imports: FileParseResult['imports'];
    exports: string[];
    summary: string | null;
    category: string | null;
    parseError: string | null;
}

export interface GraphEdge {
    source: string;
    target: string;
    type: 'import' | 'call';
    importedSymbols?: string[];
    sourceFunction?: string;
    targetFunction?: string;
}

export interface CodeGraph {
    projectName: string;
    generatedAt: string;
    nodes: GraphNode[];
    edges: GraphEdge[];
}

/**
 * Python: "model.sql" -> "model/sql.py"
 */
function resolvePythonModule(moduleName: string, allNodeIds: Set<string>): string | null {
    if (!moduleName) return null;

    const asPath = moduleName.replace(/\./g, '/');
    const candidates = [
        `${asPath}.py`,
        `${asPath}/__init__.py`,
    ];

    for (const candidate of candidates) {
        if (allNodeIds.has(candidate)) return candidate;
    }
    return null;
}

/**
 * JS/TS: "./utils" -> "src/utils.ts" (relative imports only, npm packages skip)
 */
function resolveJsTsModule(moduleName: string, sourceFileId: string, allNodeIds: Set<string>): string | null {
    // sirf relative imports — npm packages (react, express, etc.) skip
    if (!moduleName.startsWith('.')) return null;

    const sourceDir = path.dirname(sourceFileId);
    const resolved = path.join(sourceDir, moduleName).replace(/\\/g, '/');

    const candidates = [
        `${resolved}.ts`,
        `${resolved}.tsx`,
        `${resolved}.js`,
        `${resolved}.jsx`,
        `${resolved}/index.ts`,
        `${resolved}/index.tsx`,
        `${resolved}/index.js`,
        `${resolved}/index.jsx`,
    ];

    for (const candidate of candidates) {
        if (allNodeIds.has(candidate)) return candidate;
    }
    return null;
}

function buildImportEdges(parsedFiles: FileParseResult[], allNodeIds: Set<string>): GraphEdge[] {
    const edges: GraphEdge[] = [];

    for (const file of parsedFiles) {
        for (const imp of file.imports) {
            // pehle Python resolution try karo
            let targetId = resolvePythonModule(imp.from, allNodeIds);

            // agar Python ne nahi pakda to JS/TS resolution try karo
            if (!targetId) {
                targetId = resolveJsTsModule(imp.from, file.id, allNodeIds);
            }

            if (targetId && targetId !== file.id) {
                edges.push({
                    source: file.id,
                    target: targetId,
                    type: 'import',
                    importedSymbols: imp.names,
                });
            }
        }
    }

    return edges;
}

function buildCallEdges(parsedFiles: FileParseResult[], allNodeIds: Set<string>): GraphEdge[] {
    const edges: GraphEdge[] = [];

    for (const file of parsedFiles) {
        const symbolToTarget = new Map<string, string>();

        for (const imp of file.imports) {
            // Python resolution
            let targetId = resolvePythonModule(imp.from, allNodeIds);

            // JS/TS resolution fallback
            if (!targetId) {
                targetId = resolveJsTsModule(imp.from, file.id, allNodeIds);
            }

            if (!targetId) continue;

            for (const name of imp.names) {
                symbolToTarget.set(name, targetId);
            }
        }

        if (symbolToTarget.size === 0) continue;

        for (const fn of file.functions) {
            for (const callName of fn.calls) {
                const targetId = symbolToTarget.get(callName);
                if (targetId && targetId !== file.id) {
                    edges.push({
                        source: file.id,
                        target: targetId,
                        type: 'call',
                        sourceFunction: fn.name,
                        targetFunction: callName,
                    });
                }
            }
        }
    }

    return edges;
}

export function buildGraph(projectName: string, parsedFiles: FileParseResult[]): CodeGraph {
    const nodes: GraphNode[] = parsedFiles.map(file => ({
        id: file.id,
        fileName: file.fileName,
        folderPath: path.dirname(file.id) === '.' ? '' : path.dirname(file.id),
        language: file.language,
        loc: file.loc,
        functions: file.functions,
        imports: file.imports,
        exports: file.exports,
        summary: null,
        category: null,
        parseError: file.parseError,
    }));

    const allNodeIds = new Set(nodes.map(n => n.id));

    const importEdges = buildImportEdges(parsedFiles, allNodeIds);
    const callEdges = buildCallEdges(parsedFiles, allNodeIds);

    return {
        projectName,
        generatedAt: new Date().toISOString(),
        nodes,
        edges: [...importEdges, ...callEdges],
    };
}