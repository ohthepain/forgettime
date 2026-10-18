# Local training persistence and portable transfer

`training-dataset.ts` provides a transactional service over the versioned [training contract](training-contract.md). `createLocalTrainingRepository()` uses a dedicated `forgettime-training` IndexedDB database, independent of saved bars and the replaceable latest-performance cache. The same persistent-origin implementation is usable by browser and Capacitor native WebViews. It does not add a native filesystem plugin or cloud endpoint. Native WebView restart/eviction, real provider sharing and platform backup behavior still need device acceptance; this code does not imply no-backup filesystem protection.

## Storage and atomic operations

One `current` dataset record holds the manifest and a checksum-keyed map of owned Float32 source payloads. Each distinct source is stored once even when several bars refer to it. A transaction replaces the current record completely: it is not an annotation revision archive. IndexedDB completion acknowledges success; request success alone does not. A random token is compared and replaced inside the readwrite transaction. Concurrent repository instances/tabs cannot silently overwrite another update: the stale caller receives an error and must reread.

The service validates every source checksum on admission/read/export and copies PCM at the boundary. Whole-dataset snapshots are bounded to 100 examples and 256 MiB of source PCM, plus a 2 MiB manifest; transactional cloning and validation need additional temporary memory. No silent truncation, eviction, upload or microphone access. Browser-origin storage can be cleared or evicted and app uninstall can remove native WebView data. An explicit portable export is the backup mechanism.

- `read()` returns owned validated dataset, current fingerprint and deduplicated PCM byte usage.
- `add(dataset)` accepts one reviewed example and its source/group context. Existing source/bar identity rejects with an instruction to use Overwrite. Partial bar data is representable but remains ineligible for optimization under the contract.
- `overwrite(example, expectedFingerprint)` replaces reviewed current annotations only. Source, boundaries and musical reference cannot change through overwrite. Old annotations are not retained. Input changes produce a new current fingerprint for later stale-result/optimizer handling.
- `deleteExample(id, expectedFingerprint, confirmed)` requires explicit confirmation and current inputs. It atomically removes the example and unreferenced sources/groups. Shared source audio remains while another example needs it. Provenance ancestor checksums remain references even if an otherwise unreferenced ancestor payload is removed.
- Writes, imports and limits fail visibly through rejected promises, leaving the prior committed record intact. The later editor/inspector must display those errors and preserve unsaved drafts. There is no persistent dataset UI in this implementation step.

## Portable binary v1

`encodeTrainingTransfer` and `decodeTrainingTransfer` implement a separate self-contained binary dataset file, not a WAV/`.forget` extension:

| Offset | Content |
| --- | --- |
| 0 | ASCII `FTDS0001` (8 bytes) |
| 8 | uint32 little-endian UTF-8 manifest byte length |
| 12 | strict versioned training manifest |
| after manifest | Float32 little-endian source payloads in the manifest's source order |

The encoder canonically sorts the manifest; the decoder honors the file's actual source order before validating/canonicalizing. Total length must equal the header, manifest and all declared frame counts exactly. Missing/trailing bytes, invalid UTF-8, unsupported schemas, excess size, nonfinite PCM and checksum mismatches reject before any repository mutation. Mono signed zero and finite overrange values survive transfer. Hashes establish integrity, not authenticity. Full retained sources include available context; missing prehistory is not manufactured.

`exportFile()` only returns bytes; it neither downloads nor shares automatically. `previewImport(bytes)` returns additions, identical entries and annotation conflicts, bound to both incoming and current manifest fingerprints. `importFile(bytes, preview, choices)` requires explicit Replace/Skip for every actual conflict and rejects unexpected choices or stale previews. It reparses/revalidates audio rather than trusting preview rows. Additions merge, identical examples skip, and conflicts never silently replace labels. Unrelated entries survive. The whole merge commits once; partial imports are not published.

Existing recording-group assignments win when an incoming source already belongs to a group, including new bars of that source. An incoming related-source group cannot silently merge two established groups; this rejects for explicit grouping resolution. Colliding unrelated group names receive a source-based import identity. The contract continues to validate known ancestor relationships. Existing source provenance wins on checksum deduplication; import never silently renames or repartitions an existing source.

The later inspection/transfer UI supplies file selection, import preview rendering, Replace/Skip decisions, explicit download/share and deletion confirmation. There is no picker, download or native share integration added here. Unsupported or unavailable storage throws rather than silently using memory or uploading audio.

## Verification boundaries

Service tests execute the real portable codec and repository logic against an atomic storage seam: reopen, source deduplication, duplicate Add, current-only Overwrite, explicit delete/orphan cleanup, import preview/replace/skip, stale previews, concurrent writers, quota failure/retry, corrupt payloads and count/byte admission. They do not simulate browser quota implementation as a measured device result.

`tests/browser/training-dataset-check.html` is a standalone regression harness (temporarily copy to public to run via Vite). It uses unique disposable databases and verifies actual IndexedDB reopen, signed-zero/overrange PCM, forced transaction abort preserving the prior record, retry/shared sources, portable transfer to an independent store, backend stale-token rejection and orphan cleanup. It deletes only its own isolated databases.

Physical Android/iOS WebView persistence/restart/storage pressure and real file-provider import/export are explicitly unverified until device acceptance. No detector/capture code changes, native compilation or acoustic accuracy claims are part of this issue.
