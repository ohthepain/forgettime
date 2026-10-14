# iOS saved bars and audio import

The updated iOS plugin implements the shared native file adapter. Save bar commits the selected WAV and `.forget` metadata to a private on-device library; reopen uses the shared hash/schema/WAV validation and restores the original reference, results, detector settings and diagnostics. Saving a new take does not replace earlier saved bars. Shared review and native replay stay separate from microphone acquisition; loading/importing turns Auto and capture off.

## Storage and byte transport

The library lives under Application Support/ForgettimeBarFiles. The root, library and staging directories explicitly set `isExcludedFromBackup`, so recording storage is excluded from automatic iCloud/device backups. No network request or automatic external export is introduced. Each complete entry contains `bar.wav`, `bar.forget` and a summary manifest in one directory. Files and the staging directory are flushed before a same-volume atomic rename publishes the pair; the committed directories themselves form the list index. No separately updated index can expose half a pair. Errors leave earlier committed entries intact. Corrupt committed manifests/lengths cause a visible error instead of silently hiding recordings.

The shared adapter retains canonical WAV bytes and validates `.forget` identity before save/reopen/export. Native storage handles access and exact byte lengths, not a second interpretation of the shared metadata schema. IDs map to hashed private directory names; bridge handles never expose a filesystem path. Binary transfers use ordered base64 chunks of at most 65,536 decoded bytes. Native work runs on a serial file queue, away from audio rendering and UI presentation.

Limits match the shared contract: 100 saved bars / 256 MiB; audio input up to 64 MiB, sidecar up to 2 MiB; decoded mono PCM up to 32 MiB and 120 seconds at integer 8–192 kHz with 1–8 original channels. There are at most two staging transfers, eight read handles and 192 MiB of reserved/owned temporary files. Expired transfers/read copies are reclaimed on the next file operation after five minutes of inactivity; startup clears only the temporary subtree. Active share copies remain pinned until the chooser completes. No saved bar is evicted to make room. Disk-full, failed commit, malformed chunk, duplicate ID, quota and corruption errors remain actionable failures.

## Picking, decoding and sharing

Import presents a multi-selection iOS document picker for explicitly chosen WAV/M4A and optional `.forget` files. It never guesses a neighboring sidecar. Selected URL access is coordinated with the provider; every successful security-scope access is released after a bounded private copy. The shared adapter eagerly reads copied handles and releases them in `finally`, so confirmation/cancellation and invalid-metadata fallback retain only bounded bytes, not provider permissions or native handles. Empty selection is cancellation and preserves the previous review.

WAV always uses the shared portable decoder, including Float32 values outside [-1,1] and signed zero. Ordinary M4A is decoded with `AVAudioFile` into 4,096-frame Float32 chunks. Native code checks declared and running frame limits, averages channels using double accumulation without clipping, and reports the actual source rate and original channel count. It does not activate `AVAudioSession`, a microphone or output device. Unsupported, encrypted or malformed codec input fails visibly. A valid pair restores directly; ordinary audio and explicit audio-only fallback require tempo and beat-one confirmation.

Native export validates a saved pair, copies both exact files to a temporary matching-name pair and passes both URLs to one `UIActivityViewController`. iPad popover placement is provided. Completion/cancellation removes only the share copies; the local pair remains recoverable. The UI reports chooser presentation/cancellation, not proof that a third-party destination persisted both files. External destinations cannot guarantee atomic paired writes.

## Verification and remaining device checks

```sh
node --import tsx plugins/forgettime-audio/tests/validate-ios-files.ts
FORGETTIME_NATIVE_HOST_TESTS=1 pnpm exec vitest run plugins/forgettime-audio/tests/ios-files-workflow.test.tsx
```

Actual Foundation host tests cover the independent browser golden pair, exact restart/reopen bytes, incomplete transfers, duplicate IDs, released handles, selected-file copying, paired export copies, backup exclusion, failed atomic rename, the 100-bar quota and corrupted manifests. Actual AVAudioFile host fixtures encode and decode stereo WAV and AAC M4A at 44.1/48 kHz, checking arithmetic mono output and source sample rates. These are real host file/codec operations, not physical iPhone tests.

The workflow fixture drives actual Swift storage/decoding through the production TypeScript adapter and practice controller. It preserves real Swift detector diagnostics, provenance, fractional reference and immutable originals at both rates; restores the browser golden pair; preserves material on picker/share cancellation; and runs actual M4A decoding after explicit bad-sidecar fallback. Only system picker/share presentation and capture hardware are substituted.

The refreshed local plugin is synced and compiled for a generic iOS Simulator. No simulator app or phone is launched, and no microphone permission is requested. Actual iOS provider selection (including iCloud download), destination export, app relaunch, file-protection/storage-pressure behavior, codec availability and audible native replay still require device validation. The on-device backup exclusion is configured and host-checked; an actual backup/restore cycle has not been exercised.
