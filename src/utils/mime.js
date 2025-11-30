import { fileTypeFromBuffer, fileTypeFromFile } from 'file-type';
import path from 'path';

// Extension-based MIME types for common text/code files (magic bytes don't work for these)
const TEXT_MIME_TYPES = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.ts': 'text/typescript',
    '.tsx': 'text/typescript',
    '.jsx': 'text/javascript',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.csv': 'text/csv',
    '.log': 'text/plain',
    '.sh': 'text/x-shellscript',
    '.bash': 'text/x-shellscript',
    '.zsh': 'text/x-shellscript',
    '.py': 'text/x-python',
    '.rb': 'text/x-ruby',
    '.go': 'text/x-go',
    '.rs': 'text/x-rust',
    '.c': 'text/x-c',
    '.h': 'text/x-c',
    '.cpp': 'text/x-c++',
    '.hpp': 'text/x-c++',
    '.java': 'text/x-java',
    '.sql': 'text/x-sql',
    '.ini': 'text/plain',
    '.conf': 'text/plain',
    '.cfg': 'text/plain',
    '.env': 'text/plain',
    '.toml': 'text/toml',
};

export async function detectMimeType(input) {
    try {
        // Try magic bytes first
        const result = Buffer.isBuffer(input)
            ? await fileTypeFromBuffer(input)
            : await fileTypeFromFile(input);

        if (result?.mime) return result.mime;

        // Fallback to extension-based detection for text files
        if (typeof input === 'string') {
            const ext = path.extname(input).toLowerCase();
            if (TEXT_MIME_TYPES[ext]) return TEXT_MIME_TYPES[ext];
        }

        return 'application/octet-stream';
    } catch {
        return 'application/octet-stream';
    }
}

