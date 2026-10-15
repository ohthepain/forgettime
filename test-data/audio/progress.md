# Drum detection progress

## Agreed workflow

User renders WAV loops in Ableton. Analyze offline, show detection results, and collect written feedback. Keep fixtures in this version-controlled folder for regressions. Accept new goals anytime. Detector edits and local checks are authorized within the active goal.

Default tempo: 100 BPM, explicitly supplied to the analyzer. For app comparisons the user sets the same tempo; the first qualifying attack anchors the reference.

## Goals

| Goal | Status | Completion evidence |
| --- | --- | --- |
| Isolated quarter-note kick | Provisionally accepted by user | User accepts startup-bypass probe for now, including possible oversensitivity. Production gate remains unchanged because of noise regressions. |
| Isolated snare | Awaiting feedback | Four experimental candidates, no duplicates; baseline recorded. |
| Isolated closed hi-hat | Provisionally accepted by user | User confirmed four-hit pattern and accepted results; production still has startup gate. |
| Isolated open hi-hat, ride and crash | Awaiting feedback | Four experimental candidates each, no duplicates; crash fails default start gate. |
| Vary speed/velocity, combine instruments and grooves | Pending | Define cases and criteria as the user progresses. |
| Ghost notes, flams, rolls and fills | Pending | Define attack and uncertainty expectations per case. |

## Next round

Review closed hi-hat results with the user. Startup/noise tradeoff and kick retrigger remain deferred technical issues; provisionally accepting the kick example does not mean those are fixed in production.

Update: closed hi-hat accepted. Await feedback on snare/open hi-hat/ride/crash batch below.

## Round 1: kick 100 1 bar.wav

User feedback: "ki have added kick 100 1 bar.wav".

Analyzed original stereo 44.1 kHz WAV (2.4 seconds) at 100 BPM, auto mode, Start sensitivity 50. Full baseline: `output/audio-validation/kick-100-1-bar/baseline.json`. Provenance and checksum are in the fixture's metadata sidecar.

Four candidates: 0.601406, 1.201837, 1.220227 and 1.801837 seconds. The two middle candidates are only 18.390 ms apart. Reference acquisition occurs at the 1.201837-second candidate; the 0.601406-second candidate does not pass the starting amplitude threshold. One later hit is scored, and one is uncertain (possible flam/roll). No full-bar silence exists after the last candidate, so pause cannot be evaluated.

If the intended pattern is four quarter-note kicks at 0, 0.6, 1.2 and 1.8 seconds, results suggest a missed opening kick and a duplicate around the third kick. That pattern and attack times are provisional, not verified annotations. Four candidates alone is not evidence of correct detection.

Await written confirmation of the rendered pattern and user feedback on these results. No detector code changed.

## Round 1 correction: actual kick replacement

User feedback: "i can see that the first kick begins pretty much on the first sample. but the sample contained a stick sound not a kick. now it contains a kick, 4 hits, quantized exactly to the beat,"

The file checksum changed; metadata retains the earlier checksum and stick-sound baseline reference. The old audio bytes were replaced by the user and are not retained here. Current WAV is stereo 44.1 kHz, 1.95 seconds. Intended musical grid is user-confirmed at approximately 0, 0.6, 1.2 and 1.8 seconds; these are not independent acoustic attack annotations.

Replacement baseline at 100 BPM / auto / sensitivity 50 again detects 0.601406, 1.201837, 1.220227 and 1.801837 seconds. Opening kick is missing; third kick produces two candidates 18.390 ms apart. First candidate is below the start threshold, so reference anchors at 1.201837 seconds. File lacks sufficient trailing silence to check pause. Report: `output/audio-validation/kick-100-1-bar/kick-replacement.json`.

Source inspection confirms the detector deliberately suppresses detections until 12 analysis windows (~32 ms) establish background energy, explaining why a first-sample attack is excluded initially. Exact later decay behavior needs further investigation. No detector code changed.

