import * as fs from 'fs';
import * as path from 'path';
import { DbParseResult } from '../scanner/graphBuilder';

export function parseDbFile(filePath: string, rootPath: string): DbParseResult {
    const id         = path.relative(rootPath, filePath).replace(/\\/g, '/');
    const fileName   = path.basename(filePath);
    const folderPath = path.dirname(id) === '.' ? '' : path.dirname(id);

    let raw = '';
    try { raw = fs.readFileSync(filePath, 'utf-8'); } catch { /* unreadable */ }

    const loc      = raw.split('\n').length;
    const dbTables = extractSqlTables(raw);
    const dbModels = filePath.endsWith('.prisma')
        ? extractPrismaModels(raw)
        : extractPythonOrmModels(raw);

    return { id, fileName, folderPath, loc, dbTables, dbModels };
}

// SQL: CREATE TABLE users (...)
function extractSqlTables(raw: string): string[] {
    const tables: string[] = [];
    const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        tables.push(m[1]);
    }
    return [...new Set(tables)];
}

// Prisma: model User { ... }
function extractPrismaModels(raw: string): string[] {
    const models: string[] = [];
    const re = /^model\s+(\w+)\s*\{/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        models.push(m[1]);
    }
    return [...new Set(models)];
}

// Python ORM: class User(Base), class Post(db.Model), class Item(Document) etc.
// Explicitly excludes Pydantic BaseModel
const ORM_BASE_CLASSES = [
    'Base', 'db.Model', 'Model', 'Document', 'EmbeddedDocument',
    'DeclarativeBase', 'DeclarativeMeta', 'MongoModel',
];
const PYDANTIC_BASES = ['BaseModel', 'BaseSettings', 'BaseConfig'];

function extractPythonOrmModels(raw: string): string[] {
    const models: string[] = [];
    // match: class Foo(SomeBase):
    const re = /^class\s+(\w+)\s*\(([^)]+)\)\s*:/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        const className  = m[1];
        const baseClause = m[2];

        // skip Pydantic models
        if (PYDANTIC_BASES.some(b => baseClause.includes(b))) continue;

        // only include if inheriting from a known ORM base
        if (ORM_BASE_CLASSES.some(b => baseClause.includes(b))) {
            models.push(className);
        }
    }
    return [...new Set(models)];
}
