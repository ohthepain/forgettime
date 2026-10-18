# Authoritative onset scoring v1

`src/audio/training-scoring.ts` implements `source-onset-v1`, separate from the legacy musical-grid fixture comparator. It consumes validated desired attack frames and calculated source-frame onsets; it never changes BPM, phase, PCM, detector state or original analysis. It runs no detector, reads no microphone and performs no persistence. This is scoring infrastructure, not measured acoustic accuracy.

## Matching

`matchTrainingOnsets(desiredFrames, detectedFrames, sampleRate)` uses inclusive ±20 ms association. Desired frames must be unique nonnegative safe integers; detections can have finite fractional source-frame positions (for example a spectral-window center). Inputs are sorted without mutating them. Duplicate calculated detections remain separate: only one can match a desired attack and the others are extra.

The algorithm maximizes matched attack count, then minimizes total absolute frame error. A sparse monotone dynamic program with a Fenwick prefix tree considers valid associations, delaying updates per desired attack to prevent reusing it. For ordered timestamps and absolute distance, an optimal noncrossing pairing exists. This avoids greedy nearest matching stealing another attack's only possible detection. Deterministic tie order follows sorted desired/detection indices. Inputs are bounded to 20,000 events per source evaluation/matching call and 1,000,000 possible associations; excessive ambiguity rejects rather than truncating or silently changing algorithms.

Outputs include matched source-frame pairs, missing desired frames, extra calculated frames, mean absolute onset error and signed mean bias (positive late). Empty matches have unavailable timing statistics (`null`), not zero error. Confirmed silent material can still score extras.

## One fixed comparison plan

Build `createTrainingEvaluationPlan(manifest, configurationIds, coverage)` **once for all configurations being compared**, before selecting a winner. Configuration identities should include the detector build/settings identity, not merely a display name. For every eligible source/configuration, coverage explicitly declares:

- `reliableFromFrame`: the first source frame admitted to ordinary scoring under that detector's startup/history policy.
- `processedThroughFrame`: an exclusive safe source-frame watermark; no pending decision may later add an onset before it.

These are source analysis bounds, not wall-clock arrival times. The detector runner must process real retained history continuously from source start, retain state across adjacent bars, and supply truthful bounds. The scorer cannot infer decoder history or prove a runner honored this obligation. A detector with pending confirmation or an unfinished tail must not claim complete terminal coverage.

The common ordinary window uses the **maximum** reliable-start and **minimum** processed-through bound across all configurations. Never build a more favorable mask for each candidate or choose bounds based on misses. A search can use a predeclared conservative envelope for its permitted configurations; changing that envelope requires a new comparison plan and rescoring the baseline. Missing/duplicate/unknown coverage or invalid extents reject.

Plans are deeply frozen and SHA-256 fingerprinted using scoring version, current manifest fingerprint, configuration identities, masks, desired labels and group assignments. Comparison rejects scores from different plans or splits. Array/key ordering is canonicalized for repeatability; the plan fingerprint is a freshness/comparability token, not a historical annotation archive.

## Reviewed coverage and exclusions

Only reviewed bars with complete source PCM coverage enter ordinary evaluation. Union their ranges so overlapping/adjacent bars never double count time or attacks. Ownership is start-inclusive/end-exclusive. An attack exactly on an adjacent bar boundary is owned once. Inconsistent attack existence in overlapping reviewed bars rejects rather than silently picking a label set; uncertainty is an explicit exception.

Uncertain regions are unioned after expanding each side by `ceil(rate × .020)` frames and clipping to the source. All ranges remain half-open. Desired and calculated attacks in the resulting masks are excluded. Match independently within each remaining contiguous interval, never across an excluded region. Exclusion durations are unioned, so startup/uncertainty overlap is not counted twice.

