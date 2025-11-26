import { fileTypeFromBuffer, fileTypeFromFile } from 'file-type';

export async function detectMimeType(input) {
    try {
        const result = Buffer.isBuffer(input)
            ? await fileTypeFromBuffer(input)
            : await fileTypeFromFile(input);
        return result?.mime || 'application/octet-stream';
    } catch {
        return 'application/octet-stream';
    }
}

