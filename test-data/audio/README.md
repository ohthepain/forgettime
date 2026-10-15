# Offline drum detection fixtures

Version-controlled WAV fixtures for Ableton renders, offline detection, written feedback and regression checks. Files stay outside `public/` and must not be served, imported into the app or bundled for clients. Tracked fixtures are shared when the repository is pushed.

Preserve supplied WAV bytes. Use descriptive names such as `kick-quarter-100bpm-01.wav`. Keep a `.metadata.json` beside each fixture with provenance, SHA-256, confirmed BPM, intended pattern, render offset, velocity/effects and limitations. Mark unknowns. Add `.annotations.json` for independently established onset expectations; distinguish intended grid positions from measured audio attacks.

The current decoder supports PCM16 or float32 RIFF/WAVE, 1–8 channels, sample rates of at least 8 kHz. It averages channels to mono, so stereo phase cancellation can affect results. Preserve sources and document separately derived conversions.

Exploratory analysis from the repository root:

```sh
node --import tsx scripts/validate-audio.ts test-data/audio/FILE.wav --bpm 100
```

With confirmed attack annotations:

```sh
node --import tsx scripts/validate-audio.ts test-data/audio/FILE.wav test-data/audio/FILE.annotations.json
```

Annotation fields: `description`, `bpm`, `onsets` in WAV-clock seconds, optional `mode` (`auto`, `straight`, `swing`), optional `toleranceMs` (default 20). Choose tolerance according to the goal and annotation uncertainty before judging results.

Full generated reports belong in ignored `output/audio-validation/`. Keep concise findings in [progress.md](progress.md). Invoke the project skill with `$refine-drum-detection`; its source is `.agents/skills/refine-drum-detection/SKILL.md`.

No files have been copied from the old `bar-review-integration` worktree. Its reference recording has unconfirmed tempo/attacks and is not implicitly a benchmark for these renders.
