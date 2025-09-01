# StoreD

Simple context-addressible BLOB storage middleware that aims to abstract different storage backends under a simple API.

## Architecture

- Caching layer: `cacache`
- Backend drivers:
  - `fs`
  - `file`
  - `s3`
  - `..at some point we'll probably throw in a rclone wrapper`
- nodejs streams(yey)
- no versioning support (should be done at the index - in our case synapsd - level)

## Use-case in combination with indexD

Retrieving **piano-rec-02.mp3** with checksums [sha1-.., sha256-..] located on s3://foo, smb://bar and device-id:fs/home/foo/rec02.mp3, while connected to network "home", with available data backends for this location s3("s3") and smb("nas@home"), backend priority ['smb', 's3'], local cache miss -> retrieving from backend smb:// ..

## Config

### TBD

```

### Common StoreD paths

- `stored://backend:driver/resource-path`
- `stored://office:smb/pub/foo/bar/baz.exe`
- `stored://98e0-56ac-c9c5:fs/home/foouser/Documents/ayn_rand.pdf`
- `stored://50d1-6f33-83ed:fs/d/Documents/Work/report_202402.xls`
- `stored://local:lmdb/hash/sha1/a76c8946ee71bac59af16a7fbe0a047e9d7f25c2`
- `stored://a2ea-14ee-53dd:lmdb/id/10021221`
- `stored://a2ea-14ee-53dd:file/notes/20241217.a76c8946ee71.json`
- `stored://a2ea-14ee-53dd:fs/home/user/.canvas/data/notes/20241217.a76c8946ee71.json`

The following 2 paths are equivalent pointing to the same file located on device with ID `a2ea-14ee-53dd` using two different drivers:

- `stored://a2ea-14ee-53dd:file/notes/20241217.a76c8946ee71.json`
- `stored://a2ea-14ee-53dd:fs/home/user/.canvas/data/notes/20241217.a76c8946ee71.json`


### meta

Mandatory metadata object

### backendArray

- Array order defines the order of GET and PUT operations
