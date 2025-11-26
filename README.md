# StoreD

Simple CRUD data storage middleware abstracting blob storage backends under a unified API.

## Installation

```bash
npm install
```

## Usage

```js
import Stored from './src/index.js';

const stored = new Stored({ 
  index: { path: './.index' },        // LMDB-backed persistent index
  cache: { path: './.cache' },        // optional cache
  checksums: ['sha256', 'md5'],       // algorithms to compute
  primaryChecksum: 'sha256',          // used for canonical id
});

// Add file backends
stored.addBackend('fs:data', { driver: 'file', root: './data', watch: true });
stored.addBackend('fs:archive', { driver: 'file', root: './archive' });

// Listen for file changes
stored.on('file:add', ({ key, checksums, mimeType }) => console.log('New:', key));
stored.on('file:change', ({ key, checksums }) => console.log('Modified:', key));
stored.on('file:unlink', ({ key }) => console.log('Deleted:', key));

// Index existing files
await stored.scan();

// Store data
const meta = await stored.put(Buffer.from('content'), { key: 'path/file.txt' });
// Returns: { id, checksums, size, mimeType, locations, created, modified, custom }

// Retrieve by id or path
const data = await stored.get(meta.id);

// Check existence
stored.has(meta.id); // true

// Get metadata
stored.stat(meta.id);

// List all indexed files
for await (const entry of stored.list()) {
  console.log(entry.id, entry.size, entry.mimeType);
}

// Delete
await stored.delete(meta.id);

// Cleanup
await stored.stop();
```

## Metadata Object

```json
{
  "id": "sha256:abc123...",
  "checksums": {
    "sha256": "abc123...",
    "md5": "def456..."
  },
  "size": 12345,
  "mimeType": "image/png",
  "locations": [
    { "backend": "fs:data", "key": "path/file.png", "synced": true }
  ],
  "created": 1732844100000,
  "modified": 1732844100000,
  "custom": {}
}
```

## API

| Method | Description |
|--------|-------------|
| `put(blob, options?)` | Store buffer/stream/file path |
| `get(id, options?)` | Retrieve by id or path |
| `delete(id, options?)` | Remove from backends |
| `stat(id)` | Get metadata |
| `has(id)` | Check if exists |
| `list(options?)` | Iterate indexed entries |
| `scan(backend?)` | Index existing files |
| `addBackend(name, config)` | Register a backend |
| `removeBackend(name)` | Unregister a backend |
| `listBackends()` | List registered backends |
| `stop()` | Stop watchers and cleanup |

## Events

- `file:add` - New file detected
- `file:change` - File modified
- `file:unlink` - File deleted
- `scan:start` - Indexing started
- `scan:complete` - Indexing finished
- `put` - Data stored
- `delete` - Data deleted
