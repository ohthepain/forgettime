# iOS recorded-take capture

The iOS `AVAudioEngine` tap now supplies actual source PCM to the same single-take, Auto and bar-review workflow as the browser. It does not use browser microphone capture. The first qualifying native attack fixes beat one; the original native onsets/results and fixed reference are retained alongside audio. Previous/next bar review uses this PCM and stops listening/disables Auto. Playback remains a separate feature.

## Sample and storage contract

- Each tap carries hardware sample positions. A capture session establishes a relative frame zero from the first buffer; no callback arrival or wall-clock time becomes a hit measurement. The analyzed-through watermark can trail the PCM capture head by an incomplete detector window.
- Float32 input is averaged across channels into mono, using the actual input sample rate. Interleaved and planar input both use their declared stride. This exact mono Float32 source feeds retention, waveform and the Swift detector; no separate normalization, sample-rate conversion or timestamp scaling is applied. Unsupported formats and changed sample rates stop capture visibly.
- The bridge carries incremental `{ sessionId, sampleRate, pcm: { startFrame, samples }, onsets, waveform, time }` packets. Shared code converts the numeric PCM array to `Float32Array` once. It waits for the native start session identity, preserving bounded opening packets and discarding events from older sessions.
- Native delivery allows at most 0.5 seconds of unacknowledged PCM, with at most 16,384 samples per packet. A stalled consumer raises a capture error and stops production instead of silently dropping samples or building an unbounded bridge queue. JSON packaging occurs on the main queue, outside the audio tap. Acknowledgments carry session identity and cannot release another session's data.
- The shared recorder retains 100 ms of acquisition context and starts each take up to 50 ms before its first accepted onset. The current take is limited to 120 seconds including context (about 23 MB at 48 kHz). Reaching the limit stops capture visibly and preserves valid material. Only the latest unsaved take is kept; replacing it, closing or reloading discards it. Capture does not write files or upload audio.
- Stop, backgrounding, microphone interruptions, route changes, invalid or missing samples, sample-clock gaps and bridge errors end continuity. Valid already-delivered material remains reviewable and is labelled interrupted/partial where appropriate. Capture never automatically resumes following an interruption. A single take releases the microphone after a full bar of silence from the last accepted hit; Auto stays armed only while the same uninterrupted capture remains active.

## Verification and limits

Run the host checks with Node 24 and the installed Swift/JDK toolchains:

```sh
node --import tsx plugins/forgettime-audio/tests/validate-ios-capture.ts
node --import tsx plugins/forgettime-audio/tests/validate-parity.ts
pnpm exec vitest run plugins/forgettime-audio/tests/capture.test.ts src/audio/use-practice.test.tsx
```

The Swift capture fixture exercises the same `NativeCaptureStream` used by the tap. It checks exact retained PCM/opening context, two-channel conversion, arbitrary starting hardware frame positions, varying callback lengths, onsets matching TypeScript at 44.1/48 kHz, format/gap rejection and a deliberately stalled consumer. The existing shared PCM practice fixtures cover full-bar silence, Single/Auto lifecycle, multi-bar navigation and the 120-second limit. These are synthetic host checks.

After native source changes, reinstall the local `file:` plugin and sync before compiling. Compare the installed `node_modules/forgettime-audio` Swift source with the source plugin so a cached copy cannot masquerade as the latest implementation. Compile-only configuration uses `CAP_REMOTE_APP_URL=https://ci.invalid`; it is not a usable app endpoint.

The iOS App target compiled for arm64 and x86_64 simulators with Xcode 26.6, code signing disabled, after refreshing and syncing the local plugin. The host checks and shared regression suite passed. This is compile and synthetic evidence only.

Actual microphone recording/review, permission UI, headphones/routes, sample-rate transitions and background/interruption behavior still require foreground tests on an iPhone with user consent. A simulator build and synthetic PCM cannot establish acoustic-kit accuracy, physical latency or runtime bridge throughput. No phone deployment or capture was performed for this ticket's compile-only validation.
