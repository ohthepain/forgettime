# Live microphone capture

Forgettime has three real capture implementations: Android `AudioRecord`, iOS `AVAudioEngine`, and browser `getUserMedia` + `AudioWorklet`. The native app requires the installed `ForgettimeAudio` plugin; it never silently substitutes a browser or simulated detector. Audio is analyzed locally and is not recorded to disk or uploaded by these capture paths.

## Shared interface and clock

`src/audio/capture.ts` exports `createAudioCapture({ onFrame, onError, onStopped })`, with `start()` and `stop()` methods. `start()` must originate from a user action because browser audio activation and microphone permission require it. Once enabled, continuous capture allows the timing engine to start from opening hits and listen again after each automatic performance pause without another permission prompt.

Each `onFrame` receives:

- `time`: **seconds** through which all capture windows have been analyzed, on the same sample clock as the onsets. This watermark can trail the capture head by less than 2.7 ms so an attack still in a partial analysis window cannot be incorrectly paused at the full-bar boundary.
- `onsets`: `{ time, strength, confidence }[]` with sample-derived attack timestamps.
- `level`, `sampleRate`, `source` (`native` or `web`) and `timestampQuality` (`hardware` or `sample-clock`).
- Optional `hardwareTime`: monotonic platform seconds for the analyzed-through sample, when the OS provides a mapping.

Deliver the onsets to `TimingEngine.addOnset()` and the analyzed-through `time` to `TimingEngine.snapshot()`. Do not use `Date.now()`, `performance.now()`, bridge arrival times, or the UI animation clock as hit timestamps. Frames continue during silence. An automatic performance pause belongs to the timing engine; it must **not** stop microphone capture. Explicit Stop, app backgrounding, lost input, or audio interruption releases the microphone and requires another Listen action.

The score clock never rebases when hardware timestamp availability changes. Android onset times use the position of the sample read from the captured stream divided by its sample rate; `AudioRecord.getTimestamp(..., TIMEBASE_MONOTONIC)` provides the corresponding hardware clock metadata. iOS uses the input tap's `AVAudioTime.sampleTime` relative to its first captured frame, with host-time metadata when available. These clocks isolate relative timing from JavaScript callback jitter. They do not prove zero acoustic/input latency or calibrated accuracy.

The worklet transfers 1024-frame mono PCM batches with `currentFrame` timestamps to the shared TypeScript onset detector. It emits silent output to keep the graph running without microphone feedback. A delayed main-thread callback delays presentation, but does not change a captured hit's timing. Browsers do not expose a microphone hardware capture timestamp here, so the browser path is explicitly `sample-clock` quality. It requires HTTPS or localhost, microphone access and AudioWorklet support.

## Native integration

The local `forgettime-audio` dependency supports Capacitor 8, Android API 24+, Swift Package Manager, and CocoaPods. Run `pnpm install` and `pnpm cap:sync` after changes to the plugin. `file:` packages may need reinstallation to refresh their installed native files before sync/build.

The app must declare `android.permission.RECORD_AUDIO` in its Android manifest and `NSMicrophoneUsageDescription` in its iOS `Info.plist`. No background microphone service or background audio mode is enabled. Android requests unprocessed input when supported, otherwise voice-recognition input, and attempts to disable automatic gain, echo cancellation and noise suppression. iOS uses the measurement audio-session mode. Hardware/OS processing can still vary.

Permission denial, cancelled startup, repeated starts/stops, backgrounding, interruption and input-route changes are handled explicitly. iOS validates contiguous sample positions. Android rejects capture read stalls that could overrun its recording buffer. Browser capture rejects discontinuous worklet frame positions. These events stop capture so a new stream cannot inherit an old beat reference.

## Detector and accuracy limits

The Android and Swift detectors are direct ports of `src/audio/onset-detector.ts`: roughly 2.7 ms RMS windows, envelope-rise detection, an adaptive noise floor, 18 ms refractory period and a within-window attack crossing. A monotonic decay does not retrigger the rise detector; real cymbal resonances, room reflections and other sharp ambient sounds can still produce false positives. This is a conservative initial transient detector, not drum-source separation.

Close attacks can merge below the refractory period; rolls and flams must be treated as rhythmically ambiguous by the shared matcher. Quiet ghost notes masked by cymbals may be missed. Microphone distance, clipping, Bluetooth/USB routes, gain processing, sample-clock drift and input buffering can affect results. A reported millisecond error is an estimate against a reference derived from this same recording, not a laboratory calibration or an external metronome synchronization claim. Do not use Bluetooth audio as the accuracy benchmark.

## Validation

`node --import tsx plugins/forgettime-audio/tests/validate-parity.ts` compiles the standalone Java and Swift detector implementations on the host and compares their timestamps, strengths and confidence against the TypeScript detector at 44.1 and 48 kHz. The deterministic synthesized signal includes loud/soft attacks, a close flam, a rapid roll, and a long noisy decay. This verifies port parity; it does not validate microphone hardware or detection accuracy on representative recordings.

Seven capture adapter/worklet tests cover stop-during-permission, duplicate lifecycle calls, backgrounding, late callbacks, missing native plugins and silent sample-frame delivery. The iOS App simulator target compiled successfully with Xcode 26.6 and code signing disabled; that confirms build integration, not device audio behavior. A full Android app build remains unverified because the Android SDK was not found; Homebrew JDK 23 is available. The shared engine tests cover musical matching and silence timing. Physical iOS/Android capture, microphone permissions, route changes, input latency and the displayed beat counter still require device testing. No drummer recordings were supplied for this implementation. Before calling the app accurate, add consented, annotated recordings with steady grooves, fills, ghost notes, flams and cymbal-heavy playing, and record false positives, missed attacks, onset error, interpretation confidence and the full-bar pause behavior at 60 and 120 BPM. See the timing validation notes for that procedure.

## API references

- [Android AudioRecord](https://developer.android.com/reference/android/media/AudioRecord) and [AudioTimestamp](https://developer.android.com/reference/android/media/AudioTimestamp): frame positions and best-effort capture-time mapping.
- [Apple AVAudioTime](https://developer.apple.com/documentation/avfaudio/avaudiotime): sample and host times.
- [Apple microphone permission](https://developer.apple.com/documentation/avfaudio/avaudioapplication/requestrecordpermission(completionhandler:)): permission and required usage description.
- [Web Audio specification](https://www.w3.org/TR/webaudio/): AudioWorklet sample-frame clock.
