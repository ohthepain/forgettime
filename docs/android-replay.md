# Android bar replay and detector diagnostics

Android loops the selected complete mono bar through AudioTrack and the actual Java detector. The same immutable Float32 source feeds output and analysis; metronome synthesis is added only to the output copy. Replay creates no AudioRecord, requests no microphone permission and preserves the original take and detections. The shared presenter fixes the musical grid at the recorded fractional origin. Start, a different bar, or detector changes create a fresh run; loop joins retain detector history within a run.

## Source clock and lifecycle

AudioTrack runs at the source sample rate. A hardware AudioTimestamp maps its frame position to the current source cursor, clamped to submitted frames. Before hardware timestamps become available, the playback-head counter supplies an explicitly estimated cursor. Both counters extend their unsigned 32-bit wrap. Submitted or queued frames alone are never treated as audible frames. Analysis advances through the immutable source only to that output cursor and returns a separate completed-window watermark. Shared interpretation advances at deterministic 128-source-frame steps, so delayed UI polls do not change rhythmic scores.

The output requests audio focus and stops on focus loss, route change, backgrounding, invalid/regressed/stalled output clocks, underrun or native errors. It does not restart automatically. A worker watchdog stops playback when reads fall more than two seconds behind; a native analysis call also limits catch-up to two seconds. Stop clears metronome plans and releases output. Session IDs scope operations and stale reads; a bounded 32-entry cancellation history rejects delayed cancelled starts.

A start payload is one complete bar, at an integer 8–192 kHz source rate, no longer than eight seconds or 1,536,000 finite samples. The one-time JSON transfer is bounded but can be large; its startup cost needs device measurement. Per-read attacks and undrained candidate details are capped at 2,048. Missing candidate details have an explicit dropped count. Output errors terminate the run instead of silently dropping source material.

## Actual native controls

The Java detector implements canonical version 1 minimum RMS, attack contrast, minimum separation and level recovery settings. Live changes preserve detector/sample history; Start sensitivity remains the shared acquisition gate. Candidate details contain actual sample-derived time, run-local ID, strength/confidence, settings, rejection reasons and measured thresholds. Reasons distinguish warming up, level, rise, contrast, rearming and separation. Producing or draining diagnostics does not change detections. Live frames and capture start identify analysis as `forgettime-java-onset`, version `1`; saved material retains this provenance and its original settings.

## Verification

With a JDK available, run:

```sh
FORGETTIME_NATIVE_HOST_TESTS=1 pnpm exec vitest run plugins/forgettime-audio/tests/android-replay.test.ts plugins/forgettime-audio/tests/android-workflow.test.tsx src/audio/native-replay.test.ts
node --import tsx plugins/forgettime-audio/tests/validate-parity.ts
pnpm typecheck
```

The Java host fixture verifies immutable repeated output, output-clock mapping/wrap, bounded catch-up, diagnostic overflow, live configuration without clock reset, and all candidate reasons. Actual Java PCM results pass through the shared replay presenter at 44.1/48 kHz, with exact score equality between frequent and delayed polling. Candidate fields and every setting endpoint match TypeScript across loop joins; tuning can remove every attack without moving the grid. Capture workflow checks retain and review actual Java-generated PCM through the shared capture/controller boundary.

The local plugin was reinstalled, source files compared with the installed dependency, Capacitor synced with a compile-only URL, and Android `assembleDebug` succeeded using API 36 and JDK 23. No app was installed or launched on a phone. Host synthetic checks and compilation do not establish audible/display alignment, acoustic-kit accuracy or physical route/interruption behavior. Hardware timestamp availability, wired/Bluetooth output, metronome alignment and startup transfer cost remain device checks.

AudioTrack clock behavior follows the platform [AudioTrack reference](https://developer.android.com/reference/android/media/AudioTrack) and [AudioTimestamp reference](https://developer.android.com/reference/android/media/AudioTimestamp). Device latency is not calibrated by this implementation.
