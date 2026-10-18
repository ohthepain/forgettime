import { expect, it } from "vite-plus/test";
import { createTrainingSource, trainingExampleId, trainingFingerprint } from "./training-contract";
import { emptyTrainingDataset, type TrainingDataset } from "./training-transfer";
import {
  baselineParameters,
  optimizeTraining,
  optimizerPlan,
  freezeOptimizerCandidate,
  evaluateOptimizerWithheld,
  validateOptimizerRun,
} from "./training-optimizer";
import { encodeOptimizerRun, parseOptimizerRun } from "./training-optimizer-records";
import { createTrainingRepository, type TrainingSnapshot } from "./training-dataset";
async function fixture(rate = 8000): Promise<TrainingDataset> {
  const dataset = emptyTrainingDataset(),
    samples = new Float32Array(rate);
  const { source } = await createTrainingSource([samples], rate, {
    kind: "import",
    beginningAvailable: true,
    endAvailable: true,
  });
  const bar = { startFrame: 0, endFrame: Math.round(rate * 0.8) };
  dataset.manifest.sources.push(source);
  dataset.audio[source.checksum] = samples;
  dataset.manifest.groups.push({
    id: "one",
    sourceChecksums: [source.checksum],
    assignment: "training",
  });
  dataset.manifest.examples.push({
    id: trainingExampleId(source.checksum, bar),
    sourceChecksum: source.checksum,
    bar,
    reference: { bpm: 300, beatOneFrame: 0, meter: [4, 4] },
    desiredFrames: [],
    uncertain: [],
    reviewed: true,
  });
  return dataset;
}
const immediate = async () => {};
it("reproduces quick ordered trials and scores with a baseline, fixed envelopes and stable no-improvement ties", async () => {
  const data = await fixture(),
    options = { family: "current" as const, mode: "quick" as const, seed: 42 };
  const a = await optimizeTraining(data, options, { yield: immediate }),
    b = await optimizeTraining(data, options, { yield: immediate });
  expect(a.status).toBe("completed");
  expect(a.trials).toHaveLength(100);
  expect(a.trials[0].parameters).toEqual(baselineParameters("current"));
  expect(a.trials).toEqual(b.trials);
  expect(a.bestOrder).toBe(b.bestOrder);
  expect(a.improved).toBe(false);
  expect(a.trials.filter((t) => t.phase === "refine")).toHaveLength(30);
  expect(a.trials.map((t) => t.score?.seconds)).toEqual(
    Array(100).fill(a.trials[0].score!.seconds),
  );
  expect(a.comparisonFingerprint).toBe(b.comparisonFingerprint);
  expect(JSON.stringify(a)).not.toContain("desiredFrames");
  expect(parseOptimizerRun(encodeOptimizerRun(a))).toEqual(a);
});
it("cancels a partial trial without ranking it and uses a bounded Deep budget", async () => {
  const data = await fixture();
  let progress = 0,
    calls = 0,
    cancel = false;
  const run = await optimizeTraining(
    data,
    { family: "current", mode: "deep", seed: 2 },
    {
      yield: async () => {
        if (progress === 1 && ++calls === 1) cancel = true;
      },
      cancelled: () => cancel,
      progress: (p) => {
        progress = p.completed;
        expect(p.budget).toBe(500);
      },
    },
  );
  expect(run.status).toBe("cancelled");
  expect(run.trials).toHaveLength(1);
  expect(run.bestOrder).toBe(0);
});
it("marks changed inputs stale and forbids freezing stale results", async () => {
  const data = await fixture();
  let stale = false;
  const run = await optimizeTraining(
    data,
    { family: "current", mode: "quick", seed: 2 },
    {
      yield: immediate,
      stale: () => stale,
      progress: () => {
        stale = true;
      },
    },
  );
  expect(run.status).toBe("stale");
  expect(run.trials).toHaveLength(1);
  expect(() => freezeOptimizerCandidate(run)).toThrow("current");
});
it("separates withheld evaluation, requires freeze and rejects changed annotations/builds", async () => {
  const data = await fixture(),
    other = await createTrainingSource(
      [Float32Array.from({ length: 8000 }, (_, i) => (i === 1 ? 0.001 : 0))],
      8000,
      { kind: "import", beginningAvailable: true, endAvailable: true },
    );
  data.manifest.sources.push(other.source);
  data.audio[other.source.checksum] = other.samples;
  data.manifest.groups.push({
    id: "two",
    sourceChecksums: [other.source.checksum],
    assignment: "withheld",
  });
  const example = structuredClone(data.manifest.examples[0]);
  example.sourceChecksum = other.source.checksum;
  example.id = trainingExampleId(example.sourceChecksum, example.bar);
  data.manifest.examples.push(example);
  let done = false;
  const run = await optimizeTraining(
    data,
    { family: "current", mode: "quick", seed: 2 },
    {
      yield: immediate,
      cancelled: () => done,
      progress: () => {
        done = true;
      },
    },
  );
  expect(run.trials[0].score!.recordings).toBe(1);
  expect(run.withheld).toBeNull();
  await expect(evaluateOptimizerWithheld(data, run, { yield: immediate })).rejects.toThrow(
    "Freeze",
  );
  const frozen = freezeOptimizerCandidate(run),
    evaluated = await evaluateOptimizerWithheld(data, frozen, { yield: immediate });
  expect(evaluated.withheld!.recordings).toBe(1);
  expect(evaluated.trials).toEqual(run.trials);
  data.manifest.examples[0].desiredFrames = [2400];
  await expect(evaluateOptimizerWithheld(data, frozen, { yield: immediate })).rejects.toThrow(
    "current",
  );
  await expect(
    evaluateOptimizerWithheld(
      await fixture(),
      { ...frozen, build: "0".repeat(64) },
      { yield: immediate },
    ),
  ).rejects.toThrow("Freeze");
});
it("runs a real mel baseline with exact resolved source lengths and rejects illegal configurations", async () => {
  const data = await fixture(48000);
  let done = false;
  const run = await optimizeTraining(
    data,
    { family: "mel", mode: "quick", seed: 3 },
    {
      yield: immediate,
      cancelled: () => done,
      progress: () => {
        done = true;
      },
    },
  );
  expect(run.failure).toBeUndefined();
  expect(run.trials[0].score).not.toBeNull();
  expect(run.trials[0].resolved[0]).toMatchObject({
    sampleRate: 48000,
    windowFrames: 1024,
    hopFrames: 120,
  });
  const illegal = await optimizeTraining(
    await fixture(8000),
    { family: "mel", mode: "quick", seed: 3 },
    { yield: immediate, cancelled: () => done },
  );
  // Cancellation before the baseline has no scored candidate.
  expect(illegal.bestOrder).toBeNull();
  done = false;
  const bad = await optimizeTraining(
    await fixture(8000),
    {
      family: "mel",
      mode: "quick",
      seed: 3,
      starting: {
        family: "mel",
        windowMs: 10,
        bands: 96,
        neighbor: 5,
        confirmation: 2,
        rearming: true,
        threshold: 4,
      },
    },
    {
      yield: immediate,
      cancelled: () => done,
      progress: (p) => {
        if (p.completed === 2) done = true;
      },
    },
  );
  expect(bad.trials.some((t) => t.invalid)).toBe(true);
});
it("rejects unassigned inputs, invalid seeds and malformed records, and preserves split assignments atomically", async () => {
  const data = await fixture();
  data.manifest.groups[0].assignment = "unassigned";
  await expect(
    optimizeTraining(data, { family: "current", mode: "quick", seed: 1 }, { yield: immediate }),
  ).rejects.toThrow("Assign");
  await expect(
    optimizeTraining(data, { family: "current", mode: "quick", seed: -1 }),
  ).rejects.toThrow("options");
  let stored: TrainingSnapshot | null = null;
  const repo = createTrainingRepository({
    read: async () => structuredClone(stored),
    compareAndSwap: async (expected, next) => {
      if (expected !== (stored?.token ?? null)) throw new Error("race");
      stored = structuredClone(next);
    },
  });
  await repo.add(data);
  const before = await repo.read();
  await repo.assignGroups(before.fingerprint, 123);
  const assigned = await repo.read();
  expect(assigned.dataset.manifest.groups[0].assignment).toBe("training");
  await repo.assignGroups(assigned.fingerprint, 456);
  expect((await repo.read()).fingerprint).toBe(assigned.fingerprint);
  await expect(repo.assignGroups(before.fingerprint, 2)).rejects.toThrow("changed");
  const plan = await optimizerPlan(assigned.dataset);
  expect(plan.fingerprint).not.toBe(await trainingFingerprint(assigned.dataset.manifest));
  const run = await optimizeTraining(
    assigned.dataset,
    { family: "current", mode: "quick", seed: 1 },
    { yield: immediate, cancelled: () => true },
  );
  expect(() => validateOptimizerRun({ ...run, bestOrder: 10 })).toThrow("sequence");
});

