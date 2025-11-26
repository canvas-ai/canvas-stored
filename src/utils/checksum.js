import crypto from 'crypto';
import fs from 'fs';

export function checksumBuffer(buffer, algorithms = ['sha256']) {
    const checksums = {};
    for (const algo of algorithms) {
        checksums[algo] = crypto.createHash(algo).update(buffer).digest('hex');
    }
    return checksums;
}

export async function checksumStream(stream, algorithms = ['sha256']) {
    const hashes = algorithms.map(algo => ({ algo, hash: crypto.createHash(algo) }));

    for await (const chunk of stream) {
        for (const { hash } of hashes) hash.update(chunk);
    }

    const checksums = {};
    for (const { algo, hash } of hashes) {
        checksums[algo] = hash.digest('hex');
    }
    return checksums;
}

export function checksumFile(filePath, algorithms = ['sha256']) {
    return checksumStream(fs.createReadStream(filePath), algorithms);
}

export function formatId(checksums, primaryAlgo = 'sha256') {
    return `${primaryAlgo}:${checksums[primaryAlgo]}`;
}
