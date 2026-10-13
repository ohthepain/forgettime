# Audio timing and validation

## What is implemented

The timing engine consumes transient timestamps in seconds on the **captured audio sample clock**. UI callback arrival times are never timing measurements. The shared `OnsetDetector` analyzes mono PCM in approximately 2.7 ms windows, detects envelope rises, and timestamps an attack inside its window. Its `processedThrough` watermark advances only after complete windows, so a buffered attack immediately before the full-bar timeout cannot be lost by advancing the clock prematurely. An adaptive background threshold, 18 ms refractory interval, and envelope rearming suppress repeated triggers from a decaying signal. They do not separate individual instruments or eliminate every false positive.

After activation, listening starts automatically. The first reliable captured transient that passes **Start sensitivity** sets beat 1 immediately, at its captured timestamp. There is no multi-hit acquisition or median phase correction. The anchor itself gets no timing score, since it defines zero. Once started, both selected BPM and phase remain unchanged until a tempo/interpretation change, stop, interruption, or automatic pause.

The settings panel contains only Start sensitivity, persisted locally with a default of 50%. Higher values permit softer starting hits. Its normalized peak-amplitude threshold is `0.5 * 0.04^(sensitivity / 100)`: 0% requires 0.5, 50% requires 0.1, and 100% requires 0.02. The onset must first pass the shared transient/noise detector and have confidence of at least 0.55. These are signal-relative values, not calibrated sound-pressure levels. The gate applies while listening or paused, never during an active performance. Changing sensitivity applies to the next start without resetting the clock. Rejected starting candidates do not affect the phase or silence timer.

**A microphone cannot determine the intended downbeat from an arbitrary syncopated opening.** Play the starting hit on your intended beat 1. A loud accidental transient can still start a measure; lower Start sensitivity if that happens. This is not an external metronome synchronization feature.

The beat counter follows that clock, independently of attack count. It remains active through silence shorter than four beats. Only elapsed time since the last detected attack can trigger automatic pause: 2 seconds at 120 BPM, 4 seconds at 60 BPM. At timeout the reference is cleared; the next attacks establish a fresh reference. A false transient can delay timeout; undetected ghost notes can make it occur early.

## Subdivisions and display

Auto considers quarters, eighths, sixteenths, triplets and sextuplets. Straight excludes triplet subdivisions. Swing/triplet considers quarters, triplets and sextuplets; it does **not** fit an arbitrary swing ratio. A short context of prior attacks plus a 240 ms lookahead is evaluated together. Missing grid positions are permitted. Switching to a finer grid requires evidence in attack spacing, rather than merely a smaller absolute timing error; progressive quarter-note lateness therefore does not by itself manufacture an accurate sixteenth-note score.

There is no score for weak attacks, attacks separated by less than 45 ms (possible flams/rolls), conflicting interpretations with materially different answers, or attacks too far between supported grid positions. These appear as uncertain. Very close attacks under the detector's 18 ms refractory interval may merge into one transient. Deliberate attacks faster than this are outside the present detector's reliable range.

Resolved line positions are immutable. Each line has a one-second display lifetime beginning when its resolved interpretation is presented; new lines normally appear in attack order on successive capture frames and start fully opaque. A 240 ms interpretation lookahead precedes that lifetime. Opacity then falls linearly to zero over exactly one second. A presentation queue keeps mounted marks until their CSS animation ends, even when delayed capture frames expire the underlying engine snapshot sooner. Normal native/web frame delivery is approximately 20 ms; delayed callback batches may cause multiple older attacks to be presented together. Visual scheduling depends on the renderer and does not change measured audio timestamps.

Large drift can become indistinguishable from an intentional subdivision or beat shift. The engine does not claim to recover a player's musical intention from audio alone. Its short-sequence grid heuristic is an initial implementation, not a trained drum transcription model. Fast subdivision changes, masking, room reflections, distant microphones, Bluetooth routing, automatic gain control, and acoustic bleed can reduce accuracy.

