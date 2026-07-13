import * as path from 'path';
import { FileParseResult } from '../parsers/pythonParser';

export type NodeType = 'code' | 'css' | 'env' | 'database';

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
    nodeType: NodeType;
    // css-specific
    cssImports?: string[];
    cssClasses?: string[];
    // env-specific
    envKeys?: string[];
    envDbKeys?: string[];
    envApiKeys?: string[];
    // db-specific
    dbTables?: string[];
    dbModels?: string[];
    // db usage badge — for code files that call DB clients directly
    dbUsage?: string[];   // e.g. ['mongoose', 'pymongo', 'prisma']
}

export interface GraphEdge {
    source: string;
    target: string;
    type: 'import' | 'call' | 'css-import' | 'env-use' | 'db-use';
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
        nodeType: 'code' as NodeType,
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

// ── Special nodes (CSS / .env / DB) ──────────────────────────────────────────

export interface CssParseResult {
    id: string;
    fileName: string;
    folderPath: string;
    loc: number;
    cssImports: string[];
    cssClasses: string[];
}

export interface EnvParseResult {
    id: string;
    fileName: string;
    folderPath: string;
    envKeys: string[];
    envDbKeys: string[];
    envApiKeys: string[];
}

export interface DbParseResult {
    id: string;
    fileName: string;
    folderPath: string;
    loc: number;
    dbTables: string[];
    dbModels: string[];
}

export function buildGraphWithSpecial(
    base: CodeGraph,
    cssFiles: CssParseResult[],
    envFiles: EnvParseResult[],
    dbFiles: DbParseResult[]
): CodeGraph {
    const extraNodes: GraphNode[] = [];
    const extraEdges: GraphEdge[] = [];

    const allNodeIds = new Set(base.nodes.map(n => n.id));

    // ── CSS nodes ──────────────────────────────────────────
    for (const css of cssFiles) {
        extraNodes.push({
            id: css.id,
            fileName: css.fileName,
            folderPath: css.folderPath,
            language: 'css',
            loc: css.loc,
            functions: [],
            imports: [],
            exports: [],
            summary: null,
            category: null,
            parseError: null,
            nodeType: 'css',
            cssImports: css.cssImports,
            cssClasses: css.cssClasses,
        });
        allNodeIds.add(css.id);
    }

    // CSS → CSS import edges
    for (const css of cssFiles) {
        for (const imp of css.cssImports) {
            const resolved = resolveCssImport(imp, css.id, allNodeIds);
            if (resolved) {
                extraEdges.push({ source: css.id, target: resolved, type: 'css-import' });
            }
        }
    }

    // Code files that import a CSS file (e.g. import './App.css')
    for (const node of base.nodes) {
        for (const imp of node.imports) {
            if (imp.from.endsWith('.css') || imp.from.endsWith('.scss') || imp.from.endsWith('.less')) {
                const resolved = resolveCssImport(imp.from, node.id, allNodeIds);
                if (resolved) {
                    extraEdges.push({ source: node.id, target: resolved, type: 'css-import' });
                }
            }
        }
    }

    // ── ENV nodes ──────────────────────────────────────────
    for (const env of envFiles) {
        extraNodes.push({
            id: env.id,
            fileName: env.fileName,
            folderPath: env.folderPath,
            language: 'env',
            loc: env.envKeys.length,
            functions: [],
            imports: [],
            exports: [],
            summary: null,
            category: null,
            parseError: null,
            nodeType: 'env',
            envKeys: env.envKeys,
            envDbKeys: env.envDbKeys,
            envApiKeys: env.envApiKeys,
        });
        allNodeIds.add(env.id);
    }

    // Code files that reference process.env.KEY → link to matching .env node
    if (envFiles.length > 0) {
        const allEnvKeys = new Map<string, string>(); // key → env file id
        for (const env of envFiles) {
            for (const k of env.envKeys) allEnvKeys.set(k, env.id);
        }

        for (const node of base.nodes) {
            // check each import's from field — not perfect but catches dotenv usage
            const usesEnv = node.imports.some(i => i.from === 'dotenv' || i.from.includes('dotenv'));
            if (usesEnv) {
                for (const env of envFiles) {
                    extraEdges.push({ source: node.id, target: env.id, type: 'env-use' });
                }
            }
        }
    }

    // ── DB nodes ───────────────────────────────────────────
    for (const db of dbFiles) {
        extraNodes.push({
            id: db.id,
            fileName: db.fileName,
            folderPath: db.folderPath,
            language: 'database',
            loc: db.loc,
            functions: [],
            imports: [],
            exports: [],
            summary: null,
            category: null,
            parseError: null,
            nodeType: 'database',
            dbTables: db.dbTables,
            dbModels: db.dbModels,
        });
        allNodeIds.add(db.id);
    }

    // Comprehensive DB client detection — JS/TS + Python
    const DB_CLIENTS: Record<string, string> = {
        '@prisma/client': 'prisma',   'prisma': 'prisma',
        'mongoose':       'mongoose', 'mongodb':      'mongodb',
        'sequelize':      'sequelize','typeorm':       'typeorm',
        'knex':           'knex',     'pg':            'postgres',
        'mysql2':         'mysql',    'mysql':         'mysql',
        'sqlite3':        'sqlite',   'better-sqlite3':'sqlite',
        'redis':          'redis',    'ioredis':       'redis',
        'pymongo':        'pymongo',  'motor':         'motor',
        'sqlalchemy':     'sqlalchemy','tortoise':     'tortoise',
        'peewee':         'peewee',   'mongoengine':   'mongoengine',
        'django.db':      'django-orm',
    };

    for (const node of base.nodes) {
        const matched: string[] = [];
        for (const imp of node.imports) {
            for (const [pkg, label] of Object.entries(DB_CLIENTS)) {
                if (imp.from.includes(pkg) && !matched.includes(label)) {
                    matched.push(label);
                }
            }
        }
        if (matched.length > 0) {
            (node as GraphNode & { dbUsage: string[] }).dbUsage = matched;
            if (dbFiles.length > 0) {
                for (const db of dbFiles) {
                    extraEdges.push({ source: node.id, target: db.id, type: 'db-use' });
                }
            }
        }
    }

    return {
        ...base,
        nodes: [...base.nodes, ...extraNodes],
        edges: [...base.edges, ...extraEdges],
    };
}

function resolveCssImport(imp: string, sourceId: string, allNodeIds: Set<string>): string | null {
    if (!imp.startsWith('.')) return null;
    const sourceDir = path.dirname(sourceId);
    const resolved  = path.join(sourceDir, imp).replace(/\\/g, '/');
    const candidates = [resolved, resolved + '.css', resolved + '.scss', resolved + '.less'];
    for (const c of candidates) {
        if (allNodeIds.has(c)) return c;
    }
    return null;
}