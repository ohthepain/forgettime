# Initial implementation checks — 13 October 2026

These results describe local checks, not a released application.

| Check | Result |
| --- | --- |
| TypeScript and production client/server build | Passed |
| Vitest audio, capture, UI, preference and lifecycle regressions | Passed (see `pnpm test` for current count) |
| Java/Swift/TypeScript detector parity at 44.1 and 48 kHz | Passed on identical synthetic PCM |
| iOS App simulator compilation, Xcode 26.6, signing disabled | Passed, including the final analysis watermark changes |
| Android full app compilation | Not run locally: Android SDK absent. CI includes compilation with JDK 21. |
| Terraform formatting and provider validation | Passed without backend/apply |
| PostgreSQL 18 tenant provisioning | Passed fresh create, repeat preserving data, wrong-password rejection and wrong-owner rejection |
| Real Better Auth/PostgreSQL integration | Passed signup, password hashing, signin, cookie/session lookup, logout invalidation and disabled-account health |
| ARM64 production Docker image | Built; actual startup migrations, health endpoint and rendered HTML passed with isolated PostgreSQL |
| Mobile browser layout | Inspected at 393 px; no horizontal overflow; beat counter reserves its space |
| Browser simulation | Locked tempo, beat counter and stationary lines observed; computed animation duration 1 second |
| Browser AudioWorklet pipeline | Passed with a generated PCM stream substituting for the microphone |

The browser pipeline fixture ran at 120 BPM. It produced six opening attacks followed by a locked performance, preserved the reference through a 1.75-second gap, paused after the next last-hit timeout of at least 2 seconds, and returned through Finding beat to Playing after new attacks. Captured state transitions relative to clicking Enable were approximately 0.22s Finding, 2.70s Playing, 7.42s Paused, 7.68s Finding, 10.18s Playing. The fixture's preceding attack was at 5.35s in its source stream; UI timing includes source startup and display scheduling. The unit tests establish the exact audio-clock timeout boundaries; these browser wall-clock observations do not establish measurement accuracy.

This was **generated audio through the real browser processing graph**, not a physical microphone recording. It verifies integration and lifecycle, not real-drum detection accuracy. No consented drum recordings or hardware calibration were available for this initial check. See [audio validation](audio-validation.md) for the annotated-WAV runner and the remaining groove/fill/ghost-note/flam/cymbal checks.

No AWS apply, DNS changes, email sending, Google credential registration, store upload or release occurred. The Capacitor shells require a configured remote app URL and network access at launch. Google sign-in is available on web when configured; native Google ID-token integration is pending platform-specific OAuth setup and is not displayed in the mobile account dialog.

## Subsequent supplied recording

The first non-drum sample was tested at the user-confirmed 110 BPM. It exposed retriggering/noise sensitivity and does not pass detection-accuracy validation. The baseline synthetic/build checks above remain valid within their stated scope. See [recording results](recording-tests/2026-10-13-non-drum.md).

## Browser interruption fix

The original browser adapter stopped on discontinuous frame positions, and its worklet could concatenate input from opposite sides of a missing render quantum inside a partial batch. The worklet now discards that partial batch and explicitly signals the gap. The adapter resets analysis and the timing reference, retains the microphone, and resumes from actual sample timestamps. Captured silence still preserves the locked clock until the full-bar timeout. Temporary muting also resets the reference; an ended track still stops capture with an actionable error.

- All 63 Vitest tests, TypeScript checking and the production build passed. Added coverage includes empty startup, gaps within partial packets, forward/backward clock jumps, variable quantum sizes, selected input, temporary mute, ended track, and beat reacquisition. Java/Swift/TypeScript detector parity passed again at 44.1 and 48 kHz.
- A real MacBook Pro built-in microphone in the local Chromium test browser delivered 632 PCM packets. One input gap occurred; capture recovered and continued until explicit Stop, rather than raising the reported interruption error. Audio was neither recorded nor uploaded. This checks live capture operation only; ambient sound is not a drum-accuracy fixture.
- A separate generated-PCM browser fixture locked at 120 BPM, then deliberately disconnected the worklet input. The counter immediately hid, the reference cleared, and the microphone remained enabled. Reconnection returned through acquisition to Playing with no error and no retained interruption notice. This checks the UI/processing recovery path, not hardware timing accuracy.
- The browser microphone chooser uses the selected input and displays the live track's label. The 393 px layout was inspected with no horizontal overflow.

