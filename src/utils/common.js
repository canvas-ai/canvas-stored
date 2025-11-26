import fs from 'fs';

export function isJson(input) {
    if (typeof input !== 'object' || input === null) return false;
    try {
        JSON.stringify(input);
        return true;
    } catch { return false; }
}

export function isFile(input) {
    if (typeof input !== 'string') return false;
    try { return fs.statSync(input).isFile(); }
    catch { return false; }
}

export function isBuffer(input) {
    return Buffer.isBuffer(input);
}

export function isStream(input) {
    return input && typeof input.pipe === 'function';
}
