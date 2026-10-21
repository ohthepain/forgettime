# Take review and replay

Forgettime keeps audio on your device. The microphone is off when the page/app opens. Reviewing or importing audio never enables it.

## Record and review

1. Set BPM and choose **Enable microphone** for one take, or hold the record button for **Auto** (also available in its dropdown) for successive takes. The dropdown beside Record exposes Input gain (default 1×, range 0.25–8×), a multiplier of future microphone samples before detection and retention. The first reliable detector-accepted attack establishes beat 1. Tempo and phase remain fixed even if you drift.
2. A take ends after four beats of elapsed silence from the last accepted hit: 2 seconds at 120 BPM, 4 seconds at 60 BPM. Shorter rests preserve the take and beat clock. Single mode releases the microphone; Auto keeps listening for another take. **Stop listening** ends either mode immediately.
3. Use the waveform's previous/next controls to inspect the captured bars. Any review action releases the microphone and switches Auto off. Initial review selects the last complete played bar where available; later captured audio remains accessible even if the detector missed it. Partial bars show their missing coverage and cannot loop.
4. **Loop selected bar** plays the actual retained audio directly through the platform detector. The playhead, beat number, pendulum and meter follow playback. **Pause** preserves the selection. The microphone remains off, so room sound does not affect comparison.
5. Open **Detection details** to inspect accepted and rejected candidates. Rejected markers are optional, subdued and selectable; the paged list supports keyboard/touch access and explains decision values. A detector-accepted attack may still have uncertain rhythmic interpretation and no precise timing score.
6. Open **Detection sensitivity** in the imported-audio section. Its 0–100 slider (default/reset 50) updates import markers immediately and starts a fresh replay when playing. Higher settings favor quieter or less obvious attacks and can add false detections. The algorithm's numeric controls remain internal; diagnostics still expose decision measurements. The adjacent **Detection balance** slider weights Energy (0%) against Frequency change (100%, default for new material). Both tuning controls recompute full-source import markers and start a fresh replay when playing. Balance changes preserve the PCM, musical reference and original analysis. Live capture uses the selected training profile (current or mel) from the next explicit microphone start; without a selected profile it uses shared defaults. The live source label identifies the selected family. Changing the selected profile does not alter a running take. Native selected profiles analyze the retained, gain-adjusted PCM with the same TypeScript detector as the browser, rather than using native detector events. Both review sliders remain independent of live capture. Input gain changes preserve the active musical reference and never rescale imported or retained audio.

Starting/resuming playback, changing bars or changing detector settings starts fresh analysis. Within a run, detector state continues through loop boundaries. BPM and the established grid never follow detections. A silent loop stays running; a changed first detection cannot move the grid. Original results/settings remain separate from current analysis. Compare equivalent run starts and loop numbers: joins and fresh detector state can legitimately differ from the original continuous take.

The latest completed working take is quietly retained on-device as a development convenience. Refresh/restart restores its full audio, musical reference, original analysis, detector controls (including balance) and selected review bar with the microphone off. Imported and saved material opened for review also replace this recovery copy. Starting another recording leaves the previous stored copy intact until a completed replacement commits. Active takes have no checkpoints; storage failures are silent and occasional loss is acceptable. This single recovery slot uses IndexedDB, including in the native WebView, independently of the explicitly saved-bars library. Browser/app storage clearing or eviction can remove it. Capture is limited to 120 seconds including opening context; the limit stops capture visibly and preserves valid material. Missing input, backgrounding and interruptions end continuous recording rather than manufacturing samples. Actual phone behavior still needs the checks listed in [validation](recorded-workflow-validation.md).

Metronome sound, mode and Timing help threshold are grouped in **Settings**. Recording options beside Record retain microphone selection, Input gain and Auto capture. The practice screen omits the former capture-mode/silence-duration explanatory paragraphs; capture stopping and the fixed musical reference keep the behavior described above.

## Save and import

