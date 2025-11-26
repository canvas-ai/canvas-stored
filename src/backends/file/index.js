import fs from 'fs-extra';
import path from 'path';
import chokidar from 'chokidar';
import Debug from 'debug';
import StorageBackend from '../StorageBackend.js';
import { checksumFile } from '../../utils/checksum.js';
import { detectMimeType } from '../../utils/mime.js';

const debug = Debug('stored:backend:file');

export default class FileBackend extends StorageBackend {
    #root;
    #watcher = null;
    #watchEnabled;
    #defaultAlgorithms = ['sha256'];

    constructor(name, config = {}) {
        super(name, config);
        if (!config.root) throw new Error('FileBackend requires root path');
        this.#root = path.resolve(config.root);
        this.#watchEnabled = config.watch ?? false;
        this.#defaultAlgorithms = config.algorithms || ['sha256'];
        this.type = 'local';
        fs.ensureDirSync(this.#root);
        debug(`FileBackend "${name}" initialized at ${this.#root}`);
    }

    get root() { return this.#root; }
    get watching() { return !!this.#watcher; }

    // ─────────────────────────────────────────────────────────────────────────
    // CRUD Operations
    // ─────────────────────────────────────────────────────────────────────────

    #resolvePath(key) { return path.join(this.#root, key); }

    async put(key, data) {
        const filePath = this.#resolvePath(key);
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, data);
        const stats = await fs.stat(filePath);
        debug(`PUT ${key} (${stats.size} bytes)`);
        return { key, size: stats.size };
    }

    async get(key, options = {}) {
        const filePath = this.#resolvePath(key);
        if (!await fs.pathExists(filePath)) return null;
        return options.stream ? fs.createReadStream(filePath) : fs.readFile(filePath);
    }

    async delete(key) {
        const filePath = this.#resolvePath(key);
        if (!await fs.pathExists(filePath)) return false;
        await fs.remove(filePath);
        debug(`DELETE ${key}`);
        return true;
    }

    async stat(key) {
        const filePath = this.#resolvePath(key);
        if (!await fs.pathExists(filePath)) return null;
        const stats = await fs.stat(filePath);
        if (!stats.isFile()) return null;
        return { key, size: stats.size, modified: stats.mtimeMs, created: stats.birthtimeMs };
    }

    async *list(options = {}) {
        const { prefix = '', recursive = true } = options;
        const searchPath = this.#resolvePath(prefix);
        if (!await fs.pathExists(searchPath)) return;

        const entries = await fs.readdir(searchPath, { withFileTypes: true });
        for (const entry of entries) {
            const relativePath = path.join(prefix, entry.name);
            if (entry.isFile()) {
                yield { key: relativePath, ...(await this.stat(relativePath)) };
            } else if (entry.isDirectory() && recursive) {
                yield* this.list({ ...options, prefix: relativePath });
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Watch & Scan
    // ─────────────────────────────────────────────────────────────────────────

    async watch() {
        if (this.#watcher) return true;

        this.#watcher = chokidar.watch(this.#root, {
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
        });

        const toKey = p => path.relative(this.#root, p);

        this.#watcher
            .on('add', async p => {
                const key = toKey(p);
                const [checksums, mimeType, stats] = await Promise.all([
                    checksumFile(p, this.#defaultAlgorithms).catch(() => null),
                    detectMimeType(p).catch(() => null),
                    fs.stat(p).catch(() => null),
                ]);
                this.emit('file:add', { backend: this.name, key, path: p, checksums, mimeType, size: stats?.size });
            })
            .on('change', async p => {
                const key = toKey(p);
                const [checksums, mimeType, stats] = await Promise.all([
                    checksumFile(p, this.#defaultAlgorithms).catch(() => null),
                    detectMimeType(p).catch(() => null),
                    fs.stat(p).catch(() => null),
                ]);
                this.emit('file:change', { backend: this.name, key, path: p, checksums, mimeType, size: stats?.size });
            })
            .on('unlink', p => {
                this.emit('file:unlink', { backend: this.name, key: toKey(p), path: p });
            })
            .on('error', err => this.emit('error', err));

        debug(`Watching ${this.#root}`);
        return true;
    }

    async scan(options = {}) {
        const algorithms = options.algorithms || this.#defaultAlgorithms;
        const results = [];
        debug(`Scanning ${this.#root}...`);
        this.emit('scan:start', { backend: this.name });

        for await (const entry of this.list(options)) {
            const filePath = this.#resolvePath(entry.key);
            const [checksums, mimeType] = await Promise.all([
                checksumFile(filePath, algorithms).catch(() => null),
                detectMimeType(filePath).catch(() => null),
            ]);
            results.push({ ...entry, checksums, mimeType, backend: this.name });
        }

        this.emit('scan:complete', { backend: this.name, count: results.length });
        debug(`Scan complete: ${results.length} files`);
        return results;
    }

    async stop() {
        if (this.#watcher) {
            await this.#watcher.close();
            this.#watcher = null;
            debug(`Stopped watching ${this.#root}`);
        }
    }
}
