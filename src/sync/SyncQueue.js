import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import Debug from 'debug';

const debug = Debug('stored:sync');

/**
 * Background sync queue for remote backend writes.
 * Uses a worker thread (lazily spawned) to avoid blocking the main thread.
 */
export default class SyncQueue extends EventEmitter {
    #worker = null;

    enqueue(job) {
        if (!this.#worker) this.#spawnWorker();
        this.#worker.postMessage(job);
    }

    async stop() {
        if (this.#worker) {
            await this.#worker.terminate();
            this.#worker = null;
        }
    }

    #spawnWorker() {
        this.#worker = new Worker(new URL('./worker.js', import.meta.url));
        this.#worker.on('message', (msg) => {
            debug(`Sync complete: ${msg.id?.slice(0, 19)}... → ${msg.results.map(r => `${r.backend}:${r.success}`).join(', ')}`);
            this.emit('synced', msg);
        });
        this.#worker.on('error', (err) => {
            debug(`Worker error: ${err.message}`);
            this.emit('error', err);
        });
    }
}