Report excluded ranges by reason: uncertainty, startup, terminal, missing prehistory and related-source overlap. Per-source results include ordinary evaluated seconds, unioned excluded seconds and excluded desired/detection counts. Startup and incomplete tails remain inspectable separate material, not ordinary-score successes or silent omissions.

**Conservative missing-context rule:** when `provenance.beginningAvailable` is false, ordinary scoring for that source is unavailable. No arbitrary 32 ms or four-second warmup can certify unknown prehistory. The source remains inspectable with explicit missing-context exclusion. Replacing this rule with empirically justified context admission requires a versioned policy and fresh comparisons, not fabricated silence. No eligible time yields unavailable rates, never a perfect zero.

Known ancestor/excerpt relationships map to their root timeline with exact frame offsets; unlike checksums, these identify related audio. Related sources must share one group even when their common ancestor payload is absent. Cycles, unsafe offsets and incompatible sample rates without an explicit mapping reject. Where retained sources overlap on a known root timeline, deterministic priority is shallower ancestry, then longer source, then checksum. Already evaluated regions are excluded from later sources as overlap; they do not inflate ordinary duration or matches. Uncertain/startup-excluded ancestor portions do not claim ordinary time and may be covered by an independently reviewed eligible excerpt. Source/group/provenance fingerprints preserve which material contributed. Relationships not represented by metadata cannot be inferred from unrelated hashes: the dataset author must group related edits/copies explicitly.

## Recording-weighted metrics and ranking

`evaluateTrainingOnsets(plan, configurationId, resultsBySource, assignment)` evaluates training or withheld groups separately. Each participating source needs an explicit results array; missing results are not assumed to be silence. Out-of-source/invalid detection positions reject.

Within each recording group, sum missing+extra counts and divide by unique ordinary evaluated seconds. Average those rates equally across groups, rather than pooling all seconds and allowing one long recording to dominate. Mean absolute onset error and signed bias are calculated across matches within each group, then equally averaged over groups with timing observations. Counts, source results and recording results remain available alongside the aggregate.

`compareTrainingScores` ranks lower error rate first. On a primary tie, fewer groups lacking timing observations wins before comparing the recorded mean absolute onset errors; absent timing must not improve rank. Exact remaining ties return zero for the optimizer's versioned stable parameter ordering. Unavailable ordinary rates rank worse than available rates. No clock/grid adjustment or bias subtraction improves a score.

## Recording-group split

`assignTrainingGroups(manifest, seed)` preserves all existing assignments and modifies only unassigned groups containing examples. Seed is uint32. Order uses a versioned FNV-1a-style rank seeded by the supplied value, then lexicographic group ID. If no training group exists, first reserve one. Target withheld count is `max(1, round(activeGroups × .20))` when at least two groups exist, otherwise zero. Fill the target from remaining unassigned groups, putting the rest in training. Persist this returned manifest before optimization; changing seed later does not reshuffle already assigned groups. Existing all-training or all-withheld assignments are not silently overridden to force the target.

Evidence status considers groups with ordinary evaluated time: no trainable/evaluable material is `unavailable`; no independent withheld check is `training-only`; fewer than five independent assigned/evaluable groups is `preliminary`; otherwise a held-out split is available (`withheld`). These labels are practical thresholds, not proof of representative acoustic accuracy. Only the later UI/run controller can freeze candidates, require explicit withheld evaluation and track whether repeated inspection turned withheld recordings into development evidence. This module does not run a search or automatically inspect the other split.

## Validation scope

Tests cover the greedy counterexample, exhaustive optimal matching on dense small deterministic cases, exact tolerance edges, duplicate predictions, empty/silent inputs, reference-independent frame timing, uncertainty margins, common startup/terminal masks, incomplete context, boundary ownership, overlap conflicts/deduplication, recording weighting, missing timing, immutable fingerprints, related-excerpt leakage and seeded stable assignment. No detector/native capture source changes are involved. No device, microphone, native performance or acoustic improvement is claimed by these synthetic contract checks.
