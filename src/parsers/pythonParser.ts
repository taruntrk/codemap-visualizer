import * as fs from 'fs';
import * as path from 'path';
const { Parser, Language }: any = require('web-tree-sitter');
let pythonLanguage: any = null;
let parserInitialized = false;

async function initializeParser(extensionPath: string): Promise<void> {
    if (parserInitialized) {
        return;
    }
    await Parser.init({
        locateFile: () => path.join(extensionPath, 'grammars', 'web-tree-sitter.wasm')
    });
    pythonLanguage = await Language.load(
        path.join(extensionPath, 'grammars', 'tree-sitter-python.wasm')
    );
    parserInitialized = true;
}

export interface ImportInfo {
    from: string;
    names: string[];
}

export interface FunctionInfo {
    name: string;
    params: string[];
    calls: string[];
}

export interface ApiRouteInfo {
    url: string;      // e.g. '/api/users'
    method: string;   // 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ANY'
}

export interface FileParseResult {
    id: string;
    fileName: string;
    language: string;
    imports: ImportInfo[];
    functions: FunctionInfo[];
    exports: string[];
    apiRoutes: ApiRouteInfo[];   // route decorators extracted
    loc: number;
    parseError: string | null;
}

export async function parsePythonFile(filePath: string, rootPath: string, extensionPath: string): Promise<FileParseResult> {
    await initializeParser(extensionPath);

    const relativePath = path.relative(rootPath, filePath).replace(/\\/g, '/');
    const fileName = path.basename(filePath);

    try {
        const sourceCode = fs.readFileSync(filePath, 'utf8');
        const parser = new Parser();
        parser.setLanguage(pythonLanguage);
        const tree = parser.parse(sourceCode);

        const imports: ImportInfo[] = [];
        const functions: FunctionInfo[] = [];
        const apiRoutes: ApiRouteInfo[] = [];

        // ── helpers for route decorator extraction ────────
        function normaliseUrl(raw: string): string {
            return raw.replace(/['"` ]/g, '').replace(/\/$/, '').toLowerCase();
        }

        // Detect HTTP method from decorator name: @app.get → GET
        function methodFromDecorator(name: string): string {
            const n = name.toLowerCase();
            if (n === 'get')    return 'GET';
            if (n === 'post')   return 'POST';
            if (n === 'put')    return 'PUT';
            if (n === 'delete') return 'DELETE';
            if (n === 'patch')  return 'PATCH';
            if (n === 'route')  return 'ANY';
            return 'ANY';
        }

        // Extract route from a decorator node
        // Handles: @app.route('/url'), @app.get('/url'), @router.post('/url'),
        //          @bp.route('/url', methods=['GET','POST'])
        function extractDecorator(decoratorNode: any) {
            // decorator -> call -> function(member_expression) + arguments
            for (const child of decoratorNode.children || []) {
                if (child.type === 'call') {
                    const funcNode = child.childForFieldName('function');
                    const argsNode = child.childForFieldName('arguments');
                    if (!funcNode || !argsNode) continue;

                    // funcNode should be member_expression: app.route / router.get etc.
                    let methodName = '';
                    if (funcNode.type === 'attribute') {
                        const attr = funcNode.childForFieldName('attribute');
                        if (attr) methodName = attr.text.toLowerCase();
                    } else if (funcNode.type === 'identifier') {
                        methodName = funcNode.text.toLowerCase();
                    }

                    const isRouteDecorator = [
                        'route','get','post','put','delete','patch','head','options'
                    ].includes(methodName);
                    if (!isRouteDecorator) continue;

                    // First positional arg is the URL
                    const argChildren = (argsNode.children || []).filter(
                        (c: any) => c.type !== ',' && c.type !== '(' && c.type !== ')'
                    );
                    const firstArg = argChildren[0];
                    if (!firstArg) continue;

                    let url = '';
                    if (firstArg.type === 'string') {
                        url = firstArg.text.replace(/['"]/g, '');
                    } else if (firstArg.type === 'concatenated_string') {
                        // 'prefix' + '/path' style
                        url = firstArg.text.replace(/['"]/g, '').replace(/\s*\+\s*/g, '');
                    }

                    if (!url) continue;

                    // Detect methods from methods=[...] kwarg (Flask style)
                    let method = methodFromDecorator(methodName);
                    for (const arg of argChildren.slice(1)) {
                        if (arg.type === 'keyword_argument') {
                            const key = arg.childForFieldName('name');
                            const val = arg.childForFieldName('value');
                            if (key && key.text === 'methods' && val) {
                                // methods=['GET','POST'] → take first
                                const firstMethod = val.text.match(/['"](\w+)['"]/);
                                if (firstMethod) method = firstMethod[1].toUpperCase();
                            }
                        }
                    }

                    apiRoutes.push({ url: normaliseUrl(url), method });
                }
            }
        }

        function walk(node: any) {
            // route decorators: @app.route, @app.get, @router.post, etc.
            if (node.type === 'decorated_definition') {
                for (const child of node.children || []) {
                    if (child.type === 'decorator') {
                        extractDecorator(child);
                    }
                }
            }

            if (node.type === 'import_from_statement') {
                const moduleNode = node.childForFieldName('module_name');
                const moduleName = moduleNode ? moduleNode.text : '';
                const names: string[] = [];

                for (const child of node.children) {
                    if (child.type === 'dotted_name' && child !== moduleNode) {
                        names.push(child.text);
                    } else if (child.type === 'aliased_import') {
                        const nameNode = child.childForFieldName('name');
                        if (nameNode) names.push(nameNode.text);
                    }
                }
                imports.push({ from: moduleName, names });
            }

            if (node.type === 'import_statement') {
                for (const child of node.children) {
                    if (child.type === 'dotted_name') {
                        imports.push({ from: child.text, names: [] });
                    }
                }
            }

            if (node.type === 'function_definition') {
                const nameNode = node.childForFieldName('name');
                const paramsNode = node.childForFieldName('parameters');
                const bodyNode = node.childForFieldName('body');

                const funcName = nameNode ? nameNode.text : 'anonymous';
                const params: string[] = [];
                const calls: string[] = [];

                if (paramsNode) {
                    for (const child of paramsNode.children) {
                        if (child.type === 'identifier') {
                            params.push(child.text);
                        }
                    }
                }

                if (bodyNode) {
                    function findCalls(n: any) {
                        if (n.type === 'call') {
                            const funcNode = n.childForFieldName('function');
                            if (funcNode && funcNode.type === 'identifier') {
                                calls.push(funcNode.text);
                            }
                        }
                        for (const child of n.children) {
                            findCalls(child);
                        }
                    }
                    findCalls(bodyNode);
                }

                functions.push({ name: funcName, params, calls });
            }

            for (const child of node.children || []) {
                walk(child);
            }
        }

        // start walking the tree
        walk((tree as any).rootNode);

        const exportsArr: string[] = [];
        const loc = sourceCode.split(/\r\n|\r|\n/).length;

        return {
            id: relativePath,
            fileName,
            language: 'python',
            imports,
            functions,
            exports: exportsArr,
            apiRoutes,
            loc,
            parseError: null,
        };
    } catch (e: any) {
        return {
            id: relativePath,
            fileName,
            language: 'python',
            imports: [],
            functions: [],
            exports: [],
            apiRoutes: [],
            loc: 0,
            parseError: e && e.message ? String(e.message) : String(e),
        };
    }
}