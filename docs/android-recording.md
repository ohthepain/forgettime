# Android recorded take review

Android capture now sends actual mono PCM16 input as signed samples with its original `startFrame` and `sampleRate`. The same samples feed the existing Java onset detector and 2 ms waveform envelopes before bridge delivery. The shared adapter converts the bridge array to `Float32Array`; neither callback arrival nor wall-clock time becomes a hit timestamp. Audio remains in device memory and is not uploaded or saved automatically.

The shared take workflow retains opening context, fixed reference, original detections/results and all captured bars. Single capture releases the microphone after four beats of silence measured from the final accepted hit. Auto waits for another take and permits replacement of the previous unsaved take. Previous/next review releases capture and disables Auto. The existing 120-second take limit includes opening context (about 23 MB PCM at 48 kHz); it stops with a notice and preserves valid captured material. Playback is separate work in #10.

## Resource and continuity limits

- AudioRecord reads at most 20 ms per packet, at 44.1 or 48 kHz. Each bridge event carries only that packet, its native detections and its native envelope points.
- Each native session has a unique identifier. Acknowledgements include that identifier and the consumed end frame; stale acknowledgements cannot free a different session's backlog.
- At most half a second of unacknowledged sample data may be sent. If the consumer stalls, capture fails explicitly before a further packet is queued. No older recorded bar is silently evicted to keep recording. Native batches do not accumulate a second copy of the take.
- Route changes, sample-rate changes, AudioRecord failures and suspected read overruns stop capture. The shared adapter also rejects gaps, changed sessions/formats, missing PCM and malformed packets. Previously valid material remains reviewable and the take is marked interrupted.
- Backgrounding, permission cancellation and late events retain the existing foreground-only lifecycle. Opening permission does not constitute a hit or reference. Restarting capture requires another user action after an interruption.

## Verification, 14 October 2026

Passed in the isolated implementation checkout:

- Native Java red/green contracts for signed PCM retention, ownership after reuse of the AudioRecord buffer, sample-frame continuity and bounded acknowledgements (including rejecting a future acknowledgement).
- Six opt-in workflow checks generate PCM16 in Java and run the real `NativeCaptureStream`, shared `createAudioCapture`, timing engine and practice hook. Only the Capacitor/device edge is substituted. Coverage includes 44.1/48 kHz exact retained audio, opening attack context, unchanged original native detections, full-bar single timeout, multi-bar navigation, Auto replacement and review release, gaps, rate changes, backgrounding and stale frames.
- Existing Java/Swift/TypeScript detector and envelope parity at 44.1/48 kHz; shared capture adapter tests and TypeScript checking.
- Local plugin reinstalled from the updated `file:` package, source equality checked, then Android Capacitor sync completed with compile-only `CAP_REMOTE_APP_URL=https://ci.invalid`.

Run the additional native workflow checks with a JDK available:

```sh
FORGETTIME_NATIVE_HOST_TESTS=1 pnpm exec vitest run plugins/forgettime-audio/tests/android-workflow.test.tsx
node --import tsx plugins/forgettime-audio/tests/validate-parity.ts
```

Set `JAVA_HOME` and `PATH` for the intended installed JDK. This host used OpenJDK 23.0.2; its `openjdk@21` symlink also resolves to 23, so it is not evidence of a Java 21 run. The normal unit suite skips the opt-in native host workflow when `FORGETTIME_NATIVE_HOST_TESTS` is absent.

**Not verified:** full Android app compilation (Android SDK absent; license acceptance/download not authorized), physical Android microphone recording/review, device permission/route transitions, timing under real bridge load, and representative acoustic drums. No Android device was attached. Host-generated PCM and Java compilation do not establish those results. The half-second backlog limit is intentionally fail-visible; its usability under actual device load still needs measurement.
