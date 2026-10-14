# Take review and replay

Forgettime keeps audio on your device. The microphone is off when the page/app opens. Reviewing or importing audio never enables it.

## Record and review

1. Set BPM and choose **Enable microphone** for one take, or **Auto** beside it for successive takes. The first reliable attack above Start sensitivity establishes beat 1. Tempo and phase remain fixed even if you drift.
2. A take ends after four beats of elapsed silence from the last accepted hit: 2 seconds at 120 BPM, 4 seconds at 60 BPM. Shorter rests preserve the take and beat clock. Single mode releases the microphone; Auto keeps listening for another take. **Stop listening** ends either mode immediately.
3. Use the waveform's previous/next controls to inspect the captured bars. Any review action releases the microphone and switches Auto off. Initial review selects the last complete played bar where available; later captured audio remains accessible even if the detector missed it. Partial bars show their missing coverage and cannot loop.
4. **Loop selected bar** plays the actual retained audio directly through the platform detector. The playhead, beat number, pendulum and meter follow playback. **Pause** preserves the selection. The microphone remains off, so room sound does not affect comparison.
5. Open **Detection details** to inspect accepted and rejected candidates. Rejected markers are optional, subdued and selectable; the paged list supports keyboard/touch access and explains decision values. A detector-accepted attack may still have uncertain rhythmic interpretation and no precise timing score.
6. Adjust Minimum level, Attack contrast, Minimum separation or Level recovery; commit with Enter or by leaving the field. A changed setting starts a fresh replay from the same selected samples. **Reset detector defaults** restores the known configuration. Start sensitivity remains a live-start setting, not a general replay sensitivity control.

Starting/resuming playback, changing bars or changing detector settings starts fresh analysis. Within a run, detector state continues through loop boundaries. BPM and the established grid never follow detections. A silent loop stays running; a changed first detection cannot move the grid. Original results/settings remain separate from current analysis. Compare equivalent run starts and loop numbers: joins and fresh detector state can legitimately differ from the original continuous take.

The latest unsaved take replaces the previous one when new playing starts. Unsaved audio is lost on reload/close. Capture is limited to 120 seconds including opening context; the limit stops capture visibly and preserves valid material. Missing input, backgrounding and interruptions end continuous recording rather than manufacturing samples. Actual phone behavior still needs the checks listed in [validation](recorded-workflow-validation.md).

## Save and import

**Save bar** persists only the selected bar and its original analysis as a complete WAV/`.forget` pair. The local saved-bars list survives app/page restart. Browser storage uses IndexedDB; native storage is private and excluded from backup. Export is explicit: browser entries provide separate matching WAV and `.forget` downloads; native entries open the system share/export chooser with both files. A requested download/share is not proof that a destination wrote it. Clearing browser/app storage or uninstalling can remove the local library, so export important bars.

**Import audio** opens a picker on every platform; desktop browsers also accept a drop. Select one WAV or M4A and, optionally, its `.forget` file. Select both explicitly: the app does not read an unselected neighboring file.

- A valid matching pair restores BPM, beat alignment, settings and originals without setup. The SHA-256 digest identifies the actual WAV bytes; matching names alone are insufficient.
- Ordinary audio requires **Confirm tempo and beat one**. Set its intended BPM, then place beat one using the source waveform, seconds field or keyboard arrows (one sample; Shift for 10 ms; Home/End). This is a one-time setup; replay then keeps that grid fixed.
- Invalid/mismatched metadata gets an explanation and an explicit **Use audio only** option. Ordinary imports have no invented original detection results. Replay supplies current analysis.
- Cancel, decode errors and unsupported formats preserve the previous review with the microphone off. Partial saved bars can be restored and inspected but remain non-loopable.

WAV supports signed PCM16/24/32 and Float32, including validated extensible formats, at 8–192 kHz with 1–8 channels. M4A support depends on the platform's installed codec. Channels are averaged to mono; opposite-phase channels can cancel. Browser compressed decoding can resample to its AudioContext rate; analysis and playback use the same returned decoded clock. Native compressed decoding retains the actual decoder sample rate. Failures never substitute silence or simulated hits.

Selected audio is limited to 64 MiB, decoded mono audio to 32 MiB and 120 seconds, and `.forget` metadata to 2 MiB. A local library holds at most 100 bars or 256 MiB. Exceeding limits fails visibly without silently evicting saved bars. Per-bar library deletion is not implemented. Candidate history is bounded to 2,048 events with a visible dropped count; missing diagnostics are distinct from a measured zero. See [bar file contract](bar-files.md) for exact interchange and storage rules.

## What the display can establish

Hit colours are captured strength (blue → purple → red → orange → yellow), not timing accuracy or calibrated loudness. Start sensitivity guides do not represent all adaptive detector thresholds. The timing meter still withholds precision for ambiguous attacks; drift, overlapping instruments, cymbal masking and flams remain difficult.

These tools make detector behavior inspectable and comparisons repeatable. They do not establish that the detector is accurate on your kit. Use headphones for metronome-assisted live practice: speaker clicks can be detected as hits. Browser/OS output clocks are estimates until measured against hardware. Live audio, replay and Simulation have distinct labels; simulation never activates the microphone.
