import * as fs from 'fs';
import * as path from 'path';

const IGNORE_DIRS = new Set([
    // dependency / build output
    'node_modules', '.git', '__pycache__', 'venv', '.venv', 'env',
    'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit',
    // cache / temp
    '.cache', '.parcel-cache', '.turbo', 'coverage', '.nyc_output',
    '.pytest_cache', '.mypy_cache', '.ruff_cache',
    // IDE / OS
    '.vscode', '.idea',
    // large data / static asset folders
    'backup', 'backups', 'logs', 'log',
    'assets', 'public', 'static', 'media',
    // schema / context / chunk dumps (large JSON folders)
    'schema', 'context', 'chunks', 'qdrant_storage',
    // python env internals
    'site-packages', 'lib', 'lib64', 'bin', 'share', 'include',
    // misc heavy folders
    'migrations', 'fixtures', 'seeds', 'testing',
    // third-party framework apps (frappe bench)
    'apps', 'frappe', 'erpnext', 'iitdata',
]);

// Max file size to parse — skip huge generated files (500 KB)
const MAX_FILE_BYTES = 500_000;

export function walkFolder(dirPath: string): string[] {
    let filesList: string[] = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return filesList; // permission denied — skip silently
    }
    for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            filesList = filesList.concat(walkFolder(fullPath));
        } else {
            try {
                const stat = fs.statSync(fullPath);
                if (stat.size <= MAX_FILE_BYTES) {
                    filesList.push(fullPath);
                }
            } catch {
                // skip unreadable files
            }
        }
    }
    return filesList;
}

const CODE_EXTENSIONS = ['.py', '.js', '.jsx', '.ts', '.tsx'];
const CSS_EXTENSIONS  = ['.css', '.scss', '.sass', '.less'];
const ENV_NAMES       = ['.env', '.env.local', '.env.development', '.env.production', '.env.test'];
const DB_EXTENSIONS   = ['.sql', '.prisma'];

// Python ORM imports that confirm a file is a real DB model file
const PYTHON_ORM_MARKERS = [
    'from sqlalchemy',
    'import sqlalchemy',
    'from django.db',
    'import django.db',
    'db.Model',
    'from tortoise',
    'import tortoise',
    'from peewee',
    'import peewee',
    'from mongoengine',
    'import mongoengine',
    'from pymongo',
    'import pymongo',
];

// Pydantic markers — these are NOT database models
const PYDANTIC_MARKERS = [
    'from pydantic',
    'import pydantic',
    'BaseModel',
];

export function filterCodeFiles(allFiles: string[]): string[] {
    return allFiles.filter(f => CODE_EXTENSIONS.some(ext => f.endsWith(ext)));
}

export function filterCssFiles(allFiles: string[]): string[] {
    return allFiles.filter(f => CSS_EXTENSIONS.some(ext => f.endsWith(ext)));
}

export function filterEnvFiles(allFiles: string[]): string[] {
    return allFiles.filter(f => {
        const base = path.basename(f);
        return ENV_NAMES.includes(base) || base.startsWith('.env');
    });
}

export function filterDbFiles(allFiles: string[]): string[] {
    return allFiles.filter(f => {
        // .sql and .prisma files are always DB files
        if (DB_EXTENSIONS.some(ext => f.endsWith(ext))) return true;

        // For .py files: content-check required — filename alone is NOT enough
        if (f.endsWith('.py')) {
            return isPythonDbFile(f);
        }

        return false;
    });
}

function isPythonDbFile(filePath: string): boolean {
    let raw = '';
    try { raw = fs.readFileSync(filePath, 'utf-8'); } catch { return false; }

    // If it imports Pydantic BaseModel → it's an API schema, NOT a DB model
    const isPydantic = PYDANTIC_MARKERS.some(m => raw.includes(m));
    if (isPydantic) return false;

    // Must have at least one real ORM import to qualify as a DB file
    return PYTHON_ORM_MARKERS.some(m => raw.includes(m));
}
