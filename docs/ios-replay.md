# iOS bar replay and detector diagnostics

Updated native builds loop the selected complete mono bar through `AVAudioPlayerNode` and the actual Swift detector. The playback-only session attaches no input tap and requests no microphone permission. The retained source is transferred once; the same immutable samples feed native output and analysis. Metronome clicks are synthesized on a separate node and never enter analysis. Original recorded audio, native results, candidate details and beat reference remain unchanged.

The shared `NativeBarReplay` owns the fixed timing reference and UI presentation. The native bridge has session-scoped `startReplay`, `readReplay`, `stopReplay` and `setReplayMetronome` operations. Start, bar changes and detector changes create fresh runs; detector state persists over each loop boundary within a run. Pause releases output and preserves selection. Silence and a setting that rejects every attack cannot terminate or re-anchor the shared replay grid.

## Audio clocks and bounds

The player loops a mono Float32 buffer at the source sample rate; the engine mixer handles any output-device conversion. Source frames stay on their original sample rate. The native player timeline supplies the render position. `outputPresentationLatency` converts it to an estimated audible source cursor. The bridge labels this clock **estimated** because downstream device latency is not physically calibrated. A separate analyzed-through source-frame watermark trails by an incomplete detector window; writing, queuing or polling audio is never treated as proof that it has been heard.

Native analysis reads the retained source modulo its length up to the audible cursor, preserving one detector across all iterations. One read processes at most two seconds of delayed audio. A regressed output clock, excessive catch-up, output stall or native error stops visibly instead of skipping samples or resetting analysis. The source is bounded to a complete bar of at most 8 seconds at an integer 8–192 kHz rate (at most 1,536,000 Float32 samples). This is a bounded but potentially large one-time JSON bridge payload; startup cost still requires device measurement.

Backgrounding, audio-session interruption, route/override changes and engine configuration failure release output. Playback never resumes automatically and never starts capture. Session IDs isolate reads, stop requests, metronome plans and delayed startup; a bounded 32-entry cancellation history rejects cancelled starts. One terminal state records why the most recent run ended.

## Actual native controls and diagnostics

The Swift detector implements canonical version 1 settings: minimum RMS, attack contrast, minimum separation and level recovery. It matches the shared normalization and endpoint ranges. Live configuration changes are applied to the actual detector without resetting its sample clock, accumulated history or the shared musical reference. Start sensitivity remains a separate shared acquisition gate.

Accepted and rejected candidates include the real sample-derived timestamp, run-local ID, strength, confidence, settings snapshot, reasons and measured decision values/thresholds. Reasons distinguish warming up, level, rise, contrast, rearming and separation. Shared acquisition annotations and uncertain rhythmic scores remain separate. Candidate production is independent of whether the details overlay is open. Each undrained batch is capped at 2,048 candidates with an explicit dropped count; the shared view/recording has its own bounded retained history. Native live frames and start results identify their analysis as `forgettime-swift-onset`, version `1`.

## Verified scope

Host synthetic checks:

```sh
node --import tsx plugins/forgettime-audio/tests/validate-ios-diagnostics.ts
node --import tsx plugins/forgettime-audio/tests/validate-ios-replay.ts
node --import tsx plugins/forgettime-audio/tests/validate-ios-capture.ts
node --import tsx plugins/forgettime-audio/tests/validate-parity.ts
FORGETTIME_NATIVE_HOST_TESTS=1 pnpm exec vitest run plugins/forgettime-audio/tests/ios-replay-workflow.test.ts
```

The diagnostics check compares every candidate field, settings endpoint and measurement against TypeScript at 44.1/48 kHz, including explicit cap overflow. The replay check exercises multiple loops, native detector state, source/output-rate mapping, latency offsets, invalid formats, regressed clocks, catch-up bounds and settings that remove every hit. The live capture check verifies actual setting changes preserve candidate history and source coordinates. The Swift workflow fixture passes actual native-generated results through the shared replay presenter, verifies identical score results with frequent versus two-second delayed reads at both sample rates, and keeps the grid fixed when tuning rejects every attack. Only output hardware and its clock are substituted.

The local plugin was reinstalled, installed/source Swift files compared, Capacitor synced, and the generic iOS Simulator app compiled with code signing disabled. These checks do **not** establish audible replay/display alignment, physical route/interruption behavior or acoustic-kit accuracy. No simulator app or phone was launched for playback, and no microphone was activated. Wired/Bluetooth output, startup payload cost and actual iPhone behavior remain device-validation requirements.
