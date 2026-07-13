import * as fs from 'fs';
import * as path from 'path';
import { EnvParseResult } from '../scanner/graphBuilder';

const DB_KEY_PATTERNS  = ['DB_', 'DATABASE_', 'MONGO', 'REDIS', 'POSTGRES', 'MYSQL', 'SQLITE', 'PG_', 'SQL_'];
const API_KEY_PATTERNS = ['API_KEY', 'API_SECRET', 'TOKEN', 'SECRET', 'JWT', 'AUTH', 'OAUTH', 'CLIENT_ID', 'CLIENT_SECRET'];

export function parseEnvFile(filePath: string, rootPath: string): EnvParseResult {
    const id         = path.relative(rootPath, filePath).replace(/\\/g, '/');
    const fileName   = path.basename(filePath);
    const folderPath = path.dirname(id) === '.' ? '' : path.dirname(id);

    let raw = '';
    try { raw = fs.readFileSync(filePath, 'utf-8'); } catch { /* unreadable */ }

    const envKeys: string[]    = [];
    const envDbKeys: string[]  = [];
    const envApiKeys: string[] = [];

    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        // skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;

        const key = trimmed.substring(0, eqIdx).trim();
        if (!key) continue;

        // NEVER store values — security
        envKeys.push(key);

        if (DB_KEY_PATTERNS.some(p => key.toUpperCase().includes(p))) {
            envDbKeys.push(key);
        } else if (API_KEY_PATTERNS.some(p => key.toUpperCase().includes(p))) {
            envApiKeys.push(key);
        }
    }

    return { id, fileName, folderPath, envKeys, envDbKeys, envApiKeys };
}
