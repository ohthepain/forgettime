# Training audio and annotation contract v1

`src/audio/training-contract.ts` defines a pure, local data boundary for the training workflow. It does not open a microphone, persist a dataset, run detectors or change the strict v1 WAV/`.forget` format. Storage/portable audio bundling, the editor, scoring and optimization are separate implementation issues.

## Source identity

Canonical source PCM is mono Float32 at the actual decoded integer rate (8–192 kHz), with coordinates starting at frame zero of that exact source. Accept 1–8 equally sized Float32 channels; downmix by arithmetic mean in JavaScript Number precision, then round once to Float32. No normalization, clipping, resampling, synthetic padding or removal of finite overrange samples. Mono signed zero is preserved. Reject empty, nonfinite, unequal-length or oversized PCM before hashing.

SHA-256 hashes this exact canonical byte sequence:

| Offset | Encoding |
| --- | --- |
| 0 | ASCII `FTPCM001` (8 bytes) |
| 8 | uint32 little-endian sample rate |
| 12 | uint32 little-endian channel count, always 1 |
| 16 | uint64 little-endian frame count |
| 24 | contiguous IEEE Float32 little-endian mono samples |

For 48 kHz samples `[-0, 1.25, -0.5]`, SHA-256 is `2efbcfe00bba8c40ea5a9986619f95f5dfa5f8e35a294cf9dc26ff36efd95789` (independently packed with Python). Names, container metadata, capture frame-clock offsets and filenames are not part of audio identity. Different rate or PCM bits change identity, including +0 versus -0. Byte-level consistency is distinct from perceptual equivalence. The caller must truthfully supply the decoder's actual rate; this module cannot discover prior resampling.

`createTrainingSource` returns owned mono samples and validated metadata; `verifyTrainingSource` checks full source frame count and checksum. v1 retains a continuous complete decoded source payload, once per checksum, which also supplies all available bar context. It does not invent discarded prehistory. Cropped imported files are distinct exact sources; provenance can name an ancestor checksum/frame offset and indicate unavailable beginning/end context. Never relabel a cropped payload as the full ancestor. The repository must verify audio payloads at import/admission: parsing a manifest alone does not verify supplied PCM.

## Manifest and frames

The strict JSON envelope is `format: forgettime-training`, `schemaVersion: 1`, with `sources`, `examples` and `groups`. `encodeTrainingManifest`/`parseTrainingManifest` are deterministic metadata codecs; full PCM remains a separate repository/export payload, not JSON sample arrays. Unknown keys/versions and contradictory references fail rather than clamp. Metadata is limited to 2 MiB UTF-8; audio to 256 MiB summed once per distinct source; examples to 100. Source/group counts and attack/region arrays are also bounded.

An example's stable ID is `<source-checksum>:<bar-start-frame>:<bar-end-frame>`. Desired attacks and uncertainty endpoints use integer source frames, not callback/display time. Bars may extend outside available source PCM to represent partial coverage, but must intersect it. A fractional beat-one frame plus BPM/4:4 reference determines boundaries: round each absolute boundary independently using `trainingBarFrames`, never accumulate rounded durations. Validation checks the declared bar against this reference. Source ownership is `[start,end)`; attacks at bar end belong to the next bar. Negative bar bounds can represent a first partial bar; desired attacks must lie in actual available coverage.

Desired frames are sorted and unique. Uncertain ranges are nonempty, sorted, nonoverlapping and within available coverage. Draft desired markers may remain inside uncertainty; exclusion expansion and matching are owned by scoring, not this codec. `reviewed: true` records the explicit review confirmation, including confirmed silence; it is not detector acceptance. `reviseTrainingAnnotations` clears review without mutating prior objects. The persistence/editor must require confirmation on source/reference/boundary changes too, and must not retain the old labels as history.

`trainingCoverage` reports actual range, complete/partial status, available before/after context and provenance flags. `trainingEligible` requires reviewed complete coverage and some non-uncertain time. Scoring still checks expanded uncertainty/startup masks and can find no evaluable time; contract eligibility alone does not guarantee a score or acoustic reliability.

## Grouping and freshness

Every source belongs to exactly one explicit recording group, assigned `training`, `withheld` or `unassigned`. Groups persist across export/import. Known retained ancestors and excerpts must share a group and have consistent offsets/extents. Related but differently encoded/edited recordings may require explicit grouping; hashing cannot infer that relationship. The contract does not automatically split groups or use withheld results.

`trainingFingerprint` hashes canonical current metadata. Object key, source/example/group order and within-group checksum order do not affect it. Annotation, review, reference, provenance or assignment changes do. It is a conservative freshness marker, not a stored revision or checksum of a historic annotation archive. Parsed objects are fresh owned data; identifiers are recomputed/checked rather than trusted. Hashes detect mismatches, not authenticity.

## Evidence

Focused tests cover independent canonical hash bytes, signed zero/overrange retention, downmix and invalid PCM, source verification, stable roundtrips/fingerprints, re-review on edits, duplicate and contradictory references, recording-group leakage, independently rounded bar boundaries, partial coverage, uncertainty, reviewed silence and metadata bounds. These are contract tests, not native persistence, detector parity, device or acoustic validation. No native plugin source changes are needed for this contract-only step.
