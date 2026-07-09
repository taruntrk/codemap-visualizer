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

export interface FileParseResult {
    id: string;
    fileName: string;
    language: string;
    imports: ImportInfo[];
    functions: FunctionInfo[];
    exports: string[];
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

        function walk(node: any) {
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
            loc: 0,
            parseError: e && e.message ? String(e.message) : String(e),
        };
    }
}