it("records an explicit starting configuration and rejects oversized or annotation-bearing history", async () => {
  const data = await fixture();
  let done = false;
  const baseline = baselineParameters("current");
  if (baseline.family !== 'current') throw new Error('Expected current baseline');
  const starting = {
    ...baseline,
    family: "current" as const,
    minimumRms: 0.1,
  };
  const run = await optimizeTraining(
    data,
    { family: "current", mode: "quick", seed: 1, starting },
    {
      yield: immediate,
      cancelled: () => done,
      progress: (p) => {
        if (p.completed === 2) done = true;
      },
    },
  );
  expect(run.trials[1]).toMatchObject({ phase: "starting", parameters: starting });
  expect(() => parseOptimizerRun(JSON.stringify({ ...run, desiredFrames: [123] }))).toThrow();
  const large = {
    ...run,
    mode: "deep" as const,
    trials: Array.from({ length: 500 }, (_, i) => ({
      ...run.trials[0],
      order: i,
      phase: i === 0 ? ("baseline" as const) : ("broad" as const),
      resolved: Array.from({ length: 100 }, (_, j) => ({
        sampleRate: 8000 + j,
        windowFrames: 32,
        hopFrames: 32,
        reliableFromFrame: 416,
      })),
    })),
  };
  expect(() => encodeOptimizerRun(large)).toThrow("2 MiB");
});