## Startup assumption probe

User clarified that incoming signal can be assumed normalized, while quieter kits must still be detected, and requested another kick-loop trial. Temporarily removing the startup-history gate finds the opening attack at 0.001474 seconds. Remaining candidates are 0.601406, 1.201837, 1.220227 and 1.801837: all four intended beats represented, but third-kick retrigger remains. The first candidate's peak strength (0.094986) is still below default Start sensitivity's 0.1 threshold, so reference still starts at 1.201837 seconds. Detection and start acquisition are distinct problems.

The probe causes seven existing ambient-noise regressions. Restored the original detector exactly; all 27 detector tests pass again. Experimental report retained in `output/audio-validation/kick-100-1-bar/startup-probe.json`. This is a diagnostic result, not an accepted implementation or native parity claim. Quiet baseline probes are recorded separately in `quiet-baseline.json`; gain reductions do not modify the original WAV.

## Round 2: closed hi-hat

User feedback: "it looks good. the peak energy of the kick isn't until 0.01 seconds into the sample so i think these results are find. it may even be too sensitive, but let's give pass it for now. we can move onto the closed hihat loop hhc 100 1 bar".

Kick probe provisionally accepted for workflow progression; no production change was retained. User notes kick peak occurs about 10 ms into the sample; peak timing is distinct from attack onset.

Closed hi-hat WAV: 44.1 kHz stereo, 1.95 seconds. At 100 BPM / auto / sensitivity 50, unchanged detector finds candidates at 0.601315, 1.201315 and 1.801315 seconds, with no close duplicate candidates; reference anchors at 0.601315 seconds. Initial attack is excluded by startup history. Experimental gate-bypass results are saved separately, using an output-only copy of the detector, without changing production source. Full reports: `output/audio-validation/hhc-100-1-bar/`. Exact intended pattern remains to be confirmed; quarter-note grid is provisional. No full-bar trailing silence, so pause is not evaluated.

## Round 3: instrument batch

User confirmed the closed hi-hat pattern/results and requested remaining supplied files. Analyzed all six originals for a consistent comparison at 100 BPM, auto, sensitivity 50, preserving production code. Experimental detector copy bypasses only startup history. Musical grid expectations are four quarter notes; acoustic onset annotations remain separate and unverified.

| Instrument | Production candidates | Experimental candidates (seconds) | Observation |
| --- | --- | --- | --- |
| Kick | 4 | 0.001474, 0.601406, 1.201837, 1.220227, 1.801837 | Known third-kick retrigger; prior provisional acceptance retained. |
| Closed hi-hat | 3 | 0.001315, 0.601315, 1.201315, 1.801315 | User accepted. |
| Snare | 3 | 0.000590, 0.600590, 1.200590, 1.800590 | Four experimental attacks, no duplicates. |
| Open hi-hat | 3 | 0.000816, 0.600771, 1.200771, 1.800816 | Four experimental attacks, no duplicates. |
| Ride | 3 | 0.000680, 0.601678, 1.201678, 1.801678 | Four experimental attacks, no duplicates. |
| Crash | 3 | 0.001156, 0.602154, 1.202154, 1.802154 | Four experimental attacks, no duplicates; strengths 0.0916–0.0973 do not pass default start threshold 0.1. Production never acquires reference. |

Reports and summary: `output/audio-validation/instrument-baselines/`. Fixture metadata contains hashes and reproduction paths. All files stereo 44.1 kHz; snare is 2.4 seconds, others 1.95 seconds. None supports a full-bar trailing-silence check. No detector changes retained; experimental findings are not native-device validation. Await user feedback before moving to combinations or quieter cases.

## Scope clarification: Start sensitivity

User feedback: "i think we can ignore start sensitivity, that's a separate issue. we don't expect quiet cymbal taps to start the recording".

