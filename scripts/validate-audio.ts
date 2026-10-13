/** Offline validation, using real captured sample timestamps. Does not modify inputs. */
import { decodeWav } from './lib/wav';
import { readFile } from 'node:fs/promises';
import { TimingEngine, type InterpretationMode, type ResolvedHit } from '../src/audio/engine';
import { OnsetDetector, type DetectedOnset } from '../src/audio/onset-detector';
import { DEFAULT_START_SENSITIVITY } from '../src/audio/start-sensitivity';

interface Annotation {
  description: string;
  bpm: number;
  mode?: InterpretationMode;
  /** Human-verified attack times on the WAV clock, in seconds. */
  onsets: number[];
  toleranceMs?: number;
}

const [wavPath, ...arguments_] = process.argv.slice(2);
const exploratory = arguments_[0] === '--bpm';
const annotationPath = !exploratory ? arguments_[0] : undefined;
if (!wavPath || (!annotationPath && !exploratory)) {
  console.error('Usage: node --import tsx scripts/validate-audio.ts recording.wav annotations.json\n   or: node --import tsx scripts/validate-audio.ts recording.wav --bpm 110 [--mode auto|straight|swing]');
  process.exitCode = 1;
} else {
  let annotation: Annotation | undefined;
  let bpm: number;
  let mode: InterpretationMode = 'auto';
  if (exploratory) {
    if (arguments_.length !== 2 && !(arguments_.length === 4 && arguments_[2] === '--mode')) throw new Error('Use --bpm NUMBER [--mode auto|straight|swing].');
    bpm = Number(arguments_[1]);
    mode = (arguments_[3] ?? 'auto') as InterpretationMode;
  } else {
    annotation = JSON.parse(await readFile(annotationPath!, 'utf8')) as Annotation;
    if (!Array.isArray(annotation.onsets) || annotation.onsets.some((time) => !Number.isFinite(time) || time < 0)) throw new Error('Annotations require an onsets array of nonnegative times in seconds.');
    if (annotation.toleranceMs !== undefined && (!Number.isFinite(annotation.toleranceMs) || annotation.toleranceMs <= 0)) throw new Error('Annotation toleranceMs must be a positive finite number.');
    bpm = annotation.bpm;
    mode = annotation.mode ?? 'auto';
  }
  if (!['auto', 'straight', 'swing'].includes(mode)) throw new Error('Mode must be auto, straight or swing.');
  const { samples, sampleRate, channels } = decodeWav(await readFile(wavPath));
  const durationSeconds = samples.length / sampleRate;
  if (annotation?.onsets.some(time => time >= durationSeconds)) throw new Error('An annotated onset lies outside the recording.');
  const detector = new OnsetDetector();
  const engine = new TimingEngine({ bpm, mode });
  const onsets: DetectedOnset[] = [];
  const hits = new Map<number, ResolvedHit>();
  const transitions: { time: number; status: string; phaseOrigin: number | null; lastDetectedHit: number | null; silenceSeconds: number | null }[] = [];
  let previousStatus = '';
  engine.start(0);
  const block = Math.round(sampleRate * 0.02);
  for (let offset = 0; offset < samples.length; offset += block) {
    const slice = samples.subarray(offset, offset + block);
    const detected = detector.process(slice, offset / sampleRate, sampleRate);
    onsets.push(...detected);
    detected.forEach((onset) => engine.addOnset(onset));
    const time = detector.processedThrough ?? offset / sampleRate;
    const snapshot = engine.snapshot(time);
    snapshot.hits.forEach((hit) => hits.set(hit.id, hit));
    if (snapshot.status !== previousStatus) {
      const lastDetectedHit = onsets.at(-1)?.time ?? null;
      transitions.push({ time, status: snapshot.status, phaseOrigin: snapshot.phaseOrigin, lastDetectedHit,
        silenceSeconds: lastDetectedHit === null ? null : time - lastDetectedHit });
      previousStatus = snapshot.status;
    }
  }
  // Drain interpretation lookahead only. Do not report this artificial tail as
  // observed silence or as a measured pause in the supplied recording.
  engine.snapshot(durationSeconds + 0.25).hits.forEach((hit) => hits.set(hit.id, hit));
  const tolerance = (annotation?.toleranceMs ?? 20) / 1000;
  const unmatched = new Set(onsets.map((_, i) => i));
  const errorsMs: number[] = [];
  const missing: number[] = [];
  for (const expected of [...(annotation?.onsets ?? [])].sort((a, b) => a - b)) {
    const closest = [...unmatched].sort((a, b) => Math.abs(onsets[a].time - expected) - Math.abs(onsets[b].time - expected))[0];
    if (closest === undefined || Math.abs(onsets[closest].time - expected) > tolerance) missing.push(expected);
    else {
      unmatched.delete(closest);
      errorsMs.push((onsets[closest].time - expected) * 1000);
    }
  }
  const absoluteErrors = errorsMs.map(Math.abs).sort((a, b) => a - b);
  const intervals = onsets.slice(1).map((onset, index) => onset.time - onsets[index].time).sort((a, b) => a - b);
  console.log(JSON.stringify({
    recording: wavPath,
    evaluation: annotation ? 'annotated-onset-comparison' : 'exploratory-unannotated',
    description: annotation?.description ?? 'Unannotated recording: detected candidates are not confirmed hits.',
    sampleRate, channels, durationSeconds, bpm, mode,
    startSensitivity: DEFAULT_START_SENSITIVITY,
    fullBarSeconds: 240 / bpm,
    detectedCount: onsets.length,
    medianCandidateIntervalMs: intervals.length ? intervals[Math.floor(intervals.length / 2)] * 1000 : null,
    candidateIntervalsUnder45Ms: intervals.filter(gap => gap < 0.045).length,
    annotatedCount: annotation?.onsets.length ?? null,
    matchedCount: annotation ? errorsMs.length : null,
    precision: annotation && onsets.length ? errorsMs.length / onsets.length : null,
    recall: annotation?.onsets.length ? errorsMs.length / annotation.onsets.length : null,
    onsetMedianAbsoluteErrorMs: absoluteErrors.length ? absoluteErrors[Math.floor(absoluteErrors.length / 2)] : null,
    onsetMaxAbsoluteErrorMs: absoluteErrors.at(-1) ?? null,
    missingOnsets: annotation ? missing : null,
    extraOnsets: annotation ? [...unmatched].map((index) => onsets[index].time) : null,
    transitions,
    detectedOnsets: onsets,
    resolvedCount: hits.size,
    scoredCount: [...hits.values()].filter(hit => !hit.uncertain).length,
    uncertainCount: [...hits.values()].filter(hit => hit.uncertain).length,
    resolvedHits: [...hits.values()],
    note: annotation
      ? 'Precision/recall compare onset annotations only. Rhythmic intent, perceived timing and device latency require separate review. The first qualifying hit anchors beat one and is not scored.'
      : 'No ground-truth attack annotations were provided. Counts and inferred timing describe algorithm behavior, not detection accuracy or the player’s timing. Silence is measured from detected candidates, which may be false positives.',
  }, null, 2));
}