The user's existing ChatGPT built-in browser, Chrome and Brave sessions still need a reload/retry. This check does not establish compatibility in every embedded browser or verify an iPhone Continuity microphone route. Native capture implementations were not changed.

## Ambient-noise rejection

After the user reported that distant traffic starts the detector, the browser/Java/Swift detectors gained a preceding-energy comparison over about 32 ms and a higher absolute signal floor. Gradual or sustained noise must now be distinguished from a sharp attack before it can start acquisition or extend the silence timeout. The selected BPM, phase lock and full-bar timeout are unchanged.

- All 73 tests, TypeScript checking and production build passed. Ten added detector cases cover synthetic rumble at 25–350 Hz, background already present at activation, faint transients, quiet intentional attacks, a groove with a ghost note over rumble, and full-bar auto-pause while rumble continues. Existing sample-timestamp, flam, cymbal-decay and pre-timeout attack checks still pass.
- Java/Swift/TypeScript parity passed at both 44.1 and 48 kHz for percussion, ambient rumble and percussion mixed with rumble. Both native ports produced zero onsets for the standalone synthetic ambience. The local plugin dependency was refreshed and Capacitor synced. Standalone native detector compilation is not an Android/iOS device microphone check.
- The earlier unannotated non-drum file produces 200 candidates versus 628 originally; its opening two seconds still produce 14 candidates versus 68 originally. This is reduced triggering, **not proof of accuracy**. See the recording report for the remaining limitations.

No recording of the reported passing car was available. Real traffic, speech, room acoustics, microphone gain and quieter playing still need user/device checks. Sharply percussive background sounds can still resemble drum hits, and stronger rejection can miss very faint or overlapping attacks. In the original parity fixture, the revised detector emits 10 rather than 11 candidates; the separate two-attack flam regression still passes. Parity establishes identical behavior between ports, not perfect detection of every constructed attack.

## First-transient start and settings

The latest requested behavior replaces multi-hit acquisition: the first reliable onset above Start sensitivity defines beat 1 immediately, with no later phase correction. The top-right gear opens a panel containing only Start sensitivity, default 50%, saved locally. Sensitivity changes apply only to starting/restarting; an active beat and quieter follow-up hits are preserved.

- All 84 tests and TypeScript checking passed. Coverage includes start thresholds at 0/50/100%, ignored weak candidates, immediate captured-time anchoring, persistence/legacy preference defaults, editing sensitivity without reopening capture, full-bar timeout and gated restart, drift and rhythmic interpretation. The production build passed on retry outside the restricted process sandbox after the first Vite process stalled.
- Browser checks at 320, 393 and 1000 px confirmed the gear/header and panel fit without horizontal overflow, one setting control, persistence after reload, Escape dismissal with focus returned to the gear, and the beat continuing while settings are open.
- Generated PCM through the actual browser AudioWorklet at 120 BPM and 50% sensitivity: a weak onset before the start left the app listening; the first strong onset displayed beat 1; a quieter follow-up produced a meter line; a full-bar silence paused the performance; another weak onset did not restart it; a strong onset restarted at beat 1. This is a synthetic integration check, not physical microphone accuracy validation.
- Detector parity still passes for percussion, rumble and mixed fixtures at 44.1 and 48 kHz. The native audio plugin was not changed by this settings/startup change; both platforms receive the behavior through the shared UI/timing engine.

Earlier “Finding beat” and opening-sequence results above are historical checks of the previous acquisition behavior.
