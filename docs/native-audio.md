# Live microphone capture

Forgettime has three real capture implementations: Android `AudioRecord`, iOS `AVAudioEngine`, and browser `getUserMedia` + `AudioWorklet`. The native app requires the installed `ForgettimeAudio` plugin; it never silently substitutes a browser or simulated detector. Audio is analyzed locally and is not recorded to disk or uploaded by these capture paths.

## Shared interface and clock

`src/audio/capture.ts` exports `createAudioCapture({ onFrame, onError, onStopped, onDiscontinuity }, { deviceId? })`, with `start()` and `stop()` methods. `start()` must originate from a user action because browser audio activation and microphone permission require it. Once enabled, continuous capture lets the first strong transient passing Start sensitivity establish beat 1, and listens again after each automatic performance pause without another permission prompt. A browser `onDiscontinuity` callback invalidates the entire detector/beat reference while retaining the open stream; consumers must clear their timing engine before accepting subsequent frames.

Start sensitivity is applied in the shared timing engine to the captured onset strength, for both browser and native sources. It does not alter native capture, noise rejection or quieter follow-up hit detection. Adjusting it while playing leaves the current reference intact. It applies again after the full-bar timeout or interruption; see [timing behavior](audio-validation.md) for its threshold mapping.

Each `onFrame` receives:

- `time`: **seconds** through which all capture windows have been analyzed, on the same sample clock as the onsets. This watermark can trail the capture head by less than 2.7 ms so an attack still in a partial analysis window cannot be incorrectly paused at the full-bar boundary.
- `onsets`: `{ time, strength, confidence }[]` with sample-derived attack timestamps.
- `level`, `sampleRate`, `source` (`native` or `web`) and `timestampQuality` (`hardware` or `sample-clock`).
- Optional `hardwareTime`: monotonic platform seconds for the analyzed-through sample, when the OS provides a mapping.

Deliver the onsets to `TimingEngine.addOnset()` and the analyzed-through `time` to `TimingEngine.snapshot()`. Do not use `Date.now()`, `performance.now()`, bridge arrival times, or the UI animation clock as hit timestamps. Frames continue during silence. An automatic performance pause belongs to the timing engine; it must **not** stop microphone capture. Explicit Stop, app backgrounding, an ended input track, an AudioContext suspension, or a native audio interruption releases the microphone and requires another Enable microphone action. Temporary browser input gaps/muting instead clear the reference and wait for fresh captured audio without reopening the device.

The score clock never rebases when hardware timestamp availability changes. Android onset times use the position of the sample read from the captured stream divided by its sample rate; `AudioRecord.getTimestamp(..., TIMEBASE_MONOTONIC)` provides the corresponding hardware clock metadata. iOS uses the input tap's `AVAudioTime.sampleTime` relative to its first captured frame, with host-time metadata when available. These clocks isolate relative timing from JavaScript callback jitter. They do not prove zero acoustic/input latency or calibrated accuracy.

The worklet transfers 1024-frame mono PCM batches with `currentFrame` timestamps to the shared TypeScript onset detector. It emits silent output to keep the graph running without microphone feedback. A delayed main-thread callback delays presentation, but does not change a captured hit's timing. Browsers do not expose a microphone hardware capture timestamp here, so the browser path is explicitly `sample-clock` quality. It requires HTTPS or localhost, microphone access and AudioWorklet support.

An empty worklet input is missing audio, not recorded silence. Empty startup quanta are ignored. If input disappears or the render-frame clock jumps after capture begins, discard any partial PCM packet, notify the timing engine immediately, and resume with the next contiguous packet's real sample timestamp. Never concatenate samples from opposite sides of a gap, fill missing capture with zeros, or change timestamps to preserve an old lock. Captured zero-valued samples remain valid silence and continue the full-bar clock. The browser input selector uses an exact device ID when chosen and displays the actual track label; unavailable selections fail visibly rather than switching to a different microphone.

## Native integration

The local `forgettime-audio` dependency supports Capacitor 8, Android API 24+, Swift Package Manager, and CocoaPods. Run `pnpm install` and `pnpm cap:sync` after changes to the plugin. `file:` packages may need reinstallation to refresh their installed native files before sync/build.

