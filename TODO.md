# StoreD

We'll design a simple CRUD data storage/retrieval middleware that aims to abstract different BLOB storage backends under a simple API. We should support retrieval based on checksums and paths.

! This module only abstracts blob backends - mailboxes/git/etc live in separate connectors

## API (draft)

### Core (MVP)

- **put(blob, { key?, backends?, metadata? })** → `PutResult`  
  Store a blob. Auto-detects Buffer/Stream/path.  
  Always returns the canonical metadata record.  
  key is optional; if omitted, StoreD generates one based on checksum.   

- **get(idOrKey, { stream?, backend? })** → `Buffer | Stream`  
  Retrieve by checksum (`sha256:...`) or key/path.  
  Options: `{ stream?: boolean, backends?: string[] }`

- **delete(idOrKey, { backends? }) → { removed: string[] }** → `{ deleted: string[] }`

- **list({ backend?, prefix?, limit? })** → `AsyncIterable<{ key, checksum, size }>`  
  Options: `{ backend?: string, prefix?: string, limit?: number }`

- **stat(idOrKey)** → `Metadata | null`

- **has(idOrKey)** → `boolean`  
  Thin wrapper around stat.

- 

We need to track to which backends a object should be synced and whether its synced or not  
We should emit appropriate events on all common operations  
Response object for put ops should contain at least the above details  


### Backend Management

- **addBackend(name, config)** - Register a backend at runtime
- **removeBackend(name)** - Unregister a backend  
- **listBackends()** → `string[]`
- **getBackend(name)** → `BackendInfo`

Every backend must implement:
- put(key, buffer/stream) → { key }
- get(key, { stream? }) → Buffer|Stream
- delete(key) → void
- list({ prefix?, limit? }) → AsyncIterator<Entry>
- stat(key) → { size, modified } | null
- watch?(emitCb) → void     // optional for remote backends

### Cache management

- cache.stats() – size, entries, hits/misses.
- cache.evict(pattern | oldest | oversized)
- cache.clear()

### Events

- stored.on('put',       ({ checksum, key }))  
- stored.on('delete',    ({ checksum, key, backends }))  
- stored.on('sync:start',    ({ checksum, backend }))  
- stored.on('sync:complete', ({ checksum, backend }))  
- stored.on('sync:error',    ({ checksum, backend, error }))  
- stored.on('watch',         ({ type, key, backend })) // add|mod|del


## Architecture

### Metadata object(draft)

```json
{
  "id": "sha256:abc123",              // canonical ID = primary checksum
  "checksums": {
    "sha256": "abc123",
    "xxh3": "optional"
  },
  "size": 12345,
  "mimeType": "image/png",

  "locations": [
    { "backend": "local", "key": "foo.png", "synced": true },
    { "backend": "s3-prod", "key": "blobs/abc123", "synced": false }
  ],

  "created": 1732844100000,
  "modified": 1732844100000,

  "custom": {}  
}
```

### Backend drivers we should implement for the MVP:

| Driver | Type | Watch Support |
|--------|------|---------------|
| `fs` | local | chokidar |
| `s3` | remote | polling / S3 events |

Implementation pattern: `class FsBackend extends StorageBackend`

- `fs`
  - User should be able to select local folders as data backends
  - We should support selecting a folder with existing data, and trigger the indexing of such data
- `s3`
  - We should support storing backend configuration including credentials
  - We need to support indexing of s3 buckets as well

Implementation should be flexible enough to easily add additional backends like smb, azure blob storage or supabase or even wrap rclone

### Caching (`cacache`)

- Remote GETs cached locally
- Remote PUTs go to cache first, then SyncD queue
- Config: `{ maxSize, location, evictionPolicy }`

### Services

| Service | Purpose |
|---------|---------|
| **ChecksumD** | Background/on-ingest checksum calculation (default: sha256)|
| **WatchD** | Per-backend file watching, emits change events |
| **SyncD** | Queue-based sync to remote backends, retries, status tracking |
| **Index** | LMDB-backed checksum → metadata lookup (optional for MVP?) |

#### ChecksumD (keep)

- mandatory for ingestion only
- do not checksum remote blobs on-the-fly—only local

#### WatchD (keep)

- only for backends that support it (fs)
- S3 should not pretend to watch; use polling or disable entirely

