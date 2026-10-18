# Experimental causal mel detector v1

`src/audio/mel-detector.ts` and the native `MelDetector` Java/Swift classes implement `mel-flux-v1` as a separate family for future training/import/replay profiles. No live detector constructor, capture default, musical reference, silence deadline or `.forget` original analysis is changed. These classes are not yet selected through the app's profile controls or Capacitor replay bridge; those integration paths belong to later optimizer/profile issues and must not silently substitute the legacy detector.

## Settings and fixed frontend

Validated settings: window targets 10/20/40 ms; 24/48/96 mel bands; neighbor reference widths 1 (off), 3 or 5; 0/1/2 confirmation hops; rearming off/on; adaptive threshold multiplier .5–4. Default experimental settings are 20 ms / 48 bands / 5-band neighbor / 1-hop confirmation / rearming on / multiplier 2, matching a concrete prototype starting point rather than a claim of best acoustic accuracy. Settings are immutable after construction; change them by starting a fresh detector.

Actual window length is the nearest power of two to target seconds × actual sample rate, clamped to 128–8192 samples. The fixed hop is `max(1, round(rate × .0025))`. Both resolved lengths are exposed. Source rate must be an integer 8–192 kHz; no hidden resampling. Reject filters without any positive-weight FFT bin rather than silently dropping bands or changing resolution. Some high-band-count/short-window/rate combinations are therefore illegal search candidates.

Use trailing Hann windows, FFT length equal to window length, and normalized power `(real² + imaginary²) / sum(window)²`. Project triangular Slaney-scale filters over 30 Hz to `min(16 kHz, Nyquist)`, area-normalizing each filter by `2/(upper-lower)`. Compress with `log1p(power/1e-8)`. Positive growth is averaged over all mel bands relative to the preceding frame; an optional neighbor maximum on that preceding spectrum suppresses frequency movement. This is frequency-change evidence, not source separation or a neural model.

Threshold uses **only prior** flux frames spanning `ceil(rate × .1 / hop)` analysis frames: past mean + multiplier × population standard deviation + .005. History must fill before an attack can be accepted. A candidate exceeds its threshold and preceding frame strictly; confirmation 1/2 additionally requires a strict maximum against that many subsequent flux frames. Confirmation zero only compares the past, so it detects rising evidence without claiming future peak confirmation. Minimum accepted separation is 18 ms. With rearming enabled, a subsequent evaluated flux frame must fall to or below its own threshold before another attack can be accepted. All these conventions are fixed/versioned and independent of tempo.

## Streaming source clock

`process(sample, frame, sampleRate)` consumes one real mono Float32 sample with its absolute integer source-frame coordinate. TypeScript explicitly rounds a finite input to Float32; Java/Swift accept Float samples. Nonfinite input, unsupported rate and invalid/unsafe frame coordinates reject. No JS callback or wall clock becomes an onset measurement. Frames must be consecutive; any real gap, repeated/backward frame or rate change resets history and starts a segment at the received frame. Ordinary input packets must preserve this sequence and do not reset state. Feed every sample in order; packetization is not a detector parameter.

First analysis waits until a complete real window exists, with no zero prefix. A result contains:

- `sourceFrame`: the analysis-window center (may be fractional), with no backward localization or arbitrary offset correction.
- `analyzedThroughFrame`: exclusive consumed source boundary at emission, including confirmation delay.
- the candidate's flux and threshold, for inspection.

Actual algorithmic emission delay in seconds is `(analyzedThroughFrame-sourceFrame)/rate`; this does not measure physical microphone/output latency. It includes about half the window plus confirmation hops. Detector bias against audible labels still needs evaluation; the center estimate is not guaranteed to be the audible beginning.

The exclusive safe `processedThroughFrame` floors the **earliest center still able to produce a future decision**, using the last analysis center plus `(1-confirmation) × hop`, bounded by segment start. Rounding up would incorrectly include a pending fractional-frame candidate. This watermark is intentionally conservative even when a pending row is currently below threshold. The state exposes actual received boundary, reliable-start convention, pending partial-window samples, rate and resolved lengths; Java/Swift expose the corresponding clock/length getters. Startup's first eligible center is after a full prior threshold history. This bounded arithmetic history is not proof that unknown acoustic prehistory is representative.

There is no padded flush. Trailing samples that do not complete a hop and candidates needing future confirmation remain outside the safe ordinary scoring watermark. Use the scoring module's fixed common startup/terminal mask for all compared configurations; do not improve a candidate score with its own favorable exclusions. Short/incomplete/unknown-context segments must remain disclosed, not silently treated as ordinary correct silence.

State retains a single window, cached FFT trigonometry/filter weights, one prior mel spectrum, bounded flux history and at most confirmation+2 rows. There is no accumulating event or diagnostic list. `process` returns the current accepted onset or null. Requested TypeScript diagnostic snapshots copy only the current power/log-mel/row; native read access similarly does not expose mutable internal evidence. Reset clears prior diagnostics and clock history. Production callers must collect results within their own bounded take/run limits.

## Validation and repeatability

`src/audio/mel-detector.test.ts` checks causal frame clocks, packet-size invariance, pending confirmation/partial tails, gap/rate reset, silence, invalid settings/rates/PCM, degenerate filters and emission delay. Independently derived analytical golden values verify DC power (.0625 for constant .25) and flat impulse-bin power for a Hann-windowed impulse.

Run `node --import tsx plugins/forgettime-audio/tests/validate-mel-parity.ts` for real Java/Swift host compilation and comparison against identical TypeScript Float32 PCM clocks. It compares full sampled power spectra/log-mel arrays, every flux/threshold/readiness row, accepted source/emission frames and final watermarks. Fixtures cover 8/44.1/48/192 kHz, configurable bands/windows/neighbors/confirmation/rearming/threshold bounds, overlapping ringing/quiet attacks, silence, constant/impulse signals, real gaps, rate transitions, derived threshold-adjacent settings and illegal sparse filters. Numeric tolerance is `1e-8 × max(1,abs(reference))`; row/event counts and clocks must agree. These are cross-runtime numerical tolerances, not bit-identity or a universal guarantee for every floating-point decision boundary.

Before claiming native code compiled, refresh the local file dependency, compare installed Java/Swift sources and sync Capacitor. Host compiler execution is not a full Android/iOS app build, permission/route check, device performance measurement or store release. The existing legacy detector parity must remain green. Native app/profile bridge adoption and representative independently annotated acoustic evaluation are separate acceptance work.
