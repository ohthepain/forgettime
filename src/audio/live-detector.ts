import { OnsetDetector, type DetectedOnset } from './onset-detector';
import { MelDetector } from './mel-detector';
import { optimizerParametersSchema, type OptimizerParameters } from './training-optimizer';
import type { DetectorSettings } from './detector-contract';

/** One immutable profile per capture session; timestamps and watermark are source frames. */
export function createLiveDetector(profile?: OptimizerParameters, fallback?: DetectorSettings) {
  const parameters = profile && optimizerParametersSchema.parse(profile);
  const current = !parameters || parameters.family === 'current'
    ? new OnsetDetector(parameters ? { version: 1, minimumRms: parameters.minimumRms, contrastRatio: parameters.contrastRatio, minSeparationMs: parameters.minSeparationMs, recoverySeconds: parameters.recoverySeconds } : fallback, parameters?.frequencyBalance ?? 0)
    : null;
  const mel = parameters?.family === 'mel' ? new MelDetector({ windowMs: parameters.windowMs, bands: parameters.bands, neighbor: parameters.neighbor, confirmation: parameters.confirmation, rearming: parameters.rearming, threshold: parameters.threshold }) : null;
  let processedThrough: number | null = null;
  let amplitude = 0;
  return {
    reset() { current?.reset(); mel?.reset(); processedThrough = null; amplitude = 0; },
    configure(settings: DetectorSettings) { current?.configure(settings); },
    process(samples: Float32Array, time: number, rate: number): DetectedOnset[] {
      if (current) {
        const hits = current.process(samples, time, rate);
        processedThrough = current.processedThrough;
        return hits;
      }
      const hits: DetectedOnset[] = [];
      const first = Math.round(time * rate);
      for (let i = 0; i < samples.length; i++) {
        amplitude = Math.max(Math.abs(samples[i]), amplitude * 0.999);
        const hit = mel!.process(samples[i], first + i, rate);
        // Acceptance belongs to the detector; amplitude is presentation only.
        if (hit) hits.push({ time: hit.sourceFrame / rate, strength: Math.min(1, amplitude), confidence: 1 });
      }
      processedThrough = mel!.state.processedThroughFrame / rate;
      return hits;
    },
    get processedThrough() { return processedThrough; },
    drainDiagnostics() { return current?.drainDiagnostics(); },
    analysis: parameters ? { implementation: `selected-${parameters.family}`, version: `v1:${JSON.stringify(Object.values(parameters).slice(1))}` } : undefined,
  };
}
export function selectedMicrophoneProfile(): OptimizerParameters | undefined {
  try {
    const parsed = optimizerParametersSchema.safeParse(JSON.parse(localStorage.getItem('forgettime-training-profile') || 'null'));
    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}
