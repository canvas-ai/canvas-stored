import { EventEmitter } from 'events';

/**
 * Base class for storage backends.
 * All backends must implement: put, get, delete, stat, list
 * Optional: watch, scan, stop
 */
export default class StorageBackend extends EventEmitter {
    constructor(name, config = {}) {
        super();
        this.name = name;
        this.type = 'base';
        this.config = config;
    }

    // Required methods - must be implemented by subclasses
    async put(key, data) { throw new Error('Not implemented'); }
    async get(key, options = {}) { throw new Error('Not implemented'); }
    async delete(key) { throw new Error('Not implemented'); }
    async stat(key) { throw new Error('Not implemented'); }
    async *list(options = {}) { throw new Error('Not implemented'); }

    // Optional methods
    async watch() { return false; }
    async scan() { return []; }
    async stop() { }
}
