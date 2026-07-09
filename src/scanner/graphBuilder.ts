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
 * Tries to resolve a Python "from X import Y" module string (e.g. "model.sql")
 * into an actual file id from the parsed results (e.g. "model/sql.py").
 * Falls back to null if no matching file is found (external / stdlib import).
 */
function resolvePythonModule(moduleName: string, allNodeIds: Set<string>): string | null {
    if (!moduleName) {
        return null;
    }

    // "model.sql" -> "model/sql"
    const asPath = moduleName.replace(/\./g, '/');

    const candidates = [
        `${asPath}.py`,
        `${asPath}/__init__.py`,
    ];

    for (const candidate of candidates) {
        if (allNodeIds.has(candidate)) {
            return candidate;
        }
    }

    return null;
}

/**
 * Builds file-level "import" edges: source file -> target file it imports from.
 */
function buildImportEdges(parsedFiles: FileParseResult[], allNodeIds: Set<string>): GraphEdge[] {
    const edges: GraphEdge[] = [];

    for (const file of parsedFiles) {
        for (const imp of file.imports) {
            const targetId = resolvePythonModule(imp.from, allNodeIds);

            if (targetId && targetId !== file.id) {
                edges.push({
                    source: file.id,
                    target: targetId,
                    type: 'import',
                    importedSymbols: imp.names,
                });
            }
            // if targetId is null, it's treated as external and skipped for edges
        }
    }

    return edges;
}

/**
 * Builds cross-file "call" edges: for each function, checks if the names it calls
 * match a symbol imported from another (internal) file. If so, draws a function-level
 * call edge from the calling file/function to the target file/function.
 */
function buildCallEdges(parsedFiles: FileParseResult[], allNodeIds: Set<string>): GraphEdge[] {
    const edges: GraphEdge[] = [];

    for (const file of parsedFiles) {
        // Map: imported symbol name -> resolved target file id
        const symbolToTarget = new Map<string, string>();

        for (const imp of file.imports) {
            const targetId = resolvePythonModule(imp.from, allNodeIds);
            if (!targetId) {
                continue;
            }
            for (const name of imp.names) {
                symbolToTarget.set(name, targetId);
            }
        }

        if (symbolToTarget.size === 0) {
            continue;
        }

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