For this offline loop, judge onset detection independently of reference acquisition. A quiet cymbal attack can be a successful detection while correctly failing Start sensitivity; lack of reference acquisition is not a failure of the active detection goal. Leave Start sensitivity unchanged and defer its evaluation unless the user requests it. Continue showing detected attacks without requiring acquisition or numeric rhythm scores. This does not resolve the separate startup-history gate or kick retrigger.

## Round 4: kick, snare and hat at 120 BPM

User supplied `kick snare hat 120 1 bar.wav` and confirmed 120 BPM. Original stereo 44.1 kHz WAV is 2 seconds. Exact instrument placements and simultaneous attacks are not yet confirmed; do not infer separate instrument detection from combined transients.

Unchanged detector: seven candidates, beginning at 0.252313 seconds. Experimental startup bypass: eight at 0.001315, 0.252313, 0.500590, 0.752313, 1.001837, 1.252313, 1.500590 and 1.752313 seconds. These lie 0.590–2.313 ms after the provisional eighth-note grid (250 ms spacing). No closely spaced duplicate candidates. If the intended pattern has attacks at every eighth note, experimental count and timing match that structure; await user confirmation. Start sensitivity excluded from assessment. No trailing full-bar silence for pause evaluation.

Reports: `output/audio-validation/kick-snare-hat-120/`. Metadata and checksum saved beside fixture. Production detector unchanged. Current next step: written feedback on the combined pattern before declaring success or adding complexity.

User confirmed hi-hat eighth notes, kick/snare quarter notes, all quantized. Exact kick/snare allocation is unspecified. User requested positions as beat.sixteenth (`1.1` = beat 1, first sixteenth; `2.3` = beat 2, third sixteenth), plus per-candidate timing error. Use render sample zero as this fixture's beat-1 grid origin; retain sample-clock timestamps. Positive grid error means late. This diagnostic is independent of Start sensitivity, first-hit anchoring and the engine's interpretation.

Experimental results: 1.1 +1.315 ms; 1.3 +2.313 ms; 2.1 +0.590 ms; 2.3 +2.313 ms; 3.1 +1.837 ms; 3.3 +2.313 ms; 4.1 +0.590 ms; 4.3 +2.313 ms. Full precision in `output/audio-validation/kick-snare-hat-120/grid-results.json`. Skill updated to use this presentation for later takes. Production remains unchanged.

## Round 5: sixteenth-note render

User requested `kick snare hat 16ths 120 1 bar.wav`. Actual decoded duration is 0.124989 seconds (5512 frames at 44.1 kHz): one sixteenth at 120 BPM, not one 2-second bar. Unchanged detector finds zero candidates; experimental startup bypass finds one at 0.001315 seconds, provisional position 1.1 with +1.315 ms error against file-zero grid. Cannot assess the intended full-bar pattern from this short render. Ask user to export full 2-second bar before proceeding. File preserved unchanged; hash/metadata beside source and reports in `output/audio-validation/kick-snare-hat-16ths-120/`. Production unchanged.

### Replacement render

User replaced the WAV and requested a retry. Duration now 2 seconds. Production finds 9 candidates; startup-bypass experiment finds 10, at positions 1.1 (+1.315 ms), 1.2 (+2.324 ms), 1.3 (+2.313 ms), 2.1 (+0.590 ms), 2.3 (+2.313 ms), 3.1 (+1.837 ms), 3.3 (+2.313 ms), 4.1 (+0.590 ms), 4.3 (+2.313 ms), 4.4 (+2.324 ms). No close duplicate candidates. Grid assumes file-zero beat 1, consistent with prior renders. Exact expected pattern remains unconfirmed; do not call the six unoccupied sixteenth positions misses without confirmation. Ask whether extra sixteenths were intended only at 1.2 and 4.4 or throughout the bar. Metadata retains prior short-render hash; reports saved as replacement-baseline.json and replacement-probe.json in the same output folder. Production unchanged.
