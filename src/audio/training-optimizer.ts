import { z } from "zod";
import { DEFAULT_DETECTOR_SETTINGS } from "./detector-contract";
import { OnsetDetector } from "./onset-detector";
import { DEFAULT_MEL_SETTINGS, MelDetector } from "./mel-detector";
import { trainingFingerprint } from "./training-contract";
import { validateTrainingDataset, type TrainingDataset } from "./training-transfer";
import {
  createTrainingEvaluationPlan,
  evaluateTrainingOnsets,
  compareTrainingScores,
  TRAINING_SCORING_VERSION,
  type DatasetScore,
  type TrainingEvaluationPlan,
} from "./training-scoring";

export const OPTIMIZER_VERSION = "seeded-grid-v2";
declare const __TRAINING_OPTIMIZER_BUILD__: string;
export const OPTIMIZER_BUILD =
  typeof __TRAINING_OPTIMIZER_BUILD__ === "undefined" ? "unbundled" : __TRAINING_OPTIMIZER_BUILD__;
export const ENVELOPE_VERSION = "optimizer-common-envelope-v1";
const currentSchema = z.strictObject({
  family: z.literal("current"),
  minimumRms: z.number().min(0.001).max(0.1),
  contrastRatio: z.number().min(1.1).max(4),
  minSeparationMs: z.number().int().min(8).max(100),
  recoverySeconds: z.number().min(0.25).max(12),
  frequencyBalance: z.number().int().min(0).max(100),
});
const melSchema = z.strictObject({
  family: z.literal("mel"),
  windowMs: z.union([z.literal(10), z.literal(20), z.literal(40)]),
  bands: z.union([z.literal(24), z.literal(48), z.literal(96)]),
  neighbor: z.union([z.literal(1), z.literal(3), z.literal(5)]),
  confirmation: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  rearming: z.boolean(),
  threshold: z.number().min(0.5).max(4),
});
export const optimizerParametersSchema = z.discriminatedUnion("family", [currentSchema, melSchema]);
export type OptimizerParameters = z.infer<typeof optimizerParametersSchema>;
export type OptimizerFamily = OptimizerParameters["family"];
export const baselineParameters = (family: OptimizerFamily): OptimizerParameters =>
  family === "current"
    ? {
        family,
        minimumRms: DEFAULT_DETECTOR_SETTINGS.minimumRms,
        contrastRatio: DEFAULT_DETECTOR_SETTINGS.contrastRatio,
        minSeparationMs: DEFAULT_DETECTOR_SETTINGS.minSeparationMs,
        recoverySeconds: DEFAULT_DETECTOR_SETTINGS.recoverySeconds,
        frequencyBalance: 100,
      }
    : { family, ...DEFAULT_MEL_SETTINGS };
