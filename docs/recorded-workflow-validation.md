# Recorded workflow validation — 14 October 2026

This checks spec #1 and tickets #2–#14 on the integrated implementation based on `b5b9393`. It is local development evidence, not a release or an acoustic accuracy certification. The feature is described in [Take review and replay](take-review.md).

## Automated results

| Check | Result and boundary |
| --- | --- |
| Node 24.4.1, frozen dependency refresh and Prisma generation | Passed; local native dependency compared byte-identical before sync. |
| TypeScript | Passed. |
| Full Vitest suite, including `FORGETTIME_NATIVE_HOST_TESTS=1` | 245 tests in 26 files passed; no skipped native suite counted as a pass. |
| Production client/server bundles | Passed with Vite `--configLoader runner`; the default config bundler has previously stalled on this host. |
| TypeScript/Java/Swift onset and waveform parity | Passed at 44.1/48 kHz, varied chunks and synthetic percussion/rumble/recovery/follow-up fixtures. |
| Extended Swift settings/candidates, capture, replay and files validators | Passed; real Swift source compiled/executed. |
| Native Java/Swift through shared practice and file adapters | Passed in the full suite; actual native detector, retained PCM and private file store code, with device/Capacitor edges substituted. |
| Real AAC/M4A codec fixture | Swift AVAudioFile encode/decode passed at 44.1/48 kHz on macOS; Android MediaCodec device execution is outstanding. |

The test seams follow the agreed practice workflow. Real PCM passes through detector, timing, review and file codecs; only hardware, output clock and file-access edges are substituted where required. Coverage includes startup-off, single/Auto capture, exact last-hit silence deadlines, review disabling Auto, opening context, every captured bar, incomplete/gapped input, bounded retention, stale callbacks, replay/tuning, original preservation, save/restart/reopen, paired/unpaired import and explicit invalid-sidecar fallback.

Synthetic cases cover sparse/silent loops, drift, ghost notes, flams, cymbal-like decays, 44.1/48 kHz sources, variable input packets and delayed presentation reads. A fixed 128-source-frame analysis cadence prevents callback frequency from changing rhythmic lookahead. Fresh equivalent runs are repeatable; later loop repetitions need not be identical because detector state carries across the join. Golden WAV/`.forget` bytes exercise browser, Java and Swift exchange with fractional phase, signed zero, partial coverage and delayed original results. This is portable format/host-code evidence, not real device picker/share execution.

## Repeat the automated checks

Use Node 24 and installed Java/Swift toolchains. `JAVA_HOME` and `PATH` must select the intended JDK; this host used OpenJDK 23.0.2 (the `openjdk@21` symlink also resolves to 23). The app's Java source/target remains 21.

```sh
pnpm install --offline --frozen-lockfile
pnpm db:generate
pnpm typecheck
FORGETTIME_NATIVE_HOST_TESTS=1 pnpm test
pnpm exec vite build --configLoader runner
node --import tsx plugins/forgettime-audio/tests/validate-parity.ts
node --import tsx plugins/forgettime-audio/tests/validate-ios-diagnostics.ts
node --import tsx plugins/forgettime-audio/tests/validate-ios-capture.ts
node --import tsx plugins/forgettime-audio/tests/validate-ios-replay.ts
node --import tsx plugins/forgettime-audio/tests/validate-ios-files.ts
```

Before native compilation, refresh the local `file:` dependency, compare installed native sources with the plugin, and run `pnpm cap:sync`. Compile-only `CAP_REMOTE_APP_URL=https://ci.invalid` is not a working app endpoint. Default `pnpm test` skips the opt-in native host suites; it cannot replace the enabled run above.

## Native app compilation

Both integrated full-app builds passed after reinstalling the local plugin, comparing all installed Android/iOS source files and syncing Capacitor:

- Android `assembleDebug`: 153 tasks executed, including plugin Java compilation. Approved isolated SDK 36/build tools 35, Gradle 8.14.3, actual OpenJDK 23.0.2. No device installation. The SDK XML parser and future Gradle 9 deprecation warnings are nonfatal for this build.
- iOS `App`: generic iOS Simulator build with Xcode 26.6, code signing disabled, fresh derived data, arm64 and x86_64. No simulator or phone launch.