**Save bar** persists only the selected bar and its original analysis as a complete WAV/`.forget` pair. The local saved-bars list survives app/page restart. Browser storage uses IndexedDB; native storage is private and excluded from backup. Export is explicit: browser entries provide separate matching WAV and `.forget` downloads; native entries open the system share/export chooser with both files. A requested download/share is not proof that a destination wrote it. Clearing browser/app storage or uninstalling can remove the local library, so export important bars.

**Import audio** opens a picker on every platform; desktop browsers also accept a drop. Select one WAV or M4A and, optionally, its `.forget` file. Select both explicitly: the app does not read an unselected neighboring file.

- A valid matching pair restores BPM, beat alignment, settings and originals without setup. The SHA-256 digest identifies the actual WAV bytes; matching names alone are insufficient.
- Ordinary audio requires **Confirm tempo and beat one**. Set its intended BPM, then place beat one with a waveform tap away from a marker, the seconds field or keyboard arrows (one sample; Shift for 10 ms; Home/End). This is a one-time setup; replay then keeps that grid fixed.
- Invalid/mismatched metadata gets an explanation and an explicit **Use audio only** option. Ordinary imports have no invented original detection results. Replay supplies current analysis.
- Cancel, decode errors and unsupported formats preserve the previous review with the microphone off. Partial saved bars can be restored and inspected but remain non-loopable.

WAV supports signed PCM16/24/32 and Float32, including validated extensible formats, at 8–192 kHz with 1–8 channels. M4A support depends on the platform's installed codec. Channels are averaged to mono; opposite-phase channels can cancel. Browser compressed decoding can resample to its AudioContext rate; analysis and playback use the same returned decoded clock. Native compressed decoding retains the actual decoder sample rate. Failures never substitute silence or simulated hits.

Selected audio is limited to 64 MiB, decoded mono audio to 32 MiB and 120 seconds, and `.forget` metadata to 2 MiB. A local library holds at most 100 bars or 256 MiB. Exceeding limits fails visibly without silently evicting saved bars. Per-bar library deletion is not implemented. Candidate history is bounded to 2,048 events with a visible dropped count; missing diagnostics are distinct from a measured zero. See [bar file contract](bar-files.md) for exact interchange and storage rules.

## Shared waveform interaction

Import setup and Training annotation use the same `WaveformDisplay`. Drag vertically on the detail waveform to zoom time, horizontally to select complete attack slices, horizontally on the overview to navigate, and vertically on the overview to change waveform height. Hover or focus an attack to reveal its square Play/Stop control. Escape stops playback. There are no separate zoom/height/reset buttons. With a waveform focused, + and - zoom time and 0 resets the view. On the overview, left/right and Home/End navigate, while up/down change waveform height. View controls never change source PCM, attack times or beat one. Import retains its beat-one placement controls; annotation retains explicit Add mode and desired-attack editing.

## What the display can establish

Hit colours are captured strength (blue → purple → red → orange → yellow), not timing accuracy or calibrated loudness. Waveform height zoom affects display only. Detection markers indicate accepted onset estimates, not raw threshold crossings or guaranteed timing scores. The timing meter still withholds precision for ambiguous attacks; drift, overlapping instruments, cymbal masking and flams remain difficult.

These tools make detector behavior inspectable and comparisons repeatable. They do not establish that the detector is accurate on your kit. Use headphones for metronome-assisted live practice: speaker clicks can be detected as hits. Browser/OS output clocks are estimates until measured against hardware. Live audio, replay and Simulation have distinct labels; simulation never activates the microphone.


## Automatic microphone gain reduction

During live capture, including waiting between Auto takes, any absolute post-gain PCM peak above 1.25 starts a one-second downward gain animation. The loudest observed peak determines a target of 0.9 full scale; packets carry their actual applied gain so queued native packets cannot distort that calculation. Louder input can lower the target during the same second, and later overloads can start another reduction. Gain ranges from 0.1× to 8× and the corrected value is retained as the normal preference. Software gain cannot repair clipping that occurred in the microphone or converter.

