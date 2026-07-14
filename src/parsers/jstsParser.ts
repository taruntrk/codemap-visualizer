import * as fs from 'fs';
import * as path from 'path';
const { Parser, Language }: any = require('web-tree-sitter');

let jsLanguage: any = null;
let tsLanguage: any = null;
let parserInitialized = false;

async function initializeParser(extensionPath: string): Promise<void> {
    if (parserInitialized) return;

    await Parser.init({
        locateFile: () => path.join(extensionPath, 'grammars', 'web-tree-sitter.wasm')
    });

    jsLanguage = await Language.load(
        path.join(extensionPath, 'grammars', 'tree-sitter-javascript.wasm')
    );
    tsLanguage = await Language.load(
        path.join(extensionPath, 'grammars', 'tree-sitter-typescript.wasm')
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

export interface ApiCallInfo {
    url: string;       // e.g. '/api/users'
    method: string;    // 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ANY'
}

export interface FileParseResult {
    id: string;
    fileName: string;
    language: string;
    imports: ImportInfo[];
    functions: FunctionInfo[];
    exports: string[];
    apiCalls: ApiCallInfo[];   // fetch/axios calls extracted
    loc: number;
    parseError: string | null;
}

export async function parseJsTsFile(
    filePath: string,
    rootPath: string,
    extensionPath: string
): Promise<FileParseResult> {
    await initializeParser(extensionPath);

    const ext = path.extname(filePath).toLowerCase();
    const relativePath = path.relative(rootPath, filePath).replace(/\\/g, '/');
    const fileName = path.basename(filePath);
    const isTs = ext === '.ts' || ext === '.tsx';
    const language = isTs ? 'typescript' : 'javascript';

    try {
        const sourceCode = fs.readFileSync(filePath, 'utf8');
        const parser = new Parser();
        parser.setLanguage(isTs ? tsLanguage : jsLanguage);
        const tree = parser.parse(sourceCode);

        const imports: ImportInfo[] = [];
        const functions: FunctionInfo[] = [];
        const exportsArr: string[] = [];
        const apiCalls: ApiCallInfo[] = [];

        // ── helpers for API call extraction ──────────────
        // Normalise a URL string: strip quotes, trailing slash, lowercase
        function normaliseUrl(raw: string): string {
            return raw.replace(/['"` ]/g, '').replace(/\/$/, '').toLowerCase();
        }

        // Try to extract a string literal from a node (handles template literals too)
        function extractStringArg(node: any): string | null {
            if (!node) return null;
            if (node.type === 'string' || node.type === 'string_literal') {
                return node.text.replace(/['"]/g, '');
            }
            if (node.type === 'template_string') {
                // grab the static prefix before the first ${}
                const raw = node.text.replace(/`/g, '');
                return raw.split('${')[0];
            }
            return null;
        }

        // Detect HTTP method from a call like axios.get / axios.post / api.get etc.
        function methodFromName(name: string): string {
            const n = name.toLowerCase();
            if (n === 'get')    return 'GET';
            if (n === 'post')   return 'POST';
            if (n === 'put')    return 'PUT';
            if (n === 'delete' || n === 'del') return 'DELETE';
            if (n === 'patch')  return 'PATCH';
            return 'ANY';
        }

        function extractApiCall(node: any) {
            if (node.type !== 'call_expression') return;
            const funcNode = node.childForFieldName('function');
            const argsNode = node.childForFieldName('arguments');
            if (!funcNode || !argsNode) return;

            // args[0] is the URL argument
            const argChildren = (argsNode.children || []).filter(
                (c: any) => c.type !== ',' && c.type !== '(' && c.type !== ')'
            );
            const firstArg = argChildren[0];
            if (!firstArg) return;

            // Case 1: fetch('/api/...') or fetch(url, { method: 'POST' })
            if (funcNode.type === 'identifier' && funcNode.text === 'fetch') {
                const url = extractStringArg(firstArg);
                if (url && (url.startsWith('/') || url.includes('/api/'))) {
                    // Try to detect method from second arg: { method: 'POST' }
                    let method = 'GET';
                    const secondArg = argChildren[1];
                    if (secondArg && secondArg.type === 'object') {
                        for (const prop of secondArg.children || []) {
                            if (prop.type === 'pair') {
                                const key = prop.childForFieldName('key');
                                const val = prop.childForFieldName('value');
                                if (key && key.text.replace(/['"]/g,'') === 'method' && val) {
                                    method = val.text.replace(/['"]/g,'').toUpperCase() || 'GET';
                                }
                            }
                        }
                    }
                    apiCalls.push({ url: normaliseUrl(url), method });
                }
                return;
            }

            // Case 2: axios.get('/api/...') / axios.post(...) / api.get(...) / http.get(...)
            if (funcNode.type === 'member_expression') {
                const obj  = funcNode.childForFieldName('object');
                const prop = funcNode.childForFieldName('property');
                if (!obj || !prop) return;
                const objName  = obj.text.toLowerCase();
                const propName = prop.text.toLowerCase();
                const isHttpClient = ['axios','api','http','client','request','instance','$http','$axios'].includes(objName);
                const isHttpMethod = ['get','post','put','delete','del','patch','request'].includes(propName);
                if (isHttpClient && isHttpMethod) {
                    const url = extractStringArg(firstArg);
                    if (url && (url.startsWith('/') || url.includes('/api/'))) {
                        apiCalls.push({ url: normaliseUrl(url), method: methodFromName(propName) });
                    }
                }
            }
        }

        function walk(node: any) {
            // import statements: import { x } from 'y'  /  import x from 'y'
            if (node.type === 'import_statement') {
                let fromModule = '';
                const names: string[] = [];

                for (const child of node.children) {
                    if (child.type === 'string') {
                        // remove quotes
                        fromModule = child.text.replace(/['"]/g, '');
                    }
                    // import { a, b }
                    if (child.type === 'import_clause') {
                        for (const ic of child.children) {
                            if (ic.type === 'named_imports') {
                                for (const ni of ic.children) {
                                    if (ni.type === 'import_specifier') {
                                        const nameNode = ni.childForFieldName('name');
                                        if (nameNode) names.push(nameNode.text);
                                    }
                                }
                            }
                            // import x from ...
                            if (ic.type === 'identifier') {
                                names.push(ic.text);
                            }
                            // import * as x
                            if (ic.type === 'namespace_import') {
                                for (const nc of ic.children) {
                                    if (nc.type === 'identifier') names.push(nc.text);
                                }
                            }
                        }
                    }
                }
                if (fromModule) imports.push({ from: fromModule, names });
            }

            // require() calls: const x = require('y')
            if (node.type === 'call_expression') {
                const funcNode = node.childForFieldName('function');
                if (funcNode && funcNode.text === 'require') {
                    const argsNode = node.childForFieldName('arguments');
                    if (argsNode) {
                        for (const arg of argsNode.children) {
                            if (arg.type === 'string') {
                                const fromModule = arg.text.replace(/['"]/g, '');
                                imports.push({ from: fromModule, names: [] });
                            }
                        }
                    }
                }
                // API call detection (fetch / axios / api.get etc.)
                extractApiCall(node);
            }

            // function declarations: function foo() {}
            if (node.type === 'function_declaration' || node.type === 'function') {
                const nameNode = node.childForFieldName('name');
                const paramsNode = node.childForFieldName('parameters');
                const bodyNode = node.childForFieldName('body');
                extractFunction(nameNode?.text || 'anonymous', paramsNode, bodyNode);
            }

            // arrow functions / method definitions assigned to variables
            // const foo = () => {}  /  const foo = function() {}
            if (
                node.type === 'variable_declarator' ||
                node.type === 'assignment_expression'
            ) {
                const nameNode = node.childForFieldName('name') || node.childForFieldName('left');
                const valueNode = node.childForFieldName('value') || node.childForFieldName('right');
                if (
                    valueNode &&
                    (valueNode.type === 'arrow_function' || valueNode.type === 'function')
                ) {
                    const paramsNode = valueNode.childForFieldName('parameters');
                    const bodyNode = valueNode.childForFieldName('body');
                    extractFunction(nameNode?.text || 'anonymous', paramsNode, bodyNode);
                }
            }

            // method definitions inside classes
            if (node.type === 'method_definition') {
                const nameNode = node.childForFieldName('name');
                const valueNode = node.childForFieldName('value');
                if (valueNode) {
                    const paramsNode = valueNode.childForFieldName('parameters');
                    const bodyNode = valueNode.childForFieldName('body');
                    extractFunction(nameNode?.text || 'anonymous', paramsNode, bodyNode);
                }
            }

            // export declarations — collect exported names
            if (
                node.type === 'export_statement' ||
                node.type === 'export_default_declaration' ||
                node.type === 'export_named_declaration'
            ) {
                for (const child of node.children) {
                    if (
                        child.type === 'function_declaration' ||
                        child.type === 'class_declaration'
                    ) {
                        const nameNode = child.childForFieldName('name');
                        if (nameNode) exportsArr.push(nameNode.text);
                    }
                    if (child.type === 'export_clause') {
                        for (const ec of child.children) {
                            if (ec.type === 'export_specifier') {
                                const nameNode = ec.childForFieldName('name');
                                if (nameNode) exportsArr.push(nameNode.text);
                            }
                        }
                    }
                }
            }

            for (const child of node.children || []) {
                walk(child);
            }
        }

        function extractFunction(name: string, paramsNode: any, bodyNode: any) {
            const params: string[] = [];
            const calls: string[] = [];

            if (paramsNode) {
                for (const child of paramsNode.children) {
                    if (child.type === 'identifier') params.push(child.text);
                    if (child.type === 'required_parameter' || child.type === 'optional_parameter') {
                        const pName = child.childForFieldName('pattern') || child.children.find((c: any) => c.type === 'identifier');
                        if (pName) params.push(pName.text);
                    }
                }
            }

            if (bodyNode) {
                function findCalls(n: any) {
                    if (n.type === 'call_expression') {
                        const funcNode = n.childForFieldName('function');
                        if (funcNode) {
                            if (funcNode.type === 'identifier') {
                                calls.push(funcNode.text);
                            } else if (funcNode.type === 'member_expression') {
                                // e.g. obj.method() — push method name
                                const prop = funcNode.childForFieldName('property');
                                if (prop) calls.push(prop.text);
                            }
                        }
                    }
                    for (const child of n.children || []) findCalls(child);
                }
                findCalls(bodyNode);
            }

            functions.push({ name, params, calls });
        }

        walk((tree as any).rootNode);

        const loc = sourceCode.split(/\r\n|\r|\n/).length;

        return {
            id: relativePath,
            fileName,
            language,
            imports,
            functions,
            exports: exportsArr,
            apiCalls,
            loc,
            parseError: null,
        };
    } catch (e: any) {
        return {
            id: relativePath,
            fileName,
            language,
            imports: [],
            functions: [],
            exports: [],
            apiCalls: [],
            loc: 0,
            parseError: e?.message ? String(e.message) : String(e),
        };
    }
}