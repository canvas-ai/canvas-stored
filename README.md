# StoreD

Cache-first blob storage middleware with background sync to multiple backends abstracting blob storage backends under a unified API.

In combination with canvas-server/synapsd, it enables users to construct virtual "context" 
or directory "file-system-like" tree views on top of indexed data, supporting fine-grained 
store and replication policies and context-aware data retrieval.

All writes hit the local cacache first (fast, content-addressable), then sync to backends:
- **Local backends** (file): written immediately after cache
- **Remote backends** (S3, SMB, etc.): synced via off-thread worker queue

Reads check cache first, fall back to backend, and cache on read.

## Usage

```js
import Stored from './src/index.js';

const stored = new Stored({
  index: { path: './.index' },
  cache: { path: './.cache' },          // optional — auto-derived from index path
  checksums: ['sha256'],
  primaryChecksum: 'sha256',
});

// Add backends (home dir is just a backend config)
stored.addBackend('fs:home', { driver: 'file', root: './home', watch: true });

// Listen for file changes (from watcher)
stored.on('file:add', ({ id, key, checksums }) => console.log('New:', key));
stored.on('file:unlink', ({ id, key }) => console.log('Deleted:', key));
stored.on('synced', ({ id, results }) => console.log('Synced:', results));

// Store data (cache-first → backends)
const meta = await stored.put(Buffer.from('content'), { key: 'path/file.txt' });

// Retrieve (cache-first → backend fallback → cache on read)
const data = await stored.get(meta.id);

// Metadata & existence
stored.stat(meta.id);
stored.has(meta.id);

// Scan existing files on backends
await stored.scan();

// Cleanup
await stored.stop();
```

## Architecture

```
put(blob)
  → cacache (local, fast, content-addressable)
  → local backends (immediate write)
  → remote backends (worker_threads queue)

get(id)
  → cacache hit? return
  → backend read → cache on read → return
```

Workspace integration: the workspace owns a Stored instance. The home directory is `{ driver: 'file', root: './home', watch: true }` — just another backend entry. SynapsD sync (indexing files as documents) is orchestration in the workspace layer, driven by Stored events.

## API

| Method | Description |
|--------|-------------|
| `put(blob, options?)` | Cache-first store, then sync to backends |
| `get(id, options?)` | Cache-first retrieve, backend fallback |
| `delete(id, options?)` | Remove from cache + backends |
| `stat(id)` | Get metadata |
| `has(id)` | Check existence |
| `list(options?)` | Iterate indexed entries |
| `scan(backend?)` | Index existing files from backends |
| `addBackend(name, config)` | Register a storage backend |
| `stop()` | Stop watchers, sync queue, cleanup |

## Events

| Event | Description |
|-------|-------------|
| `file:add` | New file detected (watcher) |
| `file:change` | File modified (watcher) |
| `file:unlink` | File deleted (watcher) |
| `put` | Data stored via API |
| `delete` | Data deleted via API |
| `synced` | Remote backend sync completed |
| `scan:start/complete` | Backend scan lifecycle |
