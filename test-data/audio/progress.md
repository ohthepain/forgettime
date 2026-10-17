# Drum detection progress

## Current state — authoritative

Read this section to resume. Historical rounds below preserve past experiments and user feedback; their old goals and next-step instructions are not current instructions.

- **Retained live detector:** default minimum RMS 0.002; conservative comparison profile 0.006. Smoothed 10 ms envelope rearming, per-attack peak reset, capped adaptive level gate, 4× disarmed rise override. Quiet attacks still pass rise/contrast checks. Live capture remains energy-only. Review now offers experimental frequency-band growth evidence and an Energy/Frequency change balance, default 100% frequency change for import/replay. No instrument classifier or source amplification.
- **Current goal:** evaluate the user-requested frequency-change detector and review balance against confirmed extra detections while preserving quiet attacks, close follow-ups and fixed timing. The control and three-platform implementation are retained experimentally. Ordinary and dynamic simple loops preserve eight groups across ten sample alignments at 25/50/100% balance when startup is isolated. A current failing acoustic example has not yet been identified.
- **Provisionally accepted:** isolated instrument and combined-loop onset results; every detection must stay in the table. Exact intent in the sixteenth-note combination remains unconfirmed, so its ten candidates are not a complete accuracy benchmark.
- **Known limitations:** production still suppresses the opening ~32 ms. Live capture uses shared defaults; review sensitivity and balance never tune live detection. Render-grid origin is explicitly marked assumed where not confirmed; grid timing is not measured acoustic-onset accuracy. Native apps/devices remain unverified. The lower floor accepts more clear faint transients; the conservative profile preserves higher-level rejection behavior and misses two or three hats in the dynamic fixture depending on sample alignment.
- **Reproducible tooling:** `pnpm audio:fixtures:check`, then `pnpm audio:compare "beat 1 simple dyn 120.wav"`. Add `--assume-silence` only for separately labelled assumed-prehistory experiments. Current source hashes, fixture hash, settings and all detections are saved with each report. Never text-patch source for report generation.
- **Validation:** 353 tests passed with all native-host suites enabled; app/tools typecheck and production build passed. Fixture checksums/metadata validated. Extended Java/Swift/TypeScript parity passed at 0/50/100% balance and both profiles. Supplied loops retain eight groups over ten alignments at 25/50/100%. Browser import/replay, restart recovery and 393 px popup layout checked. Native app builds, physical-device behavior and current acoustic failure remain unverified.
- **Next action:** review the retained latest performance with the user and identify an audible single attack followed by an extra detection. Compare energy, mixed and frequency-only modes on that evidence; preserve current source WAVs and distinguish review experiments from live defaults.

## Historical rounds

### Agreed workflow

User renders WAV loops in Ableton. Analyze offline, show detection results, and collect written feedback. Keep fixtures in this version-controlled folder for regressions. Accept new goals anytime. Detector edits and local checks are authorized within the active goal.

Default tempo: 100 BPM, explicitly supplied to the analyzer. For app comparisons the user sets the same tempo; the first qualifying attack anchors the reference.

### Goals

| Goal | Status | Completion evidence |
| --- | --- | --- |
| Isolated quarter-note kick | Provisionally accepted by user | User accepts startup-bypass probe for now, including possible oversensitivity. Production gate remains unchanged because of noise regressions. |
| Isolated snare | Awaiting feedback | Four experimental candidates, no duplicates; baseline recorded. |
| Isolated closed hi-hat | Provisionally accepted by user | User confirmed four-hit pattern and accepted results; production still has startup gate. |
| Isolated open hi-hat, ride and crash | Awaiting feedback | Four experimental candidates each, no duplicates; crash fails default start gate. |
| Vary speed/velocity, combine instruments and grooves | Pending | Define cases and criteria as the user progresses. |
| Ghost notes, flams, rolls and fills | Pending | Define attack and uncertainty expectations per case. |

### Next round

Review closed hi-hat results with the user. Startup/noise tradeoff and kick retrigger remain deferred technical issues; provisionally accepting the kick example does not mean those are fixed in production.

Update: closed hi-hat accepted. Await feedback on snare/open hi-hat/ride/crash batch below.