## Automated evidence

Run:

```sh
pnpm exec vitest run src/audio/engine.test.ts src/audio/onset-detector.test.ts
```

The engine tests verify immediate beat-one anchoring, start sensitivity at its endpoints/default, ignored weaker starts, sensitivity changes during a performance, fixed BPM and phase under progressive +10 to +60 ms quarter-note drift, sixteenth fills with missing notes, triplet interpretation, consistent pattern choice, uncertainty for flams and weak attacks, beat count during silence, exact full-bar timeouts at 60/120/240 BPM, resuming before and after timeout, immutable positions, and one-second opacity.

Detector tests use deterministic **synthetic PCM**, including steady impulses, quieter attacks, closely spaced flam attacks, and decaying noisy cymbal-like signals. They verify detection timestamps and invariance to buffer size and clock origin. These are algorithm regression fixtures, **not representative acoustic drum recordings**, and do not establish real-world precision, recall or cross-platform accuracy.

## Validate real recordings

A first user-supplied non-drum recording was tested at 110 BPM; it exposed substantial candidate retriggering/noise sensitivity. See [the exploratory report](recording-tests/2026-10-13-non-drum.md). No representative drum recordings have been supplied yet. Acoustic-kit, electronic-kit speaker, ghost-note, flam/roll, fill, and cymbal-heavy recording validation is still outstanding. No microphone-device or latency accuracy result is claimed by these synthetic tests.

A read-only runner is available for a PCM16 or float32 WAV (including macOS extensible WAV). Without independent annotations, use `node --import tsx scripts/validate-audio.ts recording.wav --bpm 110`; this reports candidates and state transitions with accuracy metrics left null. For precision and recall, supply human-verified annotations. Mono is preferred; multichannel files are averaged and can suffer phase cancellation. Use recordings without a metronome bleeding into the microphone, or explicitly annotate that contamination.

```json
{
  "description": "Acoustic kit, sixteenth fill and cymbal decay, phone 1 m away",
  "bpm": 120,
  "mode": "auto",
  "toleranceMs": 20,
  "onsets": [0.12, 0.62, 1.12, 1.62, 2.12, 2.62, 3.12, 3.245]
}
```

```sh
pnpm exec tsx scripts/validate-audio.ts recording.wav annotations.json > report.json
```

The report includes one-to-one matched onset precision/recall, median/max absolute onset error, missing/extra attacks, and each resolved rhythmic interpretation. The 20 ms default is a matching tolerance, **not** an accuracy claim. Human annotation must distinguish the principal flam attack from grace notes and mark uncertain intentions separately. Onset precision/recall does not prove that inferred rhythmic intention is correct.

Before a release, collect and annotate at least:

| Recording | Required check |
| --- | --- |
| Quarter/eighth grooves at 60, 120, 180 BPM | Repeatable phase lock; signed errors vs known reference |
| Deliberately drifting groove | Reference never follows player drift; errors remain honest |
| Sixteenth/triplet fills with omitted notes | Coherent interpretation, no false precision at changes |
| Ghost notes under kick/snare and cymbals | Missed-attack rate and uncertainty behavior |
| Flams, drags, press rolls | No invented precise scores for merged/ambiguous attacks |
| Open hi-hat and crash decay | No false attacks extending the last-hit timeout |
| Silence just below and exactly at a full bar | Session preservation vs fresh reference after restart |

Repeat on actual Android and iOS hardware, including permission denial, interruption, foreground/background transitions, route changes, sample-rate changes, and wired/Bluetooth inputs. Verify sample-clock continuity, hardware timestamp availability and fallback behavior from capture diagnostics. Measure onset timestamp bias against a loopback/reference recording; elapsed time at a UI callback is not a suitable calibration method. An external metronome heard by the microphone may be detected as drum hits and should not be used as an unisolated reference.
