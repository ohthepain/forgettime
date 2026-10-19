# Causal mel spectral-flux investigation

Research resolution for [Investigate a causal mel-spectrogram detector and optimizer search space](https://github.com/ohthepain/forgettime/issues/23). Inspected 17 October 2026, baseline commit `c7e0414bfc9927412e8ea23268ee765571a888a2`. This note recommends an experiment; it neither adopts mel nor establishes acoustic improvement.

## Finding

A separate, bounded-memory mel-flux detector is technically plausible in TypeScript, Java and Swift. Whether it improves this application's attack labels, and whether it meets device budgets, remains unmeasured. Preserve the current detector as baseline; distinguish detector family from parameter settings in optimizer runs. No neural training is required.

The existing implementation uses approximately 2.667 ms windows, 12 energy-history slots (approximately 32 ms startup), octave-spaced causal biquads at 80–10240 Hz below 0.45× sample rate, strongest-band growth, and an energy/frequency blend feeding one acceptance decision. This is already frequency-change detection, not an FFT or mel spectrogram. See [onset detector](../../src/audio/onset-detector.ts), [frequency evidence](../../src/audio/frequency-evidence.ts), [settings contract](../../src/audio/detector-contract.ts), [review behavior](../take-review.md) and its [validation limits](../recorded-workflow-validation.md). Current native mirrors are [Java](../../plugins/forgettime-audio/android/src/main/java/app/forgettime/audio/DrumOnsetDetector.java) and [Swift](../../plugins/forgettime-audio/ios/Sources/ForgettimeAudioPlugin/DrumOnsetDetector.swift).

## Established algorithm facts

Mel analysis projects a spectrum through triangular bands; sample rate, FFT length, hop, window, frequency limits, mel formula and filter normalization all affect the result. Librosa defaults to power spectra and offers different mel conventions. A causal implementation must explicitly disable centered padding and specify its own clock conventions. [Mel documentation](https://librosa.org/doc/0.11.0/generated/librosa.feature.melspectrogram.html)

An onset envelope can average the positive difference between each current log-mel band and a lagged reference band. A frequency-axis maximum filter broadens that reference before subtraction; width one disables it. This is a feature extractor, not a complete hit detector. [Onset-strength documentation](https://librosa.org/doc/0.11.0/generated/librosa.onset.onset_strength.html)

SuperFlux's primary paper uses log-spaced quarter-tone bands, not mel bands. It motivates frequency-neighbor maximum filtering to suppress apparent new energy caused by shifting partials. Its experimental settings include a Hann window, roughly 5 ms hops and lagged differences. Its demonstrated vibrato suppression is not evidence of drum-kit improvement. Its onset merging and matching tolerances differ from our accepted labels; do not import those scoring rules. [Böck and Widmer, DAFx 2013](https://www.dafx.de/paper-archive/2013/papers/09.dafx2013_submission_12.pdf)

Peak selection combines local maxima, an adaptive average plus offset, and a separation interval. Future-frame peak/average windows introduce additional delay. [Peak-picking documentation](https://librosa.org/doc/0.11.0/generated/librosa.util.peak_pick.html) Whole-recording normalization in an offline onset function must not become a streaming dependency. Backtracking to a preceding energy minimum is a segmentation heuristic, not guaranteed attack truth. [Onset-detection documentation](https://librosa.org/doc/0.11.0/generated/librosa.onset.onset_detect.html) Online normalization and peak picking must be assessed explicitly rather than assuming offline accuracy transfers. [Böck, Krebs and Schedl, ISMIR 2012](https://zenodo.org/records/1416036)

## Recommended streaming contract (proposal)

Consume canonical mono PCM at its actual source rate. Maintain an absolute integer source-frame counter, ring-buffered trailing windows, lagged spectra, bounded threshold history and bounded onset-localization history. Do not use callback arrival, wall clocks, fabricated zero prehistory or an offline full-clip maximum. Do not resample silently. If resampling later proves necessary, version the resampler and exact source-frame mapping.

For window `[s,s+N)`, analysis is available only after frame `s+N-1`. A frame-center coordinate is `s+(N-1)/2`; reporting it does not eliminate approximately half-window delay. A detector with K confirmation hops cannot emit before those K additional hops arrive. Report both the estimated source attack frame and the actual analyzed-through frame at emission; actual latency is their difference divided by sample rate. Never subtract an unexplained global offset merely to improve scores.

A practical experiment should compare a declared frame-based estimate with bounded retrospective localization against the already captured PCM/envelope. Fix localization rules before withheld evaluation; measure systematic bias and flam behavior. Do not assume energy-minimum backtracking identifies the audible beginning. Delay budgets and the chosen localization rule require a human decision after a prototype.

Begin only when real window/lag/history requirements are met. Flag startup and unavailable context separately under the accepted scoring policy; do not hide them. Process actual source history before each scored bar, preserving state across adjacent bars. Chunk size must not change results. New analysis runs, real gaps and rate changes reset explicitly; loop repetitions preserve state within a run as the existing replay contract requires. A loop join is real replay input, not evidence of a continuous original performance. Do not pad the tail to flush pending decisions; report incomplete terminal analysis separately. A safe processed-through watermark must account for any candidate still awaiting confirmation or retrospective localization.

Memory should be proportional to window size + mel history + finite peak/localization history, not recording duration. Cache FFT plans/filter weights, reuse scratch buffers, and bound diagnostic history. Estimated work scales with FFTs per second and filter projection; it must be profiled on supported devices, especially at 192 kHz.

## Exploratory parameter envelope (proposal, not approved defaults)

These are engineering starting points for a prototype, not literature-proven bounds. They deliberately limit combinatorial growth; all numeric values must be pinned in a versioned family schema before optimization.

| Control | Initial candidates | Reason / qualification |
| --- | --- | --- |
| Analysis window | nearest power-of-two to 10, 20, 40 ms at source rate; deduplicate, 128–8192 samples | Explore temporal/frequency trade-off across supported rates. Fix Hann and FFT length equal to window initially. |
| Hop | round 2.5, 5, 10 ms to source frames; require hop ≤ window/2 | Resolve attacks inside the agreed 20 ms match tolerance; shorter hop costs more. |
| Mel bands | 24, 48, 96 | More resolution than octave bands; reject degenerate/empty filters at low rates. |
| Frequency range | fixed 30 Hz to min(16000 Hz, Nyquist) initially | Avoid another search dimension; high-frequency usefulness remains empirical. |
| Mel convention | fixed Slaney scale and area normalization initially | Pin formula/weights; no claim it is optimal. |
| Power/compression | fixed normalized power and `log1p(P/epsilon)` initially | Freeze FFT/window normalization and positive epsilon in schema before choosing threshold bounds. No whole-record reference. |
| Difference lag | 1, 2, 3 hops | Greater lag strengthens changes but alters localization/history. |
| Reference max width | 1 or 3 mel bands | Compare unfiltered reference against neighbor suppression; not a direct copy of quarter-tone SuperFlux. |
| Threshold history | 50, 100, 200 ms of past flux | Bounded causal adaptive baseline; specify startup and exact inclusion convention. |
| Threshold | past mean + k×past standard deviation, k in {0.5,1,2,3,4}; explicit positive floor | This normalization is a proposed alternative to copying amplitude-specific offsets. Floor/epsilon must be calibrated only from training data then frozen; no meaningful numeric floor until feature scale is specified. |
| Peak confirmation | 0, 1, 2 future hops | Explicit latency/accuracy experiment; no hidden centered averaging. |
| Refractory period | 8, 12, 18, 25, 40 ms | Explore ghost notes/flams versus duplicates; never merge authoritative labels to accommodate a detector. |

Do not search every combination. Stage structural choices in the prototype, then run bounded seeded trials over the remaining dimensions. Mel thresholds, rearming and recovery are not numerically interchangeable with current RMS/contrast controls. Reusable concepts are a floor, adaptive history, separation, diagnostics and sample-clock processing; retain family-specific units and validation. Initially avoid blending mel/current evidence: it adds interaction dimensions before either family is understood. The optimizer decision must approve the actual envelope and trial budget.

## Runtime, parity and licensing

A pure arithmetic implementation can use typed arrays in a local TypeScript worker and mirrored Java/Swift code. Apple provides [Accelerate FFT APIs](https://developer.apple.com/documentation/accelerate/fast-fourier-transforms), but choosing them would still require consistent window scaling, FFT layout, filter coefficients and numerical tolerances. No Java/TypeScript FFT package was selected or audited here. A small shared FFT specification plus golden intermediate spectra/flux/onsets may be easier to verify than three unrelated high-level audio libraries; effort and performance remain to be measured.

Record implementation build/version, family-schema version, precise parameters, resolved frame lengths for each rate, canonical PCM checksum, dataset/annotation fingerprint, recording-group split, scoring version, seed, ordered trials, baseline and completed/incomplete status. Same-version deterministic replay is a reasonable requirement. Cross-runtime floating-point bit identity is not assumed: specify tolerances and test threshold-boundary fixtures so tiny FFT differences do not silently change accepted attacks.

Librosa is ISC licensed; copied source requires retaining its notice. It can serve as an offline reference without becoming a shipped dependency. Its dependency licenses are separate; do not infer that every transitive package shares ISC. Paper access is not permission to copy an arbitrary reference implementation. No third-party production dependency is approved by this investigation. [Librosa license](https://github.com/librosa/librosa/blob/0.11.0/LICENSE.md)

## Comparison and next decision

Keep the annotation/storage/scoring decisions unchanged: one-to-one 20 ms matching with maximum matches then minimum error, equal missing/extra penalties, equal source-recording influence through errors per evaluated second, timing secondary, uncertainty plus 20 ms margin excluded, real context and separately reported startup. Preserve same-source and related-excerpt grouping, fixed approximately 20% withheld groups, preliminary labels for fewer than five independent recordings and training-only for one.

Tune baseline and experimental families only on training groups with declared budgets. Freeze one candidate per family and the baseline before opening withheld results. Report raw/per-recording missing and extra counts, evaluated/excluded time, onset absolute error and signed bias, startup behavior, runtime, memory and actual emission latency. A lower detection count alone means nothing. Repeated human choices informed by withheld outcomes contaminate that check and require fresh held-out recordings. Profile retention does not retain overwritten annotation contents; dataset changes mark old scores stale. Explicit adoption remains separate.

Synthetic impulses, variable chunks, close attacks, tones, gaps, loop joins and 8–192 kHz fixtures can test clocks/parity and failure behavior. They cannot establish physical microphone, room or acoustic-kit accuracy. No detector was implemented, benchmarked or acoustically evaluated for this research.

**Recommended new HITL decision:** prototype a causal mel-flux alternative to choose localization, allowable lookahead, practical fixed frontend/normalization and a device-feasible parameter envelope. Only after that decision should the optimizer search space be finalized. Mel adoption remains a later comparison/adoption decision.
