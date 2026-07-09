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
    type: 'import';
    importedSymbols: string[];
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
            // if targetId is null, it's treated as external (isExternal) and skipped for edges
        }
    }

    return {
        projectName,
        generatedAt: new Date().toISOString(),
        nodes,
        edges,
    };
}