/** Explicit order is the final numerical tie break and canonical configuration identity. */
const keys = {
  current: [
    "minimumRms",
    "contrastRatio",
    "minSeparationMs",
    "recoverySeconds",
    "frequencyBalance",
  ],
  mel: ["windowMs", "bands", "neighbor", "confirmation", "rearming", "threshold"],
} as const;
export function parameterKey(p: OptimizerParameters) {
  return JSON.stringify([
    p.family,
    ...keys[p.family].map((k) => (p as unknown as Record<string, unknown>)[k]),
  ]);
}
function compareParameters(a: OptimizerParameters, b: OptimizerParameters) {
  const av = JSON.parse(parameterKey(a)) as (string | number | boolean)[],
    bv = JSON.parse(parameterKey(b)) as (string | number | boolean)[];
  for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return av[i] < bv[i] ? -1 : 1;
  return 0;
}
const summarySchema = z.strictObject({
  errorsPerSecond: z.number().nonnegative().nullable(),
  meanAbsoluteMs: z.number().nonnegative().nullable(),
  biasMs: z.number().nullable(),
  missingTimingGroups: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  extra: z.number().int().nonnegative(),
  seconds: z.number().nonnegative(),
  recordings: z.number().int().nonnegative(),
  evidence: z.string().max(32),
});
export type OptimizerScore = z.infer<typeof summarySchema>;
const resolvedSchema = z.strictObject({
  sampleRate: z.number().int().min(8000).max(192000),
  windowFrames: z.number().int().positive(),
  hopFrames: z.number().int().positive(),
  reliableFromFrame: z.number().int().nonnegative(),
});
const trialSchema = z.strictObject({
  order: z.number().int().nonnegative(),
  phase: z.enum(["baseline", "starting", "broad", "refine"]),
  parameters: optimizerParametersSchema,
  resolved: z.array(resolvedSchema).max(100),
  score: summarySchema.nullable(),
  invalid: z.string().max(512).optional(),
});
export type OptimizerTrial = z.infer<typeof trialSchema>;
export const optimizerRunSchema = z.strictObject({
  format: z.literal("forgettime-optimizer-run"),
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  version: z.enum(["seeded-grid-v1", "seeded-grid-v2"]),
  build: z.string().regex(/^[a-f0-9]{64}$/),
  scoring: z.literal(TRAINING_SCORING_VERSION),
  envelope: z.literal(ENVELOPE_VERSION),
  family: z.enum(["current", "mel"]),
  mode: z.enum(["quick", "deep"]),
  seed: z.number().int().min(0).max(0xffffffff),
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  comparisonFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  assignments: z.record(z.string(), z.enum(["training", "withheld", "unassigned"])),
  status: z.enum(["completed", "cancelled", "stale", "failed"]),
  trials: z.array(trialSchema).max(500),
  bestOrder: z.number().int().nonnegative().nullable(),
  improved: z.boolean(),
  elapsedMs: z.number().nonnegative(),
  failure: z.string().max(512).optional(),
  frozenOrder: z.number().int().nonnegative().nullable(),
  withheld: summarySchema.nullable(),
});
export type OptimizerRun = z.infer<typeof optimizerRunSchema>;
export interface OptimizerProgress {
  completed: number;
  budget: number;
  elapsedMs: number;
  best: OptimizerScore | null;
}
export interface OptimizerControl {
  cancelled?: () => boolean;
  stale?: () => boolean;
  yield?: () => Promise<void>;
  progress?: (progress: OptimizerProgress) => void;
}
const yieldTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function summary(s: DatasetScore): OptimizerScore {
  return {
    errorsPerSecond: s.errorsPerSecond,
    meanAbsoluteMs: s.meanAbsoluteMs,
    biasMs: s.biasMs,
    missingTimingGroups: s.missingTimingGroups,
    matched: s.sources.reduce((n, x) => n + x.matched, 0),
    missing: s.sources.reduce((n, x) => n + x.missing, 0),
    extra: s.sources.reduce((n, x) => n + x.extra, 0),
    seconds: s.sources.reduce((n, x) => n + x.evaluatedSeconds, 0),
    recordings: s.recordings.filter((r) => r.evaluatedSeconds > 0).length,
    evidence: s.evidence,
  };
}
/** Mulberry32, uint32 seed; finite decimal grids are pinned in this version. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const round = (n: number, step: number) => Math.round(n / step) * step;
function sample(
  family: OptimizerFamily,
  rng: () => number,
  best?: OptimizerParameters,
): OptimizerParameters {
  const local = (key: string, min: number, max: number, step: number, log = false) => {
    const old = best && (best as unknown as Record<string, number>)[key];
    const n =
      old === undefined
        ? log
          ? Math.exp(Math.log(min) + rng() * Math.log(max / min))
          : min + rng() * (max - min)
        : old + (rng() * 2 - 1) * (max - min) * 0.1;
    return Number(clamp(round(n, step), min, max).toFixed(6));
  };
  if (family === "current")
    return {
      family,
      minimumRms: local("minimumRms", 0.001, 0.1, 0.001, true),
      contrastRatio: local("contrastRatio", 1.1, 4, 0.1),
      minSeparationMs: local("minSeparationMs", 8, 100, 1),
      recoverySeconds: local("recoverySeconds", 0.25, 12, 0.25, true),
      frequencyBalance: local("frequencyBalance", 0, 100, 1),
    };
  const pick = <T>(key: string, values: readonly T[]): T => {
    const previous = best && (best as unknown as Record<string, unknown>)[key];
    if (previous !== undefined && rng() < 0.7) return previous as T;
    return values[Math.floor(rng() * values.length)];
  };
  return {
    family,
    windowMs: pick("windowMs", [10, 20, 40] as const),
    bands: pick("bands", [24, 48, 96] as const),
    neighbor: pick("neighbor", [1, 3, 5] as const),
    confirmation: pick("confirmation", [0, 1, 2] as const),
    rearming: pick("rearming", [false, true]),
    threshold: local("threshold", 0.5, 4, 0.05),
  };
}
function sizes(rate: number, p: OptimizerParameters) {
  const windowFrames =
    p.family === "mel"
      ? Math.max(128, Math.min(8192, 2 ** Math.round(Math.log2((rate * p.windowMs) / 1000))))
      : Math.max(32, Math.round(rate * 0.002667));
  const hopFrames = p.family === "mel" ? Math.max(1, Math.round(rate * 0.0025)) : windowFrames;
  return {
    sampleRate: rate,
    windowFrames,
    hopFrames,
    reliableFromFrame:
      p.family === "mel"
        ? Math.floor((windowFrames - 1) / 2 + Math.ceil((rate * 0.1) / hopFrames) * hopFrames)
        : 13 * windowFrames,
  };
}
/** Same conservative startup/tail envelope for both families and every permitted parameter. */
export async function optimizerPlan(dataset: TrainingDataset) {
  const coverage = dataset.manifest.sources.map((s) => {
    const maxWindow = sizes(s.sampleRate, {
        family: "mel",
        ...DEFAULT_MEL_SETTINGS,
        windowMs: 40,
      }).windowFrames,
      hop = Math.max(1, Math.round(s.sampleRate * 0.0025)),
      current = sizes(s.sampleRate, baselineParameters("current")).windowFrames;
    const first = Math.max(maxWindow + Math.ceil(s.sampleRate * 0.1) + 2 * hop, 13 * current),
      last = Math.min(Math.floor(s.frames / current) * current, s.frames - maxWindow - 3 * hop - 2);
    return {
      sourceChecksum: s.checksum,
      configuration: `${ENVELOPE_VERSION}:${OPTIMIZER_BUILD}`,
      reliableFromFrame: last < first ? s.frames : first,
      processedThroughFrame: last < first ? s.frames : last,
    };
  });
  return createTrainingEvaluationPlan(
    dataset.manifest,
    [`${ENVELOPE_VERSION}:${OPTIMIZER_BUILD}`],
    coverage,
  );
}
class Interrupted extends Error {}
function check(control: OptimizerControl) {
  if (control.stale?.() || control.cancelled?.()) throw new Interrupted();
}
async function analyze(
  dataset: TrainingDataset,
  plan: TrainingEvaluationPlan,
  p: OptimizerParameters,
  assignment: "training" | "withheld",
  control: OptimizerControl,
) {
  const onsets: Record<string, number[]> = {},
    resolved = new Map<number, ReturnType<typeof sizes>>();
  for (const source of plan.sources) {
    if (plan.assignments[source.groupId] !== assignment) continue;
    check(control);
    const rate = source.sampleRate,
      pcm = dataset.audio[source.checksum],
      events: number[] = [];
    const spec = sizes(rate, p);
    resolved.set(rate, spec);
    const current =
      p.family === "current"
        ? new OnsetDetector(
            {
              version: 1,
              minimumRms: p.minimumRms,
              contrastRatio: p.contrastRatio,
              minSeparationMs: p.minSeparationMs,
              recoverySeconds: p.recoverySeconds,
            },
            p.frequencyBalance,
          )
        : null;
    const mel =
      p.family === "mel"
        ? new MelDetector({
            windowMs: p.windowMs,
            bands: p.bands,
            neighbor: p.neighbor,
            confirmation: p.confirmation,
            rearming: p.rearming,
            threshold: p.threshold,
          })
        : null;
    for (let offset = 0; offset < pcm.length; offset += 4096) {
      check(control);
      const end = Math.min(pcm.length, offset + 4096);
      if (current) {
        events.push(
          ...current
            .process(pcm.subarray(offset, end), offset / rate, rate)
            .map((h) => h.time * rate),
        );
        current.drainDiagnostics();
      } else
        for (let i = offset; i < end; i++) {
          const hit = mel!.process(pcm[i], i, rate);
          if (hit) events.push(hit.sourceFrame);
        }
      if (events.length > 20000) throw new Error("Detected attack limit exceeded");
      await (control.yield ?? yieldTurn)();
    }
    check(control);
    const through = current
      ? Math.floor((current.processedThrough ?? 0) * rate + 1e-6)
      : mel!.state.processedThroughFrame;
    if (source.evaluated.some((r) => r.endFrame > through || r.startFrame < spec.reliableFromFrame))
      throw new Error("Detector coverage violates the fixed search envelope");
    onsets[source.checksum] = events;
  }
  return {
    score: evaluateTrainingOnsets(
      plan,
      `${ENVELOPE_VERSION}:${OPTIMIZER_BUILD}`,
      onsets,
      assignment,
    ),
    resolved: [...resolved.values()].sort((a, b) => a.sampleRate - b.sampleRate),
  };
}
export async function optimizeTraining(
  input: TrainingDataset,
  options: {
    family: OptimizerFamily;
    mode: "quick" | "deep";
    seed: number;
    starting?: OptimizerParameters;
  },
  control: OptimizerControl = {},
): Promise<OptimizerRun> {
  if (
    !["current", "mel"].includes(options.family) ||
    !["quick", "deep"].includes(options.mode) ||
    !Number.isInteger(options.seed) ||
    options.seed < 0 ||
    options.seed > 0xffffffff
  )
    throw new Error("Invalid search options");
  if (
    options.starting &&
    optimizerParametersSchema.parse(options.starting).family !== options.family
  )
    throw new Error("Starting configuration must use the selected family");
  if (OPTIMIZER_BUILD === "unbundled")
    throw new Error("A fingerprinted optimizer build is required");
  const dataset = await validateTrainingDataset(input);
  if (
    dataset.manifest.groups.some(
      (g) =>
        g.assignment === "unassigned" &&
        dataset.manifest.examples.some((e) => g.sourceChecksums.includes(e.sourceChecksum)),
    )
  )
    throw new Error("Assign recording groups before optimization");
  const plan = await optimizerPlan(dataset),
    fingerprint = await trainingFingerprint(dataset.manifest),
    budget = options.mode === "quick" ? 100 : 500,
    broad = Math.floor(budget * 0.7),
    rng = random(options.seed),
    start = performance.now();
  const run: OptimizerRun = {
    format: "forgettime-optimizer-run",
    schemaVersion: 1,
    id: crypto.randomUUID(),
    version: OPTIMIZER_VERSION,
    build: OPTIMIZER_BUILD,
    scoring: TRAINING_SCORING_VERSION,
    envelope: ENVELOPE_VERSION,
    family: options.family,
    mode: options.mode,
    seed: options.seed,
    inputFingerprint: fingerprint,
    comparisonFingerprint: plan.fingerprint,
    assignments: plan.assignments,
    status: "completed",
    trials: [],
    bestOrder: null,
    improved: false,
    elapsedMs: 0,
    frozenOrder: null,
    withheld: null,
  };
  let best: DatasetScore | null = null,
    baseline: DatasetScore | null = null;
  const seen = new Set<string>();
  try {
    for (let i = 0; i < budget; i++) {
      check(control);
      const phase =
        i === 0
          ? "baseline"
          : i === 1 && options.starting
            ? "starting"
            : i < broad
              ? "broad"
              : "refine";
      let p =
        i === 0
          ? options.starting ?? baselineParameters(options.family)
          : phase === "starting"
            ? baselineParameters(options.family)
            : sample(
                options.family,
                rng,
                i >= broad && run.bestOrder !== null
                  ? run.trials[run.bestOrder].parameters
                  : undefined,
              );
      // At most 32 deterministic resamples; exhaustion still consumes a bounded trial.
      for (let attempts = 0; i > 1 && seen.has(parameterKey(p)) && attempts < 32; attempts++)
        p = sample(
          options.family,
          rng,
          i >= broad && run.bestOrder !== null ? run.trials[run.bestOrder].parameters : undefined,
        );
      seen.add(parameterKey(p));
      const rates = [
        ...new Set(
          plan.sources
            .filter((s) => plan.assignments[s.groupId] === "training")
            .map((s) => s.sampleRate),
        ),
      ].sort((a, b) => a - b);
      const trial: OptimizerTrial = {
        order: i,
        phase,
        parameters: p,
        resolved: rates.map((rate) => sizes(rate, p)),
        score: null,
      };
      try {
        const result = await analyze(dataset, plan, p, "training", control);
        if (result.score.errorsPerSecond === null)
          throw new Error("No ordinary reviewed training time; inspect context and coverage");
        trial.score = summary(result.score);
        trial.resolved = result.resolved;
        if (i === 0) baseline = result.score;
        if (
          !best ||
          compareTrainingScores(result.score, best) < 0 ||
          (compareTrainingScores(result.score, best) === 0 &&
            compareParameters(p, run.trials[run.bestOrder!].parameters) < 0)
        ) {
          best = result.score;
          run.bestOrder = i;
        }
      } catch (e) {
        if (e instanceof Interrupted) throw e;
        trial.invalid = String((e as Error).message).slice(0, 512);
        if (i === 0) {
          run.trials.push(trial);
          throw e;
        }
      }
      run.trials.push(trial);
      run.elapsedMs = performance.now() - start;
      control.progress?.({
        completed: run.trials.length,
        budget,
        elapsedMs: run.elapsedMs,
        best: run.bestOrder === null ? null : run.trials[run.bestOrder].score,
      });
      await (control.yield ?? yieldTurn)();
    }
  } catch (e) {
    run.status = e instanceof Interrupted ? (control.stale?.() ? "stale" : "cancelled") : "failed";
    if (!(e instanceof Interrupted)) run.failure = String((e as Error).message).slice(0, 512);
  }
  run.elapsedMs = performance.now() - start;
  run.improved = Boolean(best && baseline && compareTrainingScores(best, baseline) < 0);
  return optimizerRunSchema.parse(run);
}
export function validateOptimizerRun(input: unknown): OptimizerRun {
  const run = optimizerRunSchema.parse(input),
    budget = run.mode === "quick" ? 100 : 500;
  if (
    run.trials.some(
      (t, i) =>
        t.order !== i ||
        t.parameters.family !== run.family ||
        Boolean(t.score) === Boolean(t.invalid),
    ) ||
    run.trials.length > budget ||
    (run.status === "completed" && run.trials.length !== budget) ||
    (run.bestOrder !== null && !run.trials[run.bestOrder]?.score) ||
    (run.frozenOrder !== null && run.frozenOrder !== run.bestOrder)
  )
    throw new Error("Invalid optimizer trial sequence or candidate");
  return run;
}
export function freezeOptimizerCandidate(input: OptimizerRun): OptimizerRun {
  const run = validateOptimizerRun(input);
  if (
    run.bestOrder === null ||
    !run.trials[run.bestOrder]?.score ||
    run.status === "stale" ||
    run.status === "failed" ||
    run.build !== OPTIMIZER_BUILD
  )
    throw new Error("Freeze requires a fully evaluated current candidate");
  return { ...run, frozenOrder: run.bestOrder };
}
export async function evaluateOptimizerWithheld(
  input: TrainingDataset,
  record: OptimizerRun,
  control: OptimizerControl = {},
): Promise<OptimizerRun> {
  const run = validateOptimizerRun(record),
    dataset = await validateTrainingDataset(input);
  if (
    run.build !== OPTIMIZER_BUILD ||
    run.status === "stale" ||
    run.status === "failed" ||
    run.frozenOrder === null ||
    run.frozenOrder !== run.bestOrder ||
    (await trainingFingerprint(dataset.manifest)) !== run.inputFingerprint
  )
    throw new Error("Freeze a current candidate before explicit withheld evaluation");
  const plan = await optimizerPlan(dataset);
  if (plan.fingerprint !== run.comparisonFingerprint) throw new Error("Comparison plan changed");
  const result = await analyze(
    dataset,
    plan,
    run.trials[run.frozenOrder].parameters,
    "withheld",
    control,
  );
  check(control);
  return { ...run, withheld: summary(result.score) };
}
