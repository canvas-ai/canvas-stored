import Debug from 'debug';
import FileBackend from './file/index.js';

const debug = Debug('stored:backends');

const DRIVERS = { file: FileBackend };

export default class BackendManager {
    #backends = new Map();

    get(name) { return this.#backends.get(name); }
    has(name) { return this.#backends.has(name); }
    list() { return [...this.#backends.keys()]; }
    all() { return [...this.#backends.values()]; }

    add(name, config) {
        if (this.#backends.has(name)) throw new Error(`Backend "${name}" already exists`);
        const Driver = DRIVERS[config.driver];
        if (!Driver) throw new Error(`Unknown driver: ${config.driver}`);

        const backend = new Driver(name, config);
        this.#backends.set(name, backend);
        debug(`Added backend "${name}" (${config.driver})`);
        return backend;
    }

    async remove(name) {
        const backend = this.#backends.get(name);
        if (!backend) return false;
        await backend.stop();
        this.#backends.delete(name);
        debug(`Removed backend "${name}"`);
        return true;
    }

    async stopAll() {
        for (const backend of this.#backends.values()) {
            await backend.stop();
        }
    }
}
