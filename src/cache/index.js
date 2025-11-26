import cacache from 'cacache';
import Debug from 'debug';

const debug = Debug('stored:cache');

export default class Cache {
    #root;
    #algorithms;

    constructor(config) {
        if (!config?.path) throw new Error('Cache path required');
        this.#root = config.path;
        this.#algorithms = config.algorithms || ['sha256'];
        debug(`Cache initialized at "${this.#root}"`);
    }

    get root() { return this.#root; }

    list() { return cacache.ls(this.#root); }

    has(key) { return cacache.get.info(this.#root, key); }

    put(key, data, metadata = {}) {
        return cacache.put(this.#root, key, data, { algorithms: this.#algorithms, metadata });
    }

    putStream(key, metadata = {}) {
        return cacache.put.stream(this.#root, key, { algorithms: this.#algorithms, metadata });
    }

    get(key) { return cacache.get(this.#root, key); }

    getStream(key) { return cacache.get.stream(this.#root, key); }

    getInfo(key) { return cacache.get.info(this.#root, key); }

    delete(key) { return cacache.rm.entry(this.#root, key, { removeFully: true }); }

    clear() { return cacache.rm.all(this.#root); }

    verify() { return cacache.verify(this.#root); }

    async stats() {
        const entries = await this.list();
        const keys = Object.keys(entries);
        const totalSize = keys.reduce((sum, k) => sum + (entries[k].size || 0), 0);
        return { entries: keys.length, size: totalSize };
    }
}
