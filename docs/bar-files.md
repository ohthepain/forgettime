# Local bars and `.forget` v1

Browser Save bar on device commits only the selected bar. Audio and metadata live in the `bars` IndexedDB store; the saved-bars list lives in `index`. One readwrite transaction covers both stores. Success is reported only by transaction completion, never an individual write request. Duplicate IDs, quota failure and abort leave existing records intact. Saved bars survive replacement of the unsaved take and page restart. Browser storage can still be cleared or evicted by the browser; this is not a backup service.

Each saved entry offers separate, explicit WAV and `.forget` downloads. Both use the same UUID filename stem. A download request cannot prove that the browser wrote the file: the UI says “download requested” and retains the local pair on cancellation/failure. Audio remains on-device unless the user explicitly downloads it. Native file adapters and ordinary-audio selection are separate follow-up features; no microphone is started by reopening a bar.

## Interchange contract

`src/audio/bar-files.ts` exports `BarFiles { wav: ArrayBuffer; sidecar: string }`, `createBarFiles(take, index)`, `parseBarSidecar(text)`, and `restoreBarFiles(files, source = 'saved')`. Source can also be `imported`. Validation rejects unknown keys, versions, enums, nonfinite numbers, out-of-range settings, invalid coverage, contradictory analysis and duplicate result/candidate IDs. It never clamps invalid metadata.

The JSON envelope is `format: "forgettime-bar"`, `schemaVersion: 1`:

- `audio`: `encoding: "float32"`, exact encoded `byteLength`, lowercase hexadecimal `sha256`, `sampleRate`, `channels: 1`, `frames`. Valid audio duration is exactly `frames / sampleRate`; all frames are real captured/imported coverage.
- `musical`: fractional clip-relative `origin`, intended `duration: 240 / bpm`, `bars: 1`, `complete`. This is separate from rounded PCM coverage. Full coverage uses rounded start/end source frames; partial captures contain no padding. BPM is 30–300, matching the timing engine.
- `meter: [4,4]`, `settings`: BPM, interpretation (`auto`, `straight`, `swing`), Start sensitivity (0–100) and optional original detector settings using canonical detector version 1 bounds.
- `provenance`: `kind` (`capture`, `import`, `unknown`), optional original `platform` (`web`, `native`) and source `name`. Reopening marks the active material `saved` without replacing its provenance.
- `analysis`: actual `{ implementation, version }`, or `null` when unknown. Browser capture identifies `forgettime-onset` version `1`; native capture supplies its own actual implementation. An older unknown implementation is not relabelled as current.
- `original`: original `onsets`, `results`, and `diagnostics`. Diagnostics are either `null` (unavailable) or `{ candidates, dropped }`. The count includes truncation inherited from the source take, even when the selected bar has few retained candidates. Zero candidates alone is not evidence of complete diagnostic coverage. Tuned replay output never overwrites originals.
- `endReason`: `silence`, `stopped`, `interrupted`, or `limit`.

SHA-256 identifies the final encoded WAV bytes, not decoded samples or the filename. Restore checks byte length and digest before decoding, then checks format/sample rate/channel count/frame count. This detects a mismatched audio pair; it does not authenticate metadata.

For a musical interval `[S,E)` and copied source frames `[A,B)` at sample rate `R`, clip zero is `A/R`. Preserve `origin = S - A/R` even if slightly negative. Rebase onset/candidate `time`, result `time`, `displayedAt`, and guidance `intendedTime` by subtracting `A/R`. Keep error values and durations unchanged. A result's historical `displayedAt` may legitimately occur after the clip. Explicit one-bar extent prevents fractional frame rounding from generating a phantom second bar on repeated export.

`src/audio/wav.ts` uses DataView and no Node Buffer API. Export is deterministic mono IEEE Float32 little endian; finite samples outside [-1,1], and signed zero, are preserved exactly. Shared decode supports PCM16/Float32, including validated extensible GUIDs, 1–8 channels with arithmetic averaging, and 8–192 kHz. Invalid RIFF/chunk lengths, padding, byte rate, block alignment, partial frames and nonfinite samples fail. PCM24/PCM32 and compressed ordinary audio are not supported by this initial codec.

## Limits and adapter seams

Encoded audio: 64 MiB. Decoded mono PCM: 32 MiB and at most 120 seconds. Metadata: 2 MiB UTF-8, 20,000 original onsets/results each, 2,048 candidate diagnostics. Library: 100 bars or 256 MiB, whichever comes first. Admission fails without truncation or silent deletion. A full library requires downloading and deliberately clearing browser storage; per-bar deletion is not implemented yet.

`SavedBarRepository` exposes `list(): Promise<SavedBarSummary[]>`, `read(id): Promise<SavedBarRecord>`, and `save(record): Promise<void>`. A record includes complete bytes/sidecar and summary `{ id, name, createdAt, bpm, complete, bytes }`. Native adapters must preserve the same complete-pair commit guarantee. `BarFileOptions` injects repository and per-file export edges into `usePractice`; browser defaults use IndexedDB/download links, while unsupported native versions report unavailable storage. `openRecordedMaterial(take)` installs already validated import material after stopping capture/replay and invalidating stale acquisition. Reopening restores detector controls; the screen restores tempo/interpretation/Start sensitivity for the next live take while preserving the original musical reference.

## Verification

Controller tests run real PCM through the detector and timing engine, then the real WAV/sidecar codec; only hardware/file edges are substituted. They cover repeated 110 BPM roundtrips at 44.1/48 kHz, original settings/diagnostics after tuning, stale read cancellation, durable-save acknowledgement and quota/download failures. Codec tests cover exact Float32 bytes, partial coverage, rebased delayed analysis, unknown diagnostics and malformed metadata/WAV. Focused screen tests cover independent local save/download actions and restored paused controls.

A Chromium check also verified real IndexedDB commit/reopen, page restart, duplicate rejection, and abort between pair/index writes: the aborted audio record was absent and the prior entry remained readable. This is browser persistence evidence, not physical-device or acoustic timing validation.

The platform-neutral reference pair at `tests/fixtures/bar-files/float32-partial.{wav,forget}` was encoded independently with Python's IEEE Float32 packing. It contains signed zero, values outside [-1,1], missing analysis/diagnostics and a result presented after the partial clip. Browser and future native file adapters should consume these same bytes.
