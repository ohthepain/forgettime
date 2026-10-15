# Verification history

The current recording/replay implementation is covered by [integrated workflow validation](recorded-workflow-validation.md). Entries below are historical snapshots; earlier references to missing recording support, multi-hit acquisition or an absent Android SDK do not describe the current implementation.

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

## Slower detector recovery and softer follow-up attacks

The detector now uses an immediate level attack, one-second hold and exponential four-second release instead of quickly lowering its noise threshold during gaps. This changes detection thresholds only: captured PCM, raw onset strength and sample timestamps are not normalized or compressed. A bounded shorter background comparison admits distinct softer attacks after an accent, retains the pre-accent room level and cannot perpetuate itself through follow-up detections. Start sensitivity, fixed phase and full-bar timing are unchanged.

- All 98 tests, TypeScript checking and production build passed. New regressions retain ghost notes, reject faint post-playing transients through the two-second bar at 120 BPM, preserve the visible beat until timeout, recover for later quiet playing, detect softer attacks 40 ms after accents, and reject ongoing 25–350 Hz room noise after an accent.
- On the new synthetic recovery fixture, the prior detector produced seven candidates, including two unwanted faint probes; the revised detector produces the five intended attacks at both 44.1 and 48 kHz. On the softer-follow-up fixture it detects all four attacks, versus two previously. These constructed cases demonstrate regression behavior, not performance on recorded drums or footsteps.
- Java and Swift compile and match TypeScript times, strengths and confidence within `1e-10` at 44.1/48 kHz for six fixture families: percussion, rumble, their mixture, slow level recovery, softer accent follow-ups, and room noise after an accent. The original percussion/mixed fixtures produce 10 candidates at 44.1 kHz and 11 at 48 kHz; not every constructed attack is detected. The installed local plugin was refreshed and both Capacitor projects synced. Full native app builds and physical microphone tests were not repeated for this change.
- Browser capture still requests automatic gain control, echo cancellation and noise suppression off, and now reads back the applied track settings. The UI reports processing only when the browser explicitly reports it enabled; missing settings remain unknown. Capture tests cover enabled, disabled and unspecified values. This cannot detect hidden hardware processing or repair clipping.
- Re-running the earlier unannotated non-drum sample at 110 BPM produces 270 candidates and 62 intervals below 45 ms, versus 200/28 with the previous stricter detector. Precision/recall remain null and no automatic pause occurs before the file ends. More candidates may include recovered attacks and additional false triggers; this file does **not** establish an accuracy improvement. The local diagnostic report remains under ignored `output/audio-validation/slow-recovery/`.

The user's reported drums and walking sounds have not been recorded/annotated for comparison. Faint intentional hits below the relative gate may still be missed, and sufficiently sharp/loud footsteps may still pass. Browser clients need to reload and restart capture; installed native apps need a rebuild to receive the updated native detector.

## One-bar waveform and detected-hit overlay

The shared UI now displays a fixed-scale waveform below the timing result. It uses actual captured min/max sample envelopes, beat guides 1–4, and a sample-clock playhead that wraps and progressively overwrites from beat 1. Immediate detected-hit markers use blue, purple, red, orange and yellow from soft to hard input strength; this is not a timing-score colour scale. Simulation uses a separately generated, explicitly labelled waveform. No playable recording or persistent audio storage was added.

- TypeScript checking and the full Vitest suite passed. A final signed-range correction also passed the affected waveform and practice integration tests. Added cases cover single-sample peaks, signed ranges, packet boundaries, clock gaps, 60/120/240 BPM alignment, progressive overwrite by silence, wrap across beat 1, pre-roll, fresh references, pause/freeze, start markers before any timing score, colour mapping, and clearing on stop/interruption/settings changes.
- Standalone Java/Swift compilation and detector parity passed. Waveform envelopes also match TypeScript within `1e-10` for time, duration, minimum and maximum at 44.1/48 kHz, with 3,006/3,000 windows respectively in each six-second percussion/rumble fixture. These are host-side synthetic checks, not device microphone measurements.
- The local plugin dependency was refreshed and Capacitor synced. The full iOS simulator app compiled successfully with signing disabled, including the updated capture bridge and waveform helper. A full Android app build remains unverified locally because the Android SDK is absent; its standalone Java waveform helper compiled in the parity check.
- The production client/server build passed. Browser layouts at 320, 393 and 1000 px showed four beat guides, all five legend labels, generated waveform/markers, and no horizontal overflow.
- Generated PCM through the actual browser AudioWorklet path at 120 BPM produced all five marker colours, three observed wraps, and no counter/playhead mismatches across 249 sampled playing frames. It moved through Listening → Playing → Paused → Playing, rendered the waveform, and cleared all markers on Stop. A separate 100 BPM run also stayed aligned. This checks live capture integration with a synthesized source; no physical microphone recording or real-drum accuracy claim is implied.

