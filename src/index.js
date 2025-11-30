import { EventEmitter } from 'events';
import Debug from 'debug';
import Cache from './cache/index.js';
import BackendManager from './backends/BackendManager.js';
import Index from './index/index.js';
import { isBuffer, isFile, isStream } from './utils/common.js';
import { checksumBuffer, checksumFile, formatId } from './utils/checksum.js';
import { detectMimeType } from './utils/mime.js';

const debug = Debug('stored');

export default class Stored extends EventEmitter {
    #cache;
    #backends;
    #index;
    #config;

    constructor(config = {}) {
        super();
        this.#config = {
            defaultBackends: config.defaultBackends || [],
            checksums: config.checksums || ['sha256'],
            primaryChecksum: config.primaryChecksum || 'sha256',
            ...config,
        };

        this.#cache = config.cache?.path ? new Cache(config.cache) : null;
        this.#backends = new BackendManager();
        this.#index = new Index(config.index?.path);

        debug('Stored initialized');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Getters
    // ─────────────────────────────────────────────────────────────────────────

    get cache() { return this.#cache; }
    get index() { return this.#index; }
    get backends() { return this.#backends; }

    // ─────────────────────────────────────────────────────────────────────────
    // Backend Management
    // ─────────────────────────────────────────────────────────────────────────

    addBackend(name, config) {
        const backend = this.#backends.add(name, config);

        backend.on('file:add', e => this.#handleFileEvent('file:add', e));
        backend.on('file:change', e => this.#handleFileEvent('file:change', e));
        backend.on('file:unlink', e => this.#handleFileEvent('file:unlink', e));
        backend.on('scan:start', e => this.emit('scan:start', e));
        backend.on('scan:complete', e => this.emit('scan:complete', e));
        backend.on('error', e => this.emit('error', e));

        if (config.watch) backend.watch();
        return backend;
    }

    removeBackend(name) { return this.#backends.remove(name); }
    listBackends() { return this.#backends.list(); }
    getBackend(name) { return this.#backends.get(name); }

    // ─────────────────────────────────────────────────────────────────────────
    // Core API
    // ─────────────────────────────────────────────────────────────────────────

    async put(blob, options = {}) {
        const { key, backends = this.#config.defaultBackends, metadata = {} } = options;

        const { data, checksums, size, mimeType } = await this.#normalizeBlob(blob);
        const id = formatId(checksums, this.#config.primaryChecksum);
        const finalKey = key || this.#generateKey(checksums);

        // Write to backends
        const locations = [];
        const targetBackends = backends.length ? backends : this.#backends.list();

        for (const backendName of targetBackends) {
            const backend = this.#backends.get(backendName);
            if (!backend) continue;
            await backend.put(finalKey, data);
            locations.push({ backend: backendName, key: finalKey, synced: true });
        }

        const meta = this.#index.put(id, { checksums, size, mimeType, locations, custom: metadata });

        this.emit('put', { id, key: finalKey, metadata: meta });
        debug(`PUT ${id.slice(0, 19)}... → ${targetBackends.join(', ')}`);
        return meta;
    }

    async get(idOrKey, options = {}) {
        const meta = this.#index.get(idOrKey);
        if (!meta) return null;

        const location = meta.locations?.find(l => l.synced);
        if (!location) return null;

        const backend = this.#backends.get(location.backend);
        if (!backend) return null;

        return backend.get(location.key, options);
    }

    async delete(idOrKey, options = {}) {
        const meta = this.#index.get(idOrKey);
        if (!meta) return { deleted: [] };

        const targets = options.backends
            ? meta.locations.filter(l => options.backends.includes(l.backend))
            : meta.locations;

        const deleted = [];
        for (const loc of targets) {
            const backend = this.#backends.get(loc.backend);
            if (backend && await backend.delete(loc.key)) deleted.push(loc.backend);
        }

        if (!options.backends || deleted.length === meta.locations.length) {
            this.#index.delete(meta.id);
        } else {
            meta.locations = meta.locations.filter(l => !deleted.includes(l.backend));
            this.#index.put(meta.id, meta);
        }

        this.emit('delete', { id: meta.id, backends: deleted });
        return { deleted };
    }

    stat(idOrKey) { return this.#index.get(idOrKey); }
    has(idOrKey) { return this.#index.has(idOrKey); }

    async *list(options = {}) {
        const { backend: backendName, prefix } = options;

        if (backendName) {
            const backend = this.#backends.get(backendName);
            if (backend) yield* backend.list({ prefix });
        } else {
            for (const [, meta] of this.#index.entries()) {
                yield meta;
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scan / Index
    // ─────────────────────────────────────────────────────────────────────────

    async scan(backendName) {
        const backends = backendName
            ? [this.#backends.get(backendName)].filter(Boolean)
            : this.#backends.all();

        const results = [];
        for (const backend of backends) {
            const files = await backend.scan({ algorithms: this.#config.checksums });
            for (const file of files) {
                if (file.checksums) {
                    const id = formatId(file.checksums, this.#config.primaryChecksum);
                    const existing = this.#index.get(id);
                    const location = { backend: file.backend, key: file.key, synced: true };

                    // Merge locations
                    const locations = existing?.locations || [];
                    if (!locations.some(l => l.backend === file.backend && l.key === file.key)) {
                        locations.push(location);
                    }

                    this.#index.put(id, {
                        checksums: file.checksums,
                        size: file.size,
                        mimeType: file.mimeType,
                        locations,
                    });
                }
            }
            results.push(...files);
        }
        return results;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    async stop() {
        await this.#backends.stopAll();
        this.#index.close();
        debug('Stopped');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private Helpers
    // ─────────────────────────────────────────────────────────────────────────

    async #normalizeBlob(blob) {
        const algos = this.#config.checksums;
        let data, checksums, mimeType;

        if (isBuffer(blob)) {
            data = blob;
            checksums = checksumBuffer(blob, algos);
            mimeType = await detectMimeType(blob);
        } else if (isFile(blob)) {
            const fs = await import('fs');
            data = await fs.promises.readFile(blob);
            checksums = await checksumFile(blob, algos);
            mimeType = await detectMimeType(blob);
        } else if (isStream(blob)) {
            const chunks = [];
            for await (const chunk of blob) chunks.push(chunk);
            data = Buffer.concat(chunks);
            checksums = checksumBuffer(data, algos);
            mimeType = await detectMimeType(data);
        } else if (typeof blob === 'string') {
            data = Buffer.from(blob);
            checksums = checksumBuffer(data, algos);
            mimeType = 'text/plain';
        } else {
            throw new Error('Invalid blob type');
        }

        return { data, checksums, size: data.length, mimeType };
    }

    #generateKey(checksums) {
        const hash = checksums[this.#config.primaryChecksum];
        return `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
    }

    #handleFileEvent(event, data) {
        const pathKey = `${data.backend}:${data.key}`;
        const location = { backend: data.backend, key: data.key, synced: true };

        if (event === 'file:add' && data.checksums) {
            const id = formatId(data.checksums, this.#config.primaryChecksum);
            const existing = this.#index.get(id);

            // Merge locations - same content might exist in multiple paths
            const locations = existing?.locations || [];
            if (!locations.some(l => l.backend === data.backend && l.key === data.key)) {
                locations.push(location);
            }

            this.#index.put(id, {
                checksums: data.checksums,
                size: data.size,
                mimeType: data.mimeType,
                locations,
            });
            this.emit(event, { ...data, id, locations });

        } else if (event === 'file:change' && data.checksums) {
            // File changed = content changed = new checksum
            // First, remove old location from previous checksum entry
            const oldMeta = this.#index.get(pathKey);
            if (oldMeta) {
                oldMeta.locations = oldMeta.locations.filter(l =>
                    !(l.backend === data.backend && l.key === data.key)
                );
                if (oldMeta.locations.length === 0) {
                    this.#index.delete(oldMeta.id);
                } else {
                    this.#index.put(oldMeta.id, oldMeta);
                }
                // Emit that old content was removed from this path
                this.emit('file:unlink', { ...data, id: oldMeta.id, checksums: oldMeta.checksums });
            }

            // Then add new location to new checksum entry
            const newId = formatId(data.checksums, this.#config.primaryChecksum);
            const existing = this.#index.get(newId);
            const locations = existing?.locations || [];
            if (!locations.some(l => l.backend === data.backend && l.key === data.key)) {
                locations.push(location);
            }

            this.#index.put(newId, {
                checksums: data.checksums,
                size: data.size,
                mimeType: data.mimeType,
                locations,
            });
            this.emit('file:add', { ...data, id: newId, locations });

        } else if (event === 'file:unlink') {
            // Lookup metadata from index before removal (file is gone, no checksums)
            const meta = this.#index.get(pathKey);
            if (meta) {
                meta.locations = meta.locations.filter(l =>
                    !(l.backend === data.backend && l.key === data.key)
                );
                if (meta.locations.length === 0) {
                    this.#index.delete(meta.id);
                } else {
                    this.#index.put(meta.id, meta);
                }
                // Emit with full metadata so consumers know what was removed
                this.emit(event, { ...data, id: meta.id, checksums: meta.checksums, locations: meta.locations });
            } else {
                this.emit(event, data);
            }
        }
    }
}