Recording options opens automatically and closes 500 ms after adjustment finishes, unless the player interacts with it or had opened it manually. Dismissing it suppresses automatic reopening for that take without stopping gain adjustment. Touching the gain slider cancels adjustment and disables automatic reductions until the next take. Stopping capture cancels the ramp at its current value. Beat one, tempo, phase and retained samples never change as a result of the adjustment; only future microphone samples use the new gain. Replay, imports and simulations do not trigger adjustment. Older native plugins without applied-gain packet metadata do not perform automatic adjustment.

Validation: the standard suite passed with 307 tests and 21 opt-in tests skipped; typecheck, production build and Java/Swift/TypeScript detector parity passed. Focused controller/UI tests cover threshold, peak targeting, retargeting, minimum gain, manual override, stopping, popup lifetime and reference preservation. Java and Swift host capture checks verify applied-gain metadata and 0.1× retained PCM; all six Android capture/practice workflow tests passed. These synthetic and host checks do not establish physical-device or acoustic-kit behavior.


## Frequency-change review detection

The recorded-material detector compares growth in octave-spaced frequency bands. It blends the strongest band evidence with the existing broadband energy evidence before making one onset decision; it does not merge two detection lists or classify instruments. At 0% balance, the original detector is unchanged. At 100%, attack evidence comes from frequency changes while the shared startup, level and minimum-separation safeguards remain. Band history and smoothed rearming distinguish new attacks from continuing sound; detector state continues across loop repetitions.

Detection details show Energy evidence, Frequency evidence, the selected band and their blended score. The acceptance threshold is 1. Legacy RMS measurements remain broadband context rather than independent pass/fail requirements in frequency mode. These are experimental controls: fewer detections alone do not establish better accuracy, and a mono signal's exact cancellation cannot be reconstructed. The native replay plugin reports balance capability; older builds must be rebuilt/synced rather than silently substituting energy detection. Live capture and original WAV/`.forget` settings remain unchanged.


## Compact practice controls

Record, the metronome and BPM share one top row. Tapping or keyboard-activating the metronome opens Settings. The idle card omits the Tempo heading, idle tagline and pocket guidance, Ahead/On time/Behind labels and default ONE BAR/WAVEFORM heading. Active capture/replay status, timing results, waveform provenance and the live/simulation distinction remain available. Recording and timing behavior are unchanged.

## Training annotation

Recorded bar now offers **Annotate training attacks** with Correct attacks, Mark uncertainty, and Review & save. It stops capture/replay and keeps the microphone and Auto off. Desired labels are independent of calculated detections; explicit Add/Overwrite confirms review without a checkbox. Training tempo keeps beat one/attacks at their source times while recutting bar boundaries. See [training annotation](training-annotation.md) for editing, draft safeguards, source retention and validation limits.

## Audio timing calibration (browser)

The first action in Settings is **Calibrate**. Its instructions ask for audible
speaker volume and a quiet room. Closing with X or Escape does not capture audio.
**Start calibration** stops practice/replay, closes the instructions and explicitly
requests the selected microphone. Eight ordinary metronome clicks are scheduled on the
same AudioContext used to timestamp raw microphone frames. No drum playing is
required; use speakers so the microphone can hear the clicks.

Normalized waveform matching searches up to 500 ms after each scheduled click.
At least six clear matches must agree within 8 ms of the median. Missing audio,
unsupported processing, interruption or unreliable matches fail without replacing
a prior calibration. Successful completion reports the median audio loopback delay
and match spread, and saves only that measurement and microphone/sample-rate
identity locally. The bounded, roughly seven-second PCM buffer is discarded;
it never replaces the working take, enters the saved-bar library or uploads.

For subsequent browser live sessions with the same microphone and sample rate,
the measured delay replaces the browser-estimated output alignment correction.
It advances metronome output; it never shifts recorded attack timestamps, the
musical reference or scores. Device-change notifications clear the calibration.
Browsers cannot reliably identify every output-route or placement change: repeat
calibration after changing speakers, Bluetooth routes or microphone placement,
including changes made while the app was closed. Settings also offers Reset.
Native calibration is currently unsupported and reports that limitation rather
than manufacturing a measurement. Synthetic matching and UI tests are not
physical speaker/microphone accuracy validation.
