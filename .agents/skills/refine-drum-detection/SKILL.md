---
name: refine-drum-detection
description: Analyze WAV loops for Forgettime drum detection, collect written feedback, and refine detection with regression checks. Use when reviewing a rendered loop or resuming or adding goals to this workflow.
---

# Refine drum detection

The user renders loops. Analyze WAVs offline and show detection results, then refine detection using written feedback. Follow current AGENTS.md and audio validation docs. Preserve unrelated working-tree changes.

## Resume and choose a goal

Read `test-data/audio/progress.md` for the active goal, latest feedback and retained implementation state. Read `test-data/audio/README.md` for fixture handling and analyzer usage. Inspect the current analyzer and decoder before use. Add goals whenever requested, preserving priorities and giving each an observable completion criterion and status: pending, active, provisionally accepted, validated or deferred. User acceptance of an experimental result does not mean its code was retained or validated. Continue from the latest round rather than restarting the original curriculum.

Suggest progression through isolated instruments, varying speeds/levels, instrument pairs, grooves, ghost notes, flams, rolls and fills; follow the user's priority. Instrument classification requires a separate goal.

## Round

1. Use the supplied loop and confirmed BPM. If a new render is needed, give one concrete instruction tied to the active goal. Confirm decoded duration against the intended pattern. Preserve first-sample attacks as boundary cases; adding silence must not hide startup failure. Treat normalized input as a usable-level starting assumption, not a required peak amplitude. Quieter signals remain part of the goal.
2. Preserve the original bytes and metadata using the fixture README. On replacement, record the changed checksum and revision history; retain prior reports without implying overwritten audio remains available. Mark unknowns explicitly.
3. Run the existing analyzer at the confirmed BPM using the fixture README. Save full reports in ignored `output/audio-validation/`. Report actual BPM and mode. App settings do not configure the offline analyzer. Measurements use WAV sample timestamps. Compare experiments separately from the baseline, naming the exact change and whether it exists only in an output copy or is retained in production.

   The current goal evaluates onset detection independently of Start sensitivity/reference acquisition. Quiet cymbal taps are not expected to start the reference. Leave Start sensitivity unchanged; lack of acquisition is not an onset-detection failure. Investigate that gate only as a separately requested goal. The detector's startup-history gate remains a distinct detection issue.

4. Show candidate count, confirmed intended count if available, and the result table below. Separate candidates, scored hits and uncertain interpretations. For long files, summarize and link the full report; add a static waveform when it clarifies a discrepancy.

   For quantized renders, show each candidate's musical position as `beat.sixteenth`: `1.1` is beat 1's first sixteenth, `2.3` is beat 2's third sixteenth. Add a bar column for multi-bar files. At BPM B, one sixteenth is `60 / B / 4` seconds. Use the confirmed render-grid origin, not the first detected attack, for these diagnostics; if unknown, ask or label any assumed origin. For each candidate show detected WAV time and signed timing error in ms against its expected grid position (positive = late, negative = early). Keep every candidate, including duplicates; show missing expected events when confirmed. Nearest-grid assignment is provisional when intended position is unknown, and is separate from the engine's rhythm interpretation. A sample's onset estimate can precede its energy peak; grid error is not sample peak timing or calibrated hardware latency.

5. Ask for ordinary written feedback: what was rendered, what looks wrong, and the next priority. Preserve the user's words separately from the agent's interpretation. Accept corrections without requiring an annotation format.
6. When evidence supports a detector change within the agreed goal, retain the baseline, make a focused edit, rerun the current and earlier regression fixtures, and show before/after results. Such edits and local checks are authorized. Ask when intent is ambiguous or the goal would change. Investigate regressions rather than optimizing one file at their expense.
7. Update `progress.md` with feedback, evidence, changes, checks, uncertainty, retained code state and one next action. End with results awaiting feedback or one rendering instruction. Advance when the user accepts the result; reserve validated status for met completion criteria and checks, with remaining caveats explicit.

## Evidence

Keep annotations separate from detector output. Read the analyzer's current schema before writing annotation sidecars; usage is documented in the fixture README.

Ableton grid/MIDI positions establish intended events, not independently measured sample attacks. Padding and envelopes can shift acoustic onsets. Label grid-derived expectations in metadata. Establish measured attack annotations through independent inspection and user confirmation where ambiguous. Never use detected timestamps as their own ground truth. Report accuracy/precision/recall only against credible independent annotations; keep unannotated results exploratory. Simultaneous instruments may form one combined transient; agree on expectations before counting them as separate attacks.

Preserve prior annotations and baselines. Add repeatable regression checks for demonstrated failures when justified. Report missing hits, extras and timing errors separately; fewer candidates alone is not an improvement. Rendered WAVs establish offline behavior, not physical-device or acoustic-kit accuracy.

Verify pause only when actual WAV samples extend at least `240 / BPM` seconds beyond the last detected hit. Artificial lookahead draining is not observed silence.

For detector edits run relevant detector, sample-clock and silence tests and TypeScript/Java/Swift parity per repository guidance. Preserve port parity. Report unavailable tooling and distinguish source checks from native builds; reinstall and sync the local plugin before claiming updated native code compiled. This workflow adds no live recording, upload, background capture or automatic tempo tracking.

## Files

Follow the fixture README for version-controlled WAVs and sidecars; keep generated reports in ignored output. Live recording, uploads, publishing, commits and unrelated feature changes require separate requests.