Browser clients need a reload and new listening session. Installed native apps need a rebuild to emit waveform envelopes; an older plugin is identified as unavailable instead of displaying generated data as microphone audio. The existing acoustic detection and platform accuracy limitations still apply.

## Metronome output and coaching (2026-10-13)

- `pnpm test`: 121 tests passed; `pnpm typecheck`: passed. New cases cover consecutive beat classification, exact threshold equality, large sequence errors withheld from the precise meter, recovery, rests/uncertainty, duplicate snapshots, per-beat fill aggregation, expiry/restart, output error isolation and preference persistence.
- AudioWorklet PCM tests verify quarter-note spacing, beat-one accent, first-beat omission, lease/mute/gap silence and unchanged captured samples. Chromium with generated microphone PCM verified three first-bar clicks, each 24,000 samples apart at 48 kHz / 120 BPM. Need help produced the observed sequence On → Playing → On → Playing → On, with three additional help clicks after deliberate 130 ms deviations and silence after recovery. This captures actual generated output PCM, routed to a test monitor rather than the physical speakers; it is not a live-drum or hardware-latency measurement.
- Browser checks: mute, mode and 75 ms threshold survive reload; Settings fits 320, 393 and 1000 px viewports. Screenshots and browser logs are under ignored `output/playwright/metronome-*` and `output/metronome-validation/`.
- Native dependency reinstalled and `pnpm cap:sync` run. Final iOS simulator app build passed using Xcode with code signing disabled. Java/Swift capture detector and waveform parity still passed at 44.1/48 kHz. Android output implementation is present, but full Android compilation is unverified because no Android SDK is installed here.
- Production: Prisma generation passed. The default `pnpm build` stalled while Vite bundled its config; that build process alone was terminated. `pnpm exec vite build --configLoader runner` completed both client and server production bundles successfully. No build configuration or running dev-server process was changed to work around that local tooling stall.
- Remaining device checks: wired-headphone round-trip alignment, physical output/mic routing, mute/stop buffered latency, interruption/route changes on both phones, acoustic click leakage and recovery with a real drummer. Speakers can be picked up as hits; use headphones. There is no echo cancellation or timing-window blanking.

## Browser metronome latency correction (2026-10-13)

- Fixed an uncompensated audio round trip: the output schedule now advances by available browser-reported input latency, base rendering latency and hardware output latency. It is frozen per performance and does not shift captured hits, waveform envelopes, beat phase or timing scores. Native hardware-clock scheduling is unchanged.
- Separate the musical stop deadline from the output watchdog so a 350+ ms compensation does not mute every click or add a fifth beat to First bar. Skip an already-missed first click deadline, including a delayed worklet activation message, rather than emitting a partial late click.
- `pnpm test`: 133 tests passed; `pnpm typecheck`: passed. Actual worklet-code loopback fixtures at 90/120 BPM model a 250 ms device round trip and retain deliberately added 25 ms drift. Also covered: missing/invalid estimates, long latency, frozen estimates through Need help silence, reset, unchanged capture/envelope timestamps and late activation across plan renewals.
- Isolated Chromium with generated input and mocked device-delay reports verified a 249.98 ms advance relative to the captured opening transient, three First bar clicks with exact 24,000-sample spacing at 48 kHz/120 BPM, and Need help activation/recovery. Its generated output was inspected through a test audio monitor, not sent to physical speakers. Logs: ignored `output/latency-validation/browser-audio.log`.
- Production bundles passed with `pnpm exec vite build --configLoader runner`. Java/Swift detector and waveform parity passed at 44.1/48 kHz. No native plugin source changes in this correction; native device testing is still outstanding.
- User's particular microphone/output route has not been established and no physical route calibration was performed. Browser delay reports may be incomplete (especially remote microphones or Bluetooth). This fixes the missing compensation, not proof that every device is now calibrated. The upper meter's 240 ms rhythmic-interpretation presentation delay remains distinct from waveform marker placement.

## Drizzle database migration (2026-10-15)

- Replaced the application Prisma client/schema/tooling with Drizzle ORM and its Better Auth adapter. The initial SQL baseline supports fresh databases and the unchanged previous auth schema without dropping tables.
- `pnpm db:generate` reports no schema changes against committed migration metadata; `pnpm typecheck`, all 139 Vitest tests, and the normal `pnpm build` passed.
- Disposable Docker PostgreSQL 18 integration passed on both a fresh database and the previous empty auth schema. Both applied migrations twice, then verified signup, hashed password persistence, session cookies/lookup, invalid-password rejection, valid signin, logout invalidation and health. These paths now run in CI.
- No live database migration, AWS deployment or native/store release was performed. The Docker application image itself was not built in this check.
