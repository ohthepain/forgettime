# Android saved bars and audio import

Save bar uses the shared Float32 WAV / versioned `.forget` codec. The native repository stores exact validated bytes under `Context.noBackupFilesDir`, so recordings are not included in Android automatic app backup. A saved bar has a private directory containing WAV, sidecar and a small versioned binary manifest. File data and directory entries are synchronized before a same-volume rename commits the complete directory. The manifest is the list entry: there is no separate global index to commit. Incomplete stages never appear in Saved bars; duplicate IDs, failed writes, quota and corrupt committed entries produce errors. Startup removes abandoned stages without changing committed bars.

The library permits at most 100 bars / 256 MiB and never silently evicts saved material. Clear app storage or uninstall removes local bars; explicit export is the portable copy. Native save/read adapters validate using the same shared schema and exact encoded-WAV SHA256 as browser files. Fractional beat origin, integer source offsets, detector version/settings, original results and incomplete diagnostics remain unchanged through reopen. Reopen/import leaves the microphone off and Auto disabled; replay still uses the actual Android backend.

## Import and export

The system document picker grants access only to selected content URIs. Select one WAV or M4A, optionally with one `.forget`; no adjacent file is guessed or read automatically. The plugin copies selected content into bounded private temporary files, closes provider streams, then the shared adapter eagerly reads bounded chunks and releases opaque native handles. No persistent URI grants or broad storage permission are requested. Cancellation, rejected metadata or explicit audio-only fallback hold no open provider scope. Cancelled/stale import leaves previous usable review material available.

WAV is decoded by the shared parser, preserving source PCM/rate. M4A is decoded by Android MediaExtractor/MediaCodec without activating microphone or playback. The native decoder checks the actual output rate/channel count and supports reported PCM16 or Float32. It averages channels without clipping or normalization, streams finite mono Float32LE to a bounded temporary file, and stops on invalid formats, excess duration/size, stalled codec or destruction. Unsupported/DRM files fail visibly. A mismatched sidecar offers explicit ordinary-audio setup; it never claims original results were restored. Ordinary import requires tempo confirmation and beat-one placement.

The native Export WAV + .forget button presents both exact files to one system chooser. A dedicated FileProvider exposes only `cache/forgettime-exports/` and grants temporary read access; app-private library paths are never shared. The UI reports that the files were offered, not that an external destination saved them. Export copies are kept up to 24 hours for receiving apps and pruned during subsequent file operations/startup. Chooser cancellation or failure does not remove the local pair.

## Bounds and lifecycle

Inputs are limited to 64 MiB audio plus 2 MiB sidecar; decoded mono is limited to 32 MiB / 120 seconds, with 8–192 kHz integer rate and 1–8 original channels. Limits use actual streamed bytes/frames independently of provider metadata. The bridge sends at most 65,536 decoded bytes per base64 chunk, with exact sequential write offsets and bounded read lengths. No whole-file base64 message is constructed. The shared adapter still allocates bounded full ArrayBuffers for canonical validation and setup.

Native temporary imports/decodes and retained exports share a 192 MiB cache budget. At most eight read handles, one decode upload and one staged save are active; the serial file queue holds at most 32 waiting operations. Handles/uploads expire after ten minutes of inactivity on subsequent operations, and abandoned imports are cleaned at startup. Destroy settles queued calls and cleans owned temporary material; presenting the picker/share sheet does not prematurely invalidate selected resources. A provider that blocks a system read can delay that operation; file-size bounds do not imply bounded provider/network latency.

## Verified scope

```sh
FORGETTIME_NATIVE_HOST_TESTS=1 pnpm exec vitest run \
  plugins/forgettime-audio/tests/android-files.test.ts \
  plugins/forgettime-audio/tests/android-files-workflow.test.tsx \
  src/audio/native-files.test.ts src/audio/use-saved-bars.test.tsx \
  src/audio/use-import.test.tsx src/components/PracticeScreen.test.tsx
pnpm typecheck
```

Actual host Java tests cover incomplete writes, durable-write failure, restart, duplicate IDs, 100-bar quota, corruption, exact portable fixture bytes, PCM16/Float32 arithmetic averaging and nonfinite rejection. Actual Java detections and storage pass through the shared native adapter and practice controller at 44.1/48 kHz, preserving PCM, fractional origin, provenance/settings and diagnostics after restart. The independent browser golden pair restores and cancellation retains review without capture. OS picker/share UI and Capacitor transport are substituted in these host tests.

The local plugin was reinstalled, synced and compared to source before Android `assembleDebug` succeeded with API 36 / JDK 23. This establishes compilation, not physical behavior. Actual Android document providers, MediaCodec M4A support, destination share/save behavior, app restart and native audible replay still require device validation. No phone was installed/launched, microphone activated or acoustic accuracy claimed.

Platform references: [selected document access](https://developer.android.com/training/data-storage/shared/documents-files), [FileProvider sharing](https://developer.android.com/training/secure-file-sharing/share-file), [MediaCodec PCM output](https://developer.android.com/reference/android/media/MediaCodec), [no-backup app storage](https://developer.android.com/reference/android/content/Context#getNoBackupFilesDir()).
