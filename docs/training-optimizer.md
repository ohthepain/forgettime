# Local parameter optimization v1

**Parameter optimization** runs only on local reviewed training data. Quick considers 100 trials per family; Deep considers 500. These are trial budgets, not runtime promises. Entry stops microphone/Auto/replay. Recording, replacement and annotation entry are unavailable while running. Worker execution yields after each 4,096 real source frames, allowing progress/cancellation without using arrival time as an onset measurement. Native detector sources, live defaults, labels, PCM and original analysis are unchanged. Profile saving/selection belongs to the later adoption issue.

## Inputs and reproducibility

Unassigned recording groups receive the existing deterministic `assignTrainingGroups` split, persisted through repository compare-and-swap before the search starts. Existing assignments are preserved. All related sources/bars stay in their recording group. One group stays training-only. The UI explains the approximate 20% withheld policy; fewer than five recordings remains preliminary.

`seeded-grid-v1` pins uint32 Mulberry32 (increment 0x6d2b79f5; the source specifies the exact integer operations). The baseline is always trial zero. An optional starting configuration is trial one, within the same budget; the UI passes current review settings for the current family. The first floor(0.7 × budget) slots include baseline/starting and broad exploration. Remaining slots refine around the best fully scored candidate at that point.

Current-family broad sampling: minimum RMS .001–.1 and recovery .25–12 seconds use log sampling; contrast 1.1–4, separation 8–100 ms and frequency balance 0–100 use uniform sampling. Quantize respectively to .001 RMS, .25 seconds, .1 contrast, 1 ms and 1 balance point. There is no sensitivity dimension. Refinement draws each numerical coordinate uniformly within ±10% of its entire legal range around the incumbent, then quantizes and clamps. Baseline/starting settings may have finer legal values and retain their exact values.

Mel broad sampling: uniformly choose window target 10/20/40 ms, bands 24/48/96, neighbor 1/3/5 (1 means suppression off), confirmation 0/1/2 and rearming off/on. Threshold .5–4 uses a .05 grid. During refinement each categorical coordinate retains its incumbent with probability .7; otherwise draw from its entire set. Threshold uses the same ±10%-of-range rule as current parameters. Mel's fixed frontend and hop remain as documented in [mel detector](mel-detector.md).

Coordinates are drawn in the explicit order declared in `training-optimizer.ts`. From slot two onward, duplicate configurations receive up to 32 deterministic resamples; exhausted duplicates still consume a bounded slot. Illegal mel filters/configurations consume a recorded invalid trial, with no partial score. An illegal/unavailable baseline fails that family visibly; it is never silently substituted. Each trial records settings, actual rates and resolved window/hop/history-start lengths. No per-frame diagnostics accumulate.

Rank uses the authoritative recording-weighted error, missing-timing guard and timing tie-break. Exact ties use the numeric tuple in declared parameter order, with false before true. The baseline remains eligible. `improved` is true only when the winning score strictly beats the baseline before the parameter tie-break; a different tied configuration does not imply improvement. No eligible ordinary time is unavailable, not zero error.

The SHA-256 build identifier covers actual bytes of search, scoring, training contract/transfer, current detector/settings, frequency evidence and mel detector files. Both Vite builds and tests inject it using `scripts/lib/optimizer-build.ts`; unbundled execution refuses to invent a build identifier. Restart development servers after editing these files so their injected source fingerprint reflects the current code. Same exact dataset, assignments, build, options and seed reproduce the ordered trials/scores and winning parameters. UUID and elapsed time are metadata and intentionally vary.

## Fixed comparison window

All candidates and both families use `optimizer-common-envelope-v1`, with its configuration identity including the source-build hash. At each rate let W be the largest permitted mel window (40-ms target, nearest power of two, clamped 128–8192), H the rounded 2.5-ms hop, and C the current detector window max(32, round(rate × .002667)).

Ordinary startup begins at max(W + ceil(rate × .1) + 2H, 13C). The terminal bound is min(floor(sourceFrames/C) × C, sourceFrames − W − 3H − 2). If these bounds have no overlap, admit zero ordinary time. This deliberately conservative envelope is fixed before trials, independent of attacks, thresholds, bands, candidate performance and family. It may exclude more than a selected candidate alone needs; changing it requires a new policy/comparison fingerprint and rescoring.

Each eligible source is analyzed continuously from real frame zero, retaining state across bars. No padded prefix/tail, crop substitution, tempo tracking or resampling is introduced. Actual detector startup and terminal watermark must cover every ordinary scored interval or that trial rejects. Missing-prehistory and uncertainty/overlap exclusions retain the scorer's policies. In particular, the current conservative missing-context policy makes ordinary scores unavailable for sources whose beginning is unavailable; captured/cropped material remains inspectable, but cannot claim certified history.

## Cancellation, stale inputs and withheld evaluation

Only a complete source-set evaluation can compete. Cancellation during a trial drops that partial trial and retains the best fully evaluated one with `cancelled`/incomplete status. Dataset commits signal same-window listeners and other windows through BroadcastChannel. Changes request cancellation and mark the run stale. Notifications cannot turn a committed dataset write into a reported failure. Before any result publishes, the controller rereads the repository fingerprint; late results cannot acquire current-input status. Stored runs also display outdated status for changed datasets or builds. Restart is an explicit new search.

Search analyzes training groups only. **Freeze best candidate** records the chosen fully evaluated trial. **Evaluate frozen candidate on withheld recordings** is a separate action and refuses stale inputs/builds or missing freeze. Its summary never affects trial ordering, refinement or the winner. If withheld findings inform further tuning, fresh withheld material is required for an independent improvement claim. Neither a synthetic fixture nor the preliminary/withheld status label establishes acoustic accuracy.

## Bounded run records

`forgettime-optimizer` IndexedDB is separate from the dataset, saved bars and latest take. Atomic run records keep input/comparison fingerprints, assignments, build/routine versions, seed/mode/family, ordered trials, resolved parameters, aggregate counts/rates/timing and completion/freeze/withheld status. They contain no audio, desired attack arrays, uncertainty snapshots or historical annotations. Historical reproduction is unavailable once exact original inputs are replaced/deleted.

Admission is at most 20 records, 2 MiB per record and 8 MiB total. Updating a record replaces its current completion/freeze/evaluation state, with no revision history. Quota, abort and admission failures preserve existing records; current result remains available in memory with a visible error. No eviction. Explicit permanent deletion removes only that run record after confirmation. No automatic export, upload or cloud synchronization.

## Validation

Seven core tests cover ordered determinism, baseline/no-improvement ties, budgets, optional starting settings, fixed scoring coverage, partial-trial cancellation, stale inputs, frozen withheld evaluation, actual mel resolved lengths/illegal settings, group assignment CAS and bounded/strict record codecs. Three UI tests cover stop-before-worker, progress/cancel/freeze/evaluate, preparation cancellation and late old-input results. Standard source-clock/silence and training storage/annotation/scoring checks remain included.

A dedicated test origin with two synthetic 48-kHz recordings completed 100 current-family trials, explicitly froze/evaluated the withheld source and restored the record after reload. Deep mel cancellation retained 47 completed trials; a second run stopped stale after a different window edited an annotation (4 completed trials). These counts/elapsed times describe this check, not promised runtime. An isolated real IndexedDB harness verified exact record reopen, abort preserving the prior record, retry/update, 20-record and 8-MiB rejection without eviction. Its temporary database is deleted. Generated dataset/run fixtures are cleaned up separately from user data. Native/phone performance, storage eviction and acoustic improvement remain separate acceptance work.