The app must declare `android.permission.RECORD_AUDIO` in its Android manifest and `NSMicrophoneUsageDescription` in its iOS `Info.plist`. No background microphone service or background audio mode is enabled. Android requests unprocessed input when supported, otherwise voice-recognition input, and attempts to disable automatic gain, echo cancellation and noise suppression. iOS uses the measurement audio-session mode. Hardware/OS processing can still vary.

Permission denial, cancelled startup, repeated starts/stops, backgrounding, interruption and input-route changes are handled explicitly. iOS validates contiguous sample positions. Android rejects capture read stalls that could overrun its recording buffer. Those native events stop capture. Browser capture clears the reference on discontinuous worklet frame positions or temporary track muting and automatically resumes listening. No new stream inherits an old beat reference.

## Detector and accuracy limits

The Android and Swift detectors are direct ports of `src/audio/onset-detector.ts`: roughly 2.7 ms RMS windows, envelope-rise detection, an adaptive noise floor, 18 ms refractory period and a within-window attack crossing. An attack must also exceed the preceding 12 windows (about 32 ms) of background RMS by a factor of 1.8. This prevents ordinary low-frequency waveform troughs from becoming repeated attacks. The absolute RMS floor is 0.006 (previously 0.0015); combined with the contrast gate, the minimum accepted onset window is 0.0108 RMS. The first 12 windows after capture/reset only establish background energy. There is no added lookahead or callback-time timestamping.

A monotonic decay does not retrigger the rise detector; real cymbal resonances, room reflections and other sharp ambient sounds can still produce false positives. This is a conservative initial transient detector, not drum-source separation. Very faint hits or attacks masked by recent loud audio can be missed. The noise gate depends on microphone gain and is not an acoustic loudness calibration.

Close attacks can merge below the refractory period; rolls and flams must be treated as rhythmically ambiguous by the shared matcher. Quiet ghost notes masked by cymbals may be missed. Microphone distance, clipping, Bluetooth/USB routes, gain processing, sample-clock drift and input buffering can affect results. A reported millisecond error is an estimate against a reference derived from this same recording, not a laboratory calibration or an external metronome synchronization claim. Do not use Bluetooth audio as the accuracy benchmark.

## Validation

`node --import tsx plugins/forgettime-audio/tests/validate-parity.ts` compiles the standalone Java and Swift detector implementations on the host and compares their timestamps, strengths and confidence against the TypeScript detector at 44.1 and 48 kHz. The deterministic synthesized signal includes loud/soft attacks, a close flam, a rapid roll, and a long noisy decay. This verifies port parity; it does not validate microphone hardware or detection accuracy on representative recordings.

Capture adapter/worklet tests cover stop-during-permission, duplicate lifecycle calls, backgrounding, late callbacks, missing native plugins, silent sample-frame delivery, empty startup input, mid-packet gaps, clock jumps, muted/ended tracks, selected devices and automatic reference reacquisition. A live Chromium/MacBook microphone check recovered from an observed input gap and continued until explicit Stop; this verifies capture continuity, not drum-scoring accuracy. The iOS App simulator target compiled successfully with Xcode 26.6 and code signing disabled; that confirms build integration, not device audio behavior. A full Android app build remains unverified because the Android SDK was not found; Homebrew JDK 23 is available. The shared engine tests cover musical matching and silence timing. Physical iOS/Android capture, microphone permissions, route changes, input latency and the displayed beat counter still require device testing. No drummer recordings were supplied for this implementation. Before calling the app accurate, add consented, annotated recordings with steady grooves, fills, ghost notes, flams and cymbal-heavy playing, and record false positives, missed attacks, onset error, interpretation confidence and the full-bar pause behavior at 60 and 120 BPM. See the timing validation notes for that procedure.

## API references

- [Android AudioRecord](https://developer.android.com/reference/android/media/AudioRecord) and [AudioTimestamp](https://developer.android.com/reference/android/media/AudioTimestamp): frame positions and best-effort capture-time mapping.
- [Apple AVAudioTime](https://developer.apple.com/documentation/avfaudio/avaudiotime): sample and host times.
- [Apple microphone permission](https://developer.apple.com/documentation/avfaudio/avaudioapplication/requestrecordpermission(completionhandler:)): permission and required usage description.
- [Web Audio specification](https://www.w3.org/TR/webaudio/): AudioWorklet sample-frame clock.
