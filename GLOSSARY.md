# Forgettime

Forgettime helps drummers examine attacks and their timing against an intended musical reference. This vocabulary separates musical intent, audio evidence, detection and timing assessment.

## Language

### Strokes and detection

**Intended hit**:
A drum stroke the player or rendered pattern intends at a particular musical position. Simultaneous intended hits on different instruments can share one audible attack.
_Avoid_: Detection, candidate

**Attack**:
The audible beginning of a percussive event, potentially combining simultaneous strokes. Its onset can precede the loudest part of its sound.
_Avoid_: Energy peak

**Attack peak**:
The loudest part of an attack, which can arrive after its beginning. A later peak within the same kick does not by itself establish another attack.
_Avoid_: Onset

**Candidate**:
A possible attack considered for detection, with an accepted or rejected outcome. A candidate is evidence of a decision opportunity, not a confirmed intended hit.
_Avoid_: Hit, accepted detection

**Detected onset**:
An accepted estimate of when an attack began. It does not establish which instrument played, how many simultaneous strokes occurred, or whether the attack can receive a timing score.
_Avoid_: Intended hit, scored hit

**Detection marker**:
A visual indication of a detected onset at its source time. It represents an accepted attack estimate rather than each signal-level threshold crossing or a guaranteed timing score.
_Avoid_: Threshold crossing, scored hit

**Retrigger**:
An additional detected onset caused by the continuing body or decay of the same attack. Distinct intentional strokes close together, such as a flam, are a different case.
_Avoid_: Second stroke, flam

**Missing detection**:
A confirmed expected attack with no corresponding detected onset. An unoccupied musical position is not a miss when the pattern allows a rest.
_Avoid_: Missed beat

**Extra detection**:
A detected onset without a separate expected attack in a confirmed pattern. Calling a detection extra requires sufficient knowledge of the intended pattern.
_Avoid_: Bad timing

**Ghost note**:
An intentionally quiet stroke that remains part of the musical pattern. Low level alone does not make it unwanted noise.
_Avoid_: Background noise

### Musical reference and timing

**Musical grid**:
The reference beats and subdivisions defined by a tempo and beat-one origin. It represents the timing reference rather than a fit that follows the player's drift.

**Beat-one origin**:
The time assigned to the first beat of the musical reference. It can coincide with the start of an audio file, but those are separate facts.
_Avoid_: First sample, first detected hit as universal synonyms

**Source time**:
A position on the captured or imported audio's own timeline. It identifies the same audio event independently of when it is displayed or replayed.
_Avoid_: Display time, playback elapsed time

**Grid position**:
A location written as beat.sixteenth within a bar: `1.1` is beat one's first sixteenth and `2.3` is beat two's third sixteenth. A bar number distinguishes positions across multiple bars.
_Avoid_: Decimal seconds

**Timing error**:
The signed difference between a detected onset and its stated reference position: positive is late and negative is early. An offset from a rendered musical grid is distinct from an error against an independently measured audio onset.
_Avoid_: Device latency, attack-peak delay

**Scored hit**:
A detected onset with a sufficiently reliable musical interpretation to receive a timing error. A hit that establishes the reference and an ambiguous attack are not precise timing scores.
_Avoid_: Every detected onset

**Uncertain hit**:
A detected attack whose intended musical position or timing cannot be resolved reliably. Uncertainty is different from confidently early or late playing.
_Avoid_: Miss, extra detection, zero error

### Live input and replay

**Input gain**:
A multiplier applied to incoming microphone samples before live detection and retention. It affects future microphone audio only, never imported or previously retained audio.
_Avoid_: Detection sensitivity, waveform zoom

**Detection sensitivity**:
A user adjustment of attack detection for import previews and replay, used to investigate missed or extra detections. Higher settings favor quieter or less obvious attacks; the adjustment does not change live recording or constitute a single signal-level threshold.
_Avoid_: Input gain, minimum level, live sensitivity

**Waveform zoom**:
Magnification of the displayed audio in time or amplitude. It changes neither the audio samples nor the detection results.
_Avoid_: Input gain, detection sensitivity

**Live trigger**:
A detected onset accepted for the live performance's reference or timing assessment. Detector acceptance alone does not establish acceptance as a live trigger.
_Avoid_: Every candidate, every detected onset

**Minimum level**:
The detector's internal lower signal-level boundary. Passing Minimum level alone does not establish a clear onset; it is not the user-facing Detection sensitivity control.
_Avoid_: Start threshold

**Detector profile**:
A named set of onset-detection controls used for a comparison. It describes detection behavior rather than a musical pattern or microphone gain setting.

**Take**:
A continuous segment of captured or imported performance audio with its musical reference and original analysis where available. It may span several bars.
_Avoid_: Bar, replay run

**Bar**:
A musical measure within a take; Forgettime's current practice context uses four quarter-note beats. Available audio can cover all or only part of a bar.
_Avoid_: Take, arbitrary audio chunk

**Replay run**:
A fresh analysis of selected audio against its established musical reference and chosen detector settings, potentially spanning repeated playback. Its results are distinct from the take's original analysis.
_Avoid_: New take, original recording

**Original analysis**:
The detection results and settings associated with the source take when recorded or supplied. Unavailable original analysis is different from a known result containing no detections.
_Avoid_: Current replay results

**Current analysis**:
The results of the present replay run or offline comparison. It can differ from original analysis without changing the underlying performance or musical reference.
_Avoid_: Original analysis