#### SyncD (keep)

- retries, exponential backoff, observability

#### Index (optional MVP)

We can skip it for an MVP but LMDB would be a nice fit long-term

## Config

```json
{
  "cache": { "path": ".cache", "maxSize": "1GB" },

  "backends": {
    "local": {
      "driver": "fs",
      "root": "./data",
      "watch": true
    },
    "s3-prod": {
      "driver": "s3",
      "bucket": "my-bucket",
      "credentials": {}
    }
  },

  "defaultBackends": ["local"],
  "checksums": ["sha256"]
}
```

## Design decisions

- Keep StoreD stupid
- Treat metadata as canonical “truth”
- If FS fails and S3 exists, do not silently fall back unless explicitly requested
- Keep events few and clean

## Flow (PUT)

### Input

**put(blob, { key?, backends?, metadata? })**  

- blob is Buffer / Stream / file path
- key optional – overrides backend key
- backends optional – overrides default backends
- metadata optional – merged into metadata.custom

### Normalize Blob Input

The main module first converts whatever the user passed into a unified internal form:

```
InternalBlob = {
  size,
  mimeType,
  read: () => Stream,  // function that always returns a fresh readable stream
}
```

This prevents bugs where streams are consumed multiple times.  
Implementation

- Buffer → size known, read() returns a fresh Readable from the buffer
- File path → size from stat(), read() returns fs.createReadStream
- Incoming network Stream → size unknown at first, buffered/chunked and piped into checksum calculation

### ChecksumD: Compute Checksums

Compute required checksums **before** writing anywhere.  
Flow:

```
const stream = blob.read()
const checksums = await checksumD.compute(stream)
```

- Primary ID = id = sha256:abcdef...  
- Side checksums allowed: xxh3, sha1, etc.  
- ! Rewind the blob afterwards by calling blob.read() again.
Never reuse the checksum stream.

### Decide the final key

The key is:
 - if user provided: key
 - else: <prefix>/sha256/<hash> (keeps everything nicely partitioned)
   - Example: `blobs/sha256/ab/cd/abcd1234..`

Using directory fan-out avoids filesystem performance issues.

### Create or Update Metadata (in-memory copy)

### Write to Local Cache First

- Local cache is your “universal staging area”  
  `await cache.put(id, blob)`

- Guarantees:
  - No remote backend can cause ingest slowdown.
  - Checksumming and indexing operate on local copies.
  - Remote failures won’t corrupt or block ingestion.
- Emit `stored.emit('put', { checksum: id, key })` - Should we emit the full metadata object here?

### Insert/Update Index

Index maps: id → metadata  
  `index.put(id, meta)`  

On update:
```
meta.modified = Date.now()
index.put(id, meta)
```

Considered the canonical truth.

### Add to Sync Queue (SyncD)

- Determine Target Backends:  
  `targets = options.backends || config.defaultBackends`

- For each backend:

```
syncD.enqueue({
  id,
  key,
  backend,
  attempts: 0,
})
```
locations entry is only updated after sync completes.


### SyncD (async)

```
for job in queue:
    emit('sync:start', { id, backend })
    try:
        const stream = cache.get(id, { stream: true })
        await backend.put(job.key, stream)
        markLocationSynced(id, backend, key)
        emit('sync:complete', { id, backend })
    catch(e):
        handleError(e)
        if job.attempts < retryLimit:
            reschedule(job)
        else:
            emit('sync:error', { id, backend, error })
```

Key design point:  
Sync failures never bubble up to the main put() call.  
They are entirely async, event-driven.

### Updating Metadata After Sync Completion

markLocationSynced(id, backend, key)?
```
meta = index.get(id)

update meta.locations:
   if backend entry exists → update synced=true
   else → push new { backend, key, synced=true }

meta.modified = now
index.put(id, meta)
```

### Return the Put Result Immediately

put() returns before any remote sync.

```
{
  id,
  key,
  checksums,
  size,
  mimeType,
  locations: meta.locations,   // only cache/local visible so far
  custom: meta.custom
}
```

## SyncD will require a simple LMDB based queue

Queue features:
- append job
- iterate jobs in order
- mark as completed / failed
- retry strategy
- ability to survive restart
- atomic operations
- counters, timestamps

We do not need
- cluster mode
- pub/sub
- cron expressions
- priorities