### Round 1: kick 100 1 bar.wav

User feedback: "ki have added kick 100 1 bar.wav".

Analyzed original stereo 44.1 kHz WAV (2.4 seconds) at 100 BPM, auto mode, Start sensitivity 50. Full baseline: `output/audio-validation/kick-100-1-bar/baseline.json`. Provenance and checksum are in the fixture's metadata sidecar.

Four candidates: 0.601406, 1.201837, 1.220227 and 1.801837 seconds. The two middle candidates are only 18.390 ms apart. Reference acquisition occurs at the 1.201837-second candidate; the 0.601406-second candidate does not pass the starting amplitude threshold. One later hit is scored, and one is uncertain (possible flam/roll). No full-bar silence exists after the last candidate, so pause cannot be evaluated.

If the intended pattern is four quarter-note kicks at 0, 0.6, 1.2 and 1.8 seconds, results suggest a missed opening kick and a duplicate around the third kick. That pattern and attack times are provisional, not verified annotations. Four candidates alone is not evidence of correct detection.

Await written confirmation of the rendered pattern and user feedback on these results. No detector code changed.

### Round 1 correction: actual kick replacement

User feedback: "i can see that the first kick begins pretty much on the first sample. but the sample contained a stick sound not a kick. now it contains a kick, 4 hits, quantized exactly to the beat,"

The file checksum changed; metadata retains the earlier checksum and stick-sound baseline reference. The old audio bytes were replaced by the user and are not retained here. Current WAV is stereo 44.1 kHz, 1.95 seconds. Intended musical grid is user-confirmed at approximately 0, 0.6, 1.2 and 1.8 seconds; these are not independent acoustic attack annotations.

Replacement baseline at 100 BPM / auto / sensitivity 50 again detects 0.601406, 1.201837, 1.220227 and 1.801837 seconds. Opening kick is missing; third kick produces two candidates 18.390 ms apart. First candidate is below the start threshold, so reference anchors at 1.201837 seconds. File lacks sufficient trailing silence to check pause. Report: `output/audio-validation/kick-100-1-bar/kick-replacement.json`.

Source inspection confirms the detector deliberately suppresses detections until 12 analysis windows (~32 ms) establish background energy, explaining why a first-sample attack is excluded initially. Exact later decay behavior needs further investigation. No detector code changed.

### Startup assumption probe

User clarified that incoming signal can be assumed normalized, while quieter kits must still be detected, and requested another kick-loop trial. Temporarily removing the startup-history gate finds the opening attack at 0.001474 seconds. Remaining candidates are 0.601406, 1.201837, 1.220227 and 1.801837: all four intended beats represented, but third-kick retrigger remains. The first candidate's peak strength (0.094986) is still below default Start sensitivity's 0.1 threshold, so reference still starts at 1.201837 seconds. Detection and start acquisition are distinct problems.

The probe causes seven existing ambient-noise regressions. Restored the original detector exactly; all 27 detector tests pass again. Experimental report retained in `output/audio-validation/kick-100-1-bar/startup-probe.json`. This is a diagnostic result, not an accepted implementation or native parity claim. Quiet baseline probes are recorded separately in `quiet-baseline.json`; gain reductions do not modify the original WAV.

### Round 2: closed hi-hat

User feedback: "it looks good. the peak energy of the kick isn't until 0.01 seconds into the sample so i think these results are find. it may even be too sensitive, but let's give pass it for now. we can move onto the closed hihat loop hhc 100 1 bar".

Kick probe provisionally accepted for workflow progression; no production change was retained. User notes kick peak occurs about 10 ms into the sample; peak timing is distinct from attack onset.

Closed hi-hat WAV: 44.1 kHz stereo, 1.95 seconds. At 100 BPM / auto / sensitivity 50, unchanged detector finds candidates at 0.601315, 1.201315 and 1.801315 seconds, with no close duplicate candidates; reference anchors at 0.601315 seconds. Initial attack is excluded by startup history. Experimental gate-bypass results are saved separately, using an output-only copy of the detector, without changing production source. Full reports: `output/audio-validation/hhc-100-1-bar/`. Exact intended pattern remains to be confirmed; quarter-note grid is provisional. No full-bar trailing silence, so pause is not evaluated.