Compilation does not activate a microphone or exercise permissions, routes, document providers or speakers. Native playback uses the real Java/Swift detector; there is no browser-detector fallback. [Android replay](android-replay.md), [iOS replay](ios-replay.md), [Android files](android-bar-files.md) and [iOS files](ios-files.md) describe clock and storage limits.

## Supplied audio and browser checks

The supplied `Karlbergsvägen 25.m4a` is a 41.3867-second mono AAC file at 48 kHz with user-confirmed intended tempo 110 BPM. The user explicitly identified it as **not drums**. It has no independently annotated onsets or musical intentions. Its local exploratory baseline found 270 detections and 62 intervals shorter than 45 ms; those counts demonstrate a diagnostic problem, not precision/recall or an accuracy improvement. Neither the original file nor converted PCM is committed or uploaded.

An earlier real Chromium output-graph check decoded this source's converted WAV and rendered bar 3 for 16 wraps over 36.8093 seconds, with nonzero output peak 0.4961548 and unchanged reference (source-frame rounding −9.47 microseconds). That verifies browser audio rendering, not human-audited sound or measured hardware latency. The integrated in-app browser then imported the original M4A through the real file picker: 41.39 seconds, 48 kHz mono. Explicit setup at 110 BPM and beat one at 0 produced 19 review bars with the tempo field at 110. Navigation reached bar 3; its actual loop started against the fixed 110 BPM reference with the beat counter visible and microphone off. The loop ran seven repetitions; candidate 42 was inspectable, and changing Attack contrast to 2 began fresh run 2. Saving the selected bar, reloading, and opening it restored a complete 110 BPM bar with looping enabled. At 393 × 852, the card/waveform overlay fit and document width equalled the 393 px viewport.

The actual picker also restored the checked-in partial golden WAV/`.forget` pair immediately at 120 BPM/Straight, with its original hit, partial/interruption label, disabled loop and microphone off. A deliberately mismatched sidecar produced a mismatch explanation and explicit **Use audio only**, which opened ordinary 110 BPM setup and disclosed that original metadata was not restored. Cancellation of that UI path was not claimed from this run; controller tests cover it.

A WAV download click reported “download requested.” The in-app browser download event timed out, so an exported filesystem artifact was **not** confirmed from that UI check. Portable exact bytes are covered by codec/native-store tests; those do not prove the browser download destination.

These browser checks exposed a server/client storage-capability hydration mismatch and unknown original analysis displayed as zero. New regression tests reproduce both before fixing them. Capability is now unresolved until mount; absent original analysis stays unavailable through save/reopen and in the comparison. Review also found Auto remaining armed during save/inspection of a completed take, and stopped native controls incorrectly disabled before first replay. Regressions now enforce review disarming while preserving active live inspection, and allow prospective native settings without activating the microphone. Actual native playback still validates the installed plugin. Reopening another material clears the previous import notice.

## Required acceptance still outstanding

- Physical Android and iOS microphone/output checks: permission grant/denial, single/Auto capture and silence timing, route/sample-rate changes, interruption/backgrounding, bridge load, wired/Bluetooth alignment, and stop latency. No phone deployment or microphone session was performed for this integrated validation.
- Real native document-provider selection (including iCloud downloads), M4A codec support, paired destination export/cancellation, app relaunch, storage pressure and backup/file-protection behavior. Host atomic-store tests do not prove those system interactions.
- Representative recorded grooves, fills, ghost notes, flams/rolls and cymbal-heavy playing, with independently established reference/annotations where accuracy metrics are desired. None has been supplied. The non-drum file cannot satisfy this check.
- Physical output-to-display timing measurement and acoustic metronome leakage. Reported browser/iOS latency estimates and Android hardware timestamps are not calibrated acoustic measurements.

Keep #14 and the parent spec open while these required checks remain unmet. No AWS changes, server audio endpoints, authentication/schema changes, automatic uploads, store release or background capture were added by this feature.
