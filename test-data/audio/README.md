# Offline drum detection fixtures

Version-controlled WAVs for rendered-loop investigation and regression checks. Keep them outside `public/`, app imports and client bundles. Pushing the repository shares tracked fixtures; these commands analyze locally and never upload audio.

## Repeatable comparison

From the repository root, using a Node version supported by `package.json` (`.node-version` is the CI default):

```sh
pnpm audio:fixtures:check
pnpm audio:compare "beat 1 simple dyn 120.wav"
```

The comparator reads the fixture's declared BPM and origin and compares the current default and conservative (0.006 minimum RMS) profiles. It prints every accepted detection, extra and confirmed missing event in one table per run, using `beat.sixteenth` positions and signed milliseconds against the render grid. Start sensitivity and rhythm scoring are outside this onset comparison.

To investigate the separate first-sample startup limitation:

```sh
pnpm audio:compare "beat 1 simple dyn 120.wav" --assume-silence
```

This adds separately labelled experimental tables. The experiment feeds twelve synthetic silent analysis windows before sample zero, then analyzes the original samples with unchanged timestamps. It assumes prehistory; it is neither captured silence nor a production startup fix. Source code and WAV bytes remain unchanged. Historical source-patched experiments in the progress log are not this command's production baseline.

Complete JSON reports go to ignored `output/audio-validation/comparisons/`, recording the WAV and metadata, exact settings, Git HEAD, current source hashes, working-source change status, runtime, experiment assumptions and every detection. Source hashes identify uncommitted analysis code as well as committed code. Preserve the report associated with a finding.

## Adding or replacing a fixture

Preserve the supplied WAV bytes and create a same-stem `.metadata.json` before analysis. See [the dynamic-hat fixture](beat%201%20simple%20dyn%20120.metadata.json) for the current declaration shape; validation is defined in `scripts/lib/audio-fixtures.ts`.

Record checksum, format, decoded duration, confirmed BPM, provenance and pattern status. Expected positions are musical event times on the WAV clock, not detector output or independently measured acoustic attacks. Mark partial/unknown patterns explicitly; unknown patterns have no invented expected list. Record a confirmed, assumed or unknown render origin. Incomplete pattern knowledge does not turn every unmatched detection into an extra.

The validator rejects missing/orphan sidecars, changed checksums, wrong filenames, format/duration mismatches, unsupported tempo declarations, inconsistent origins, and duplicate/off-grid/out-of-file expected positions. An accidentally shortened export fails the existing checksum/duration declaration or its expected-position bounds. On deliberate replacement, review the change and update metadata/provenance; never silently regenerate expectations from detections. Retain prior revision metadata when available and use a new filename when earlier audio must remain reproducible.

The decoder in `scripts/lib/wav.ts` defines supported formats. It averages channels to mono, so stereo phase cancellation can affect detection. Keep independently reviewed acoustic attack annotations in separate `.annotations.json` sidecars and use `scripts/validate-audio.ts` for annotated acoustic-onset comparisons; the musical grid alone does not establish precision/recall.

## Regression checks and continuity

`pnpm test` includes fixture/report tests and a sensitivity matrix covering the supplied ordinary/quiet-hat loops, extras and missing hits, close attacks, soft follow-ups and ambient noise under both profiles. `pnpm audio:fixtures:check` also runs in application CI. `pnpm audio:parity` compiles the standalone Java/Swift detectors and compares them against TypeScript, including both supplied loops and sensitivity profiles; a separate macOS CI job runs it. These checks do not establish native-app builds or physical-device accuracy.

The authoritative current state and next action are at the top of [progress.md](progress.md), with historical rounds below. The project skill is `.agents/skills/refine-drum-detection/SKILL.md` (`$refine-drum-detection`). No old-worktree recordings have been copied into this corpus.