### Round 3: instrument batch

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

### Scope clarification: Start sensitivity

User feedback: "i think we can ignore start sensitivity, that's a separate issue. we don't expect quiet cymbal taps to start the recording".

For this offline loop, judge onset detection independently of reference acquisition. A quiet cymbal attack can be a successful detection while correctly failing Start sensitivity; lack of reference acquisition is not a failure of the active detection goal. Leave Start sensitivity unchanged and defer its evaluation unless the user requests it. Continue showing detected attacks without requiring acquisition or numeric rhythm scores. This does not resolve the separate startup-history gate or kick retrigger.

### Round 4: kick, snare and hat at 120 BPM

User supplied `kick snare hat 120 1 bar.wav` and confirmed 120 BPM. Original stereo 44.1 kHz WAV is 2 seconds. Exact instrument placements and simultaneous attacks are not yet confirmed; do not infer separate instrument detection from combined transients.

Unchanged detector: seven candidates, beginning at 0.252313 seconds. Experimental startup bypass: eight at 0.001315, 0.252313, 0.500590, 0.752313, 1.001837, 1.252313, 1.500590 and 1.752313 seconds. These lie 0.590–2.313 ms after the provisional eighth-note grid (250 ms spacing). No closely spaced duplicate candidates. If the intended pattern has attacks at every eighth note, experimental count and timing match that structure; await user confirmation. Start sensitivity excluded from assessment. No trailing full-bar silence for pause evaluation.

Reports: `output/audio-validation/kick-snare-hat-120/`. Metadata and checksum saved beside fixture. Production detector unchanged. Current next step: written feedback on the combined pattern before declaring success or adding complexity.

User confirmed hi-hat eighth notes, kick/snare quarter notes, all quantized. Exact kick/snare allocation is unspecified. User requested positions as beat.sixteenth (`1.1` = beat 1, first sixteenth; `2.3` = beat 2, third sixteenth), plus per-candidate timing error. Use render sample zero as this fixture's beat-1 grid origin; retain sample-clock timestamps. Positive grid error means late. This diagnostic is independent of Start sensitivity, first-hit anchoring and the engine's interpretation.

Experimental results: 1.1 +1.315 ms; 1.3 +2.313 ms; 2.1 +0.590 ms; 2.3 +2.313 ms; 3.1 +1.837 ms; 3.3 +2.313 ms; 4.1 +0.590 ms; 4.3 +2.313 ms. Full precision in `output/audio-validation/kick-snare-hat-120/grid-results.json`. Skill updated to use this presentation for later takes. Production remains unchanged.

### Round 5: sixteenth-note render

User requested `kick snare hat 16ths 120 1 bar.wav`. Actual decoded duration is 0.124989 seconds (5512 frames at 44.1 kHz): one sixteenth at 120 BPM, not one 2-second bar. Unchanged detector finds zero candidates; experimental startup bypass finds one at 0.001315 seconds, provisional position 1.1 with +1.315 ms error against file-zero grid. Cannot assess the intended full-bar pattern from this short render. Ask user to export full 2-second bar before proceeding. File preserved unchanged; hash/metadata beside source and reports in `output/audio-validation/kick-snare-hat-16ths-120/`. Production unchanged.

#### Replacement render

User replaced the WAV and requested a retry. Duration now 2 seconds. Production finds 9 candidates; startup-bypass experiment finds 10, at positions 1.1 (+1.315 ms), 1.2 (+2.324 ms), 1.3 (+2.313 ms), 2.1 (+0.590 ms), 2.3 (+2.313 ms), 3.1 (+1.837 ms), 3.3 (+2.313 ms), 4.1 (+0.590 ms), 4.3 (+2.313 ms), 4.4 (+2.324 ms). No close duplicate candidates. Grid assumes file-zero beat 1, consistent with prior renders. Exact expected pattern remains unconfirmed; do not call the six unoccupied sixteenth positions misses without confirmation. Ask whether extra sixteenths were intended only at 1.2 and 4.4 or throughout the bar. Metadata retains prior short-render hash; reports saved as replacement-baseline.json and replacement-probe.json in the same output folder. Production unchanged.

