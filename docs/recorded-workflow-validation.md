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

## Import inspection and microphone gain — 16 October 2026

Implemented full-source onset markers, cancellable sensitivity reanalysis, source timestamp inspection, independent time/amplitude zoom, overview navigation and keyboard alternatives. Input gain multiplies future microphone PCM before detection and retention on browser/Java/Swift capture paths. Live defaults stay independent of import/replay tuning. The v1 sidecar remains compatible.

Validation passed: typecheck; production build; full opt-in native-host suite (305 tests in 31 files); an additional live-default isolation regression with all 26 practice integration tests; Java/Swift/TypeScript detector and waveform parity at 44.1/48 kHz; Swift capture validation including gain, exact retained PCM and contiguous clocks. The full native-host run required macOS codec access outside the filesystem sandbox. Stale fixture assertions expecting the previous 0.006 detector floor were corrected to current defaults, and live-gate assertions now reflect the agreed microphone-only gain model.

After refreshing the local file dependency, installed native sources matched the plugin and Capacitor sync passed. Android assembleDebug passed (153 tasks); the iOS Simulator App target compiled with signing disabled and cached Capacitor packages. No phone/simulator launch, microphone session, installation or release was performed.

The actual browser picker imported a generated four-second 48 kHz PCM fixture. Sensitivity 0 showed four accepted attacks; sensitivity 100 showed eight. Upward drag narrowed source time around the starting point; rightward drag enlarged waveform height while preserving the time view and beat one. Marker selection exposed source timestamps, overview/Reset zoom worked, and import confirmation retained sensitivity 100 at a fixed 120 BPM/0.1-second reference with originals unavailable. At 393 × 852, the popover stayed inside the viewport and document width remained 393 pixels. These are synthetic workflow and compilation checks, not acoustic-kit accuracy or physical-device gesture validation.

### Follow-up UI queue fixes — 16 October 2026

The current gesture scheme supersedes the initial/two-finger experiments above: a single-pointer vertical drag zooms time on both import displays; horizontal main-waveform drags change display amplitude and horizontal overview drags navigate. The overview directly follows the main waveform; the colour legend paragraph is removed. Microphone selection is inside Recording options, retaining its previous capability and disabled-state rules.

Verified 26 focused component tests, typecheck, standard suite (290 passed, 21 opt-in native tests skipped), production build and diff whitespace checks. Real browser mouse drags exercised both surfaces with unchanged beat one; DOM/screenshot inspection confirmed adjacency, removed legend and microphone dropdown placement. Physical trackpad delivery and phone touch remain untested. No additional detector/native-source changes or device validation were part of these layout/interaction fixes.

### Square waveform displays and marker audition — 16 October 2026

Both import waveform displays now use square corners. The overview has a permanent inset 1px outline with a brighter 1px focus colour. A hovered or selected detection marker reveals a left-aligned 24px flat square play control. The hover column above the control retains its highlight. One-shot output auditions original source PCM from that marker to the current visible endpoint, with no microphone, gain change, detector run, score or reference mutation. Stop/Escape, replacement, range/settings/source changes, hiding and unmount release output.

Typecheck, standard suite (297 passed, 21 opt-in native tests skipped), build, Java/Swift/TypeScript detector/waveform parity and diff checks passed. New tests cover source-frame extent/rate/content, non-looping output, cancellation before audio activation completes, stale completion events, hover retention, marker/button alignment, output errors and range/unmount stopping. Real browser UI imported a synthetic 48 kHz fixture, auditioned marker 1.6 s to visible endpoint 3 s, returned naturally to play, stopped on view changes and exited on Cancel import with microphone off. Computed CSS confirmed zero corner radii and a permanent 1px unfocused outline. Geometry confirmed a 24px square control with its left edge exactly at the marker. No native compilation was required by these web output/UI changes; phone behavior, physical trackpad delivery and human-audited/calibrated acoustic output remain unverified.


### Latest completed performance recovery — 17 October 2026

The standard suite passed with 311 tests and 21 opt-in native tests skipped; typecheck and production build passed. New controller regressions cover remounting with exact full-take samples, musical reference, original analysis, current tuning and selected review bar; capture remains off. Additional checks cover completed live capture without active checkpoints, stale restoration after a new import and silent storage failures.

A real browser IndexedDB harness (`tests/browser/latest-performance-check.html`, temporarily served from public) verified exact Float32 values including signed zero and overrange samples, separate review updates, transaction abort preserving the prior complete audio/review pair, recovery after a failed write and rejection of nonfinite PCM. The practice screen imported the partial reference WAV/`.forget` pair, changed sensitivity to 51 and restored that sensitivity, 120 BPM/Straight, original detection and partial-bar context after reload with the microphone off. This verifies browser persistence; native WebView process restart and device storage eviction remain unverified. No native plugin source changed.


### Frequency-change review detector and balance — 17 October 2026

Implemented review-only octave-band energy-growth evidence with a 0–100 Energy/Frequency change balance. New material defaults to 100%; completed-performance recovery retains current balance and old recovery records default to 100%. Live capture still constructs the original energy detector at shared defaults, with no balance parameter. Original PCM, BPM, beat-one origin, analysis and v1 WAV/`.forget` settings remain unchanged.

Validation: typecheck and production build passed; standard suite passed 328 tests (25 opt-in native tests skipped); the full enabled native-host suite passed all 353 tests in 35 files. Extended TypeScript/Java/Swift parity passed at 0/50/100% for supplied ordinary/dynamic loops, both sensitivity profiles, synthetic percussion/rumble, quiet attacks, 40 ms softer follow-ups, and a high-band attack masked in broadband energy. The two supplied loops each preserve eight groups over ten sample alignments at 25/50/100% balance with startup isolated. Source WAV checksums and metadata validate. Captured startup and assumed silent prehistory remain separate in comparison reports; the initial 32 ms limitation is unchanged.

Real browser UI imported a synthetic 48 kHz overlapping-tone fixture: 100% balance showed one attack, 0% showed none, and switching back restored it without moving beat one. Confirming 120 BPM produced a complete review bar; changing balance during replay began a fresh run against the fixed reference, with microphone/Auto off. A chosen 99% balance survived refresh with the retained take; reset returned to 100%. At a 393×852 viewport, document width remained 393 px and the 290 px popup stayed within the page. This is synthetic/browser workflow evidence, not acoustic-kit accuracy.

The local native plugin dependency was refreshed, installed Java/Swift sources matched the plugin and Capacitor sync passed. Native replay host workflows passed, including blend diagnostics, packet/loop continuity, fixed reference and no microphone capture; Swift plugin/output files also passed syntax parsing. No full application build, physical-device run, installation or release is claimed for this change. A user-confirmed current false-detection passage is still needed to judge improvement on the reported problem.

### Guided training annotation — 18 October 2026

Recorded bar has the production three-step editor documented in [training annotation](training-annotation.md). The standard suite passed 381 tests (25 opt-in native tests skipped), including source-clock/silence workflows, five annotation controller tests, five editor interaction tests and stop-before-entry/source-replacement protection. Typecheck, production build and existing TypeScript/Java/Swift detector/waveform parity passed. Native plugin sources are unchanged.

A real browser imported synthetic 48 kHz audio, added a precise desired attack and uncertainty region, exercised unsaved Stay, committed Add/Overwrite, restored saved labels, and checked a 120→240 BPM recut plus Undo with fixed source times and beat one. The generated training example was removed afterward by exact checksum/bar identity. This verifies browser workflow and local persistence, without physical-device, calibrated-output or acoustic accuracy claims. Browser reload/tab close uses the browser unsaved-work prompt; drafts have no automatic persistence.
