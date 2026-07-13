import * as fs from 'fs';
import * as path from 'path';

const IGNORE_LIST = ['node_modules', '.git', '__pycache__', 'venv', 'dist', 'build', '.vscode'];

export function walkFolder(dirPath: string): string[] {
    let filesList: string[] = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            if (!IGNORE_LIST.includes(entry.name)) {
                filesList = filesList.concat(walkFolder(fullPath));
            }
        } else {
            filesList.push(fullPath);
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
