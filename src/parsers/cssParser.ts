import * as fs from 'fs';
import * as path from 'path';
import { CssParseResult } from '../scanner/graphBuilder';

export function parseCssFile(filePath: string, rootPath: string): CssParseResult {
    const id         = path.relative(rootPath, filePath).replace(/\\/g, '/');
    const fileName   = path.basename(filePath);
    const folderPath = path.dirname(id) === '.' ? '' : path.dirname(id);

    let raw = '';
    try { raw = fs.readFileSync(filePath, 'utf-8'); } catch { /* unreadable */ }

    const loc        = raw.split('\n').length;
    const cssImports = extractCssImports(raw);
    const cssClasses = extractCssClasses(raw);

    return { id, fileName, folderPath, loc, cssImports, cssClasses };
}

// @import './variables.css'  or  @import url('./reset.css')
function extractCssImports(raw: string): string[] {
    const imports: string[] = [];
    const re = /@import\s+(?:url\()?['"]([^'"]+)['"]\)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        imports.push(m[1]);
    }
    return [...new Set(imports)];
}

// .className, #id (class names only, skip pseudo and keyframe names)
function extractCssClasses(raw: string): string[] {
    const classes: string[] = [];
    // remove comments first
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
        classes.push(m[1]);
    }
    return [...new Set(classes)].slice(0, 40); // cap at 40 for tooltip
}
