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

export function filterCodeFiles(allFiles: string[]): string[] {
    return allFiles.filter(file => 
        CODE_EXTENSIONS.some(ext => file.endsWith(ext))
    );
}