### Round 6: beat 1 120

Analyzed user-supplied `beat 1 120.wav` at 120 BPM, auto mode. Duration 2 seconds, stereo 44.1 kHz. Current detector source now includes configurable settings and rejection diagnostics from work outside this loop. Adapted the output-only probe to bypass only the current warming-up rejection; production source remains untouched.

Baseline: four accepted onsets at 0.486984, 1.003651, 1.032971 and 1.491497 seconds. Startup-bypass experiment: six at 0.004059, 0.027188, 0.486984, 1.003651, 1.032971 and 1.491497 seconds. Against assumed file-zero 120 BPM grid: 1.1 +4.059 and +27.188 ms; 2.1 -13.016 ms; 3.1 +3.651 and +32.971 ms; 4.1 -8.503 ms. Close pairs are 23.129 and 29.320 ms apart, potentially retriggers or intentional attacks. Exact intended pattern and quantization are unknown; do not classify pairs as false positives or offsets as performance errors until clarified.

Reports: `output/audio-validation/beat-1-120/`; checksum and format in fixture metadata. Start sensitivity excluded from onset assessment. Next: ask user to confirm intended attack positions and whether this render is quantized.

#### Confirmed failures

User feedback: "there should only be one hit detected at 1.1. the kick reaches peak energy around 27ms in. but we detect 2. the same happens at 3.1. we have completely missed a loud kick at the 8th note after beat 2".

Expected: one onset each at 1.1 and 3.1; kick at 2.3 (0.75 seconds). The late detections at 0.027188 and 1.032971 seconds are confirmed retriggers within the same kick, not separate intentional events.

Diagnostics confirm attempted attacks at 0.750317 and 0.751882 seconds rejected solely for level. Their RMS values are 0.011550 and 0.021974 against the adaptive minimum of 0.029089 left by earlier high energy. Rise/contrast pass. This is detector-level masking, independent of Start sensitivity. At 3.1 the detector accepts a second rise 29.32 ms after the initial candidate; it rearms within the same evolving kick. Rejections saved in `output/audio-validation/beat-1-120/rejections.json`. No fix applied yet. Active failure case: suppress within-kick retriggers while retaining the independently confirmed 2.3 kick and quiet/faster distinct hits in prior fixtures.

### Round 7: beat 1 simple 120 / dynamic range

User requires wide dynamic range: loud kick/snare must not mask important quiet hat ghost notes. Prefer amplitude changes over raw level, with a very low minimum. Frequency-content changes explicitly deferred. User confirmed this fixture has closed hat each eighth, kick on beats 1/3 and snare on beats 2/4: eight combined expected attack positions. File-zero origin assumed consistent with earlier renders; grid events are not independently measured acoustic onset annotations.

Original stereo 44.1 kHz WAV, 2 seconds. Production detects 4 candidates. Startup-bypass experiment detects 6: the four quarter-note groups, plus kick retriggers at 0.027370 and 1.032971 seconds. All four intervening hats (1.3, 2.3, 3.3, 4.3) are missed. Diagnostics confirm their initial rises pass rise/contrast but fail the adaptive minimum (~0.0293–0.0295 RMS).

An additional output-only experiment removes the loud-history multiplier from minimumLevel, keeping the existing absolute floor and rise/contrast checks. It recovers all eight expected groups, but retains both kick retriggers (10 total candidates). Earliest candidates by expected position: 1.1 0.004036 (+4.036 ms); 1.3 0.251542 (+1.542); 2.1 0.484399 (-15.601); 2.3 0.750317 (+0.317); 3.1 1.000726 (+0.726); 3.3 1.250658 (+0.658); 4.1 1.491497 (-8.503); 4.3 1.750635 (+0.635). Negative offsets require waveform/intended-grid review; do not assume detector accuracy from recovered counts.

Reports, diagnostics and experimental copies: `output/audio-validation/beat-1-simple-120/`. No production source changes or claim of a validated fix. Broader noise/ghost-note regression tests not run for this diagnostic experiment. Next: user review of recovered hats and ongoing kick retriggers before choosing the next refinement.

### Retained fix: kick-body retriggers and quiet hats

User requested fixing extra kicks while preserving quiet hats and showing every detection. Retained the following in TypeScript, Java and Swift: a 10 ms smoothed energy envelope for rearming; resetting envelope-peak tracking for each accepted attack; requiring a distinct 2.5× local rise when using the short-background exception without full-history contrast; capping the adaptive minimum at twice the selected minimum RMS. No spectral classifier, long hit blackout, or timestamp shift was added. Start sensitivity and the existing startup-history gate are unchanged.

The first simple smoothing experiment removed the 27/33 ms extras, but varying sample alignment exposed another possible decay retrigger around 80 ms. The stricter short-background exception removes that failure while preserving existing 40 ms softer follow-ups and close-flam tests. Removing the adaptive floor entirely admitted previously rejected faint noise; capping its increase preserves those checks and recovers the supplied quiet hats.

At file-zero startup, the retained detector finds seven groups (opening hit still suppressed). With the same explicitly experimental startup bypass used in earlier tables, every detection is: 1.1 0.004036 (+4.036 ms); 1.3 0.251542 (+1.542); 2.1 0.484399 (-15.601); 2.3 0.751882 (+1.882); 3.1 1.000726 (+0.726); 3.3 1.250658 (+0.658); 4.1 1.491497 (-8.503); 4.3 1.750635 (+0.635). Eight total, no extras. These are render-grid errors with file-zero origin, not independent acoustic-onset accuracy claims.

Added real-WAV regression across ten lead-in/sample alignments; all eight groups survive with no extras. Full suite: 234 passed, 21 device/tooling-gated tests skipped. Typecheck and production build pass. Standalone Java/Swift detector and waveform parity pass at 44.1/48 kHz, including supplied WAV at 44.1 kHz. Native apps were not reinstalled/synced/built or tested on devices; only host detector parity was compiled. Earlier reviewed instrument loops retain their expected experimental counts; isolated kick now has four, without its extra detection. An additional unreviewed `kick snare hat 16ths dyn 120 1 bar.wav` appeared in the folder and is not an established benchmark.

Reports and complete detections: `output/audio-validation/kick-fix/fixed-summary.json` and per-file reports beside it. Next: review these retained-fix results with user; startup acquisition and the negative backbeat grid offsets remain separate known concerns.

### Round 8: quieter eighth-note hats

User requested `beat 1 simple dyn 120.wav`, describing quieter hats on the eighth notes. WAV is stereo 44.1 kHz, 2 seconds. Assessed as the quieter variant of the preceding simple eight-attack pattern, with file-zero origin assumed.

Retained detector finds five attacks; experimental startup bypass finds six: 1.1 0.001315 (+1.315 ms), 2.1 0.500590 (+0.590), 3.1 1.001837 (+1.837), 3.3 1.252313 (+2.313), 4.1 1.500590 (+0.590), 4.3 1.752313 (+2.313). No extra candidates. Hats at 1.3 (0.25 s) and 2.3 (0.75 s) are missed. These are different source audio/timings from the earlier simple render; retain separate results.

The missed hats' candidate windows fail level, rise and contrast. At 0.252313 s RMS is 0.005177; at 0.752313 s it is 0.006407. Selected floor is 0.006 and adaptive minimum is 0.009849. The same floor is the denominator for rise/contrast comparisons, so simply removing the adaptive increase will not recover these attacks. Start sensitivity is not involved. No further detector change made during this requested analysis.

Metadata/checksum saved beside source; reports and rejected candidates in `output/audio-validation/beat-1-simple-dyn-120/`. Next: review failed quiet-hat case and refine low-level change detection without restoring kick retriggers or noise false positives.

### Retained sensitivity change: recover the dynamic hats

User clarified that audible/visible quiet hats have clear onsets and detection should emphasize relative increases instead of demanding loud absolute levels. A failing regression reproduced missing hats on all ten analysis-window alignments. The existing Minimum level control at 0.002 recovers the supplied attacks: no spectral classifier or new relative-threshold heuristic was needed. Lowered the default from 0.006 to 0.002 consistently in shared/Java/Swift settings, retaining rise/contrast, timestamping and smoothed-envelope checks.

Lowering the floor exposed one kick-body shortcut at a different window alignment (local ratio 2.68 while still disarmed). Increased only the disarmed rearm override from 2.5× to 4× and updated diagnostics; ordinary armed onsets retain their existing rise/contrast requirements. Both simple loops now have exactly eight groups across all ten alignments. Existing flam, 40 ms softer-follow-up and slow/ongoing-rumble tests pass. Every previously reviewed render retains its expected full-file experimental count, without kick duplicates.

Sensitivity tradeoff is explicit: clear faint transient probes that the previous default rejected are now accepted as low-level onsets. They cannot be classified as unintentional noise from amplitude alone. Conservative-profile recovery/silence tests now select 0.006 explicitly and continue to enforce their original behavior; added default-profile tests verify all nine clear transient events in that synthetic fixture. Device/acoustic-room accuracy is still unverified.

Every dynamic-loop detection using the separate startup bypass: 1.1 0.001315 (+1.315 ms); 1.3 0.252313 (+2.313); 2.1 0.500590 (+0.590); 2.3 0.752313 (+2.313); 3.1 1.001837 (+1.837); 3.3 1.252313 (+2.313); 4.1 1.500590 (+0.590); 4.3 1.752313 (+2.313). No extras or missed expected groups. File-zero grid is assumed. Without startup bypass the retained detector finds seven (first-sample gate remains unchanged).

Validation: 246 tests passed, 21 device/tooling-gated skipped; typecheck, production build and Java/Swift host onset/waveform parity pass. Native parity now includes both supplied loops at two sample alignments plus sensitive low-level synthetic attacks. An initial full-suite run alongside the build timed out in one import test; the subsequent full suite run independently passes. Native apps were not synced/rebuilt/device-tested.

Complete before/after detections: `output/audio-validation/quiet-onset-fix/results.json`. Changes are retained locally, not committed or pushed. Next: user feedback on this sensitive default before progressing to more complex material.

### Retrospective follow-through: reproducible investigation

Added `audio:compare` with full per-profile production/assumed-prehistory tables, source and fixture provenance, and ignored JSON reports. Added schema/checksum/duration/grid checks for every fixture, completed missing sidecars, and kept partial/unknown intention explicit. Added default/conservative matrix tests for both simple loops, alignment, close/soft follow-ups and noise; improvements may recover additional conservative hats without freezing misses as the desired behavior. Extended native parity to both profiles and configured a separate macOS CI job. Typechecking now includes the offline tools. Updated the project skill and fixture guide to use these commands; historical source-patched experiments remain historical evidence only.

Local validation: 274 passed, 21 skipped; fixture check, app/tools typecheck, build and Java/Swift parity pass. Lint has existing unrelated warnings. Checks used supported local Node 22.21.1 while CI remains pinned to `.node-version`. No detector algorithm, live capture, native app build, commit or push was part of these workflow improvements.


### Frequency-change review experiment — 17 October 2026

User requested an Energy/Frequency change balance beside Detection sensitivity, default 100% frequency change for import/replay while keeping live capture unchanged. Implemented causal octave-band energy-growth evidence, pre-decision blending, per-band background/rearming and bounded review diagnostics. Changing balance starts fresh analysis against the original musical reference; native Java and Swift replay mirror TypeScript. Latest-performance recovery retains the balance; new material starts at 100%.

Confirmed regression work: a first pass masked 40 ms softer follow-ups behind the prior accent's band history; using the short baseline only after a distinct raw band rise restores these. A slower 10 ms rearming envelope prevents kick-body retriggers. The retained version passes both eight-group loops across ten sample alignments at 25/50/100%, and Java/Swift/TypeScript parity at 0/50/100% for both profiles, close follow-ups, level recovery, synthetic ambience and a new high-band attack over a low sustained tone. The synthetic overlap is found at 100% and missed by broadband energy. These checks do not establish improved acoustic-kit accuracy or solve the unprovided current failure.

Reports are in ignored `output/audio-validation/comparisons/`; use the README command with `--frequency-balance=0` and `--frequency-balance=100`, optionally `--assume-silence`, to reproduce complete detection/grid tables and source fingerprints. The native plugin must be refreshed/synced before rebuilding applications. Physical-device and acoustic validation remain outstanding.
