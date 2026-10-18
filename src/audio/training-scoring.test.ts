import { describe, expect, it } from "vite-plus/test";
import {
  createTrainingSource,
  trainingExampleId,
  type TrainingManifest,
} from "./training-contract";
import {
  assignTrainingGroups,
  compareTrainingScores,
  createTrainingEvaluationPlan,
  evaluateTrainingOnsets,
  matchTrainingOnsets,
  unionFrameRanges,
  type AnalysisCoverage,
} from "./training-scoring";
async function fixture(count = 1) {
  const m: TrainingManifest = {
    format: "forgettime-training",
    schemaVersion: 1,
    sources: [],
    groups: [],
    examples: [],
  };
  for (let i = 0; i < count; i++) {
    const pcm = new Float32Array(32000);
    pcm[1] = i + 1;
    const { source } = await createTrainingSource([pcm], 8000, {
      kind: "import",
      beginningAvailable: true,
      endAvailable: true,
    });
    m.sources.push(source);
    m.groups.push({
      id: "recording-" + i,
      sourceChecksums: [source.checksum],
      assignment: "training",
    });
    const bar = { startFrame: 0, endFrame: 16000 };
    m.examples.push({
      id: trainingExampleId(source.checksum, bar),
      sourceChecksum: source.checksum,
      bar,
      reference: { bpm: 120, beatOneFrame: 0, meter: [4, 4] },
      desiredFrames: [4000, 8000, 12000],
      uncertain: [],
      reviewed: true,
    });
  }
  return m;
}
function coverage(m: TrainingManifest, from = 0, through = 32000): AnalysisCoverage[] {
  return m.sources.flatMap((s) =>
    ["baseline", "candidate"].map((configuration) => ({
      sourceChecksum: s.checksum,
      configuration,
      reliableFromFrame: from,
      processedThroughFrame: Math.min(through, s.frames),
    })),
  );
}
async function plan(m: TrainingManifest, from = 0, through = 32000) {
  return createTrainingEvaluationPlan(m, ["baseline", "candidate"], coverage(m, from, through));
}
// Independent exhaustive reference for tiny matching cases, including crossed assignments.
function exhaustive(a: number[], b: number[], t: number) {
  let best = { count: 0, error: 0 };
  function walk(i: number, used: Set<number>, count: number, error: number) {
    if (i === a.length) {
      if (count > best.count || (count === best.count && error < best.error))
        best = { count, error };
      return;
    }
    walk(i + 1, used, count, error);
    for (let j = 0; j < b.length; j++)
      if (!used.has(j) && Math.abs(a[i] - b[j]) <= t) {
        used.add(j);
        walk(i + 1, used, count + 1, error + Math.abs(a[i] - b[j]));
        used.delete(j);
      }
  }
  walk(0, new Set(), 0, 0);
  return best;
}
describe("authoritative onset matching", () => {
  it("maximizes matches instead of greedily stealing the only match for a later hit", () => {
    const s = matchTrainingOnsets([200, 400], [50, 250], 8000);
    expect(s.matched).toBe(2);
    expect(s.matches.map((m) => m.detectedFrame)).toEqual([50, 250]);
  });
  it("minimizes absolute error after cardinality and counts duplicate calculated attacks as extras", () => {
    const s = matchTrainingOnsets([1000], [900, 1001, 1001], 8000);
    expect(s.matches[0].errorMs).toBe(0.125);
    expect(s.extra).toBe(2);
    expect(s.meanAbsoluteMs).toBe(0.125);
    expect(s.biasMs).toBe(0.125);
  });
  it("includes exact +/-20ms edges and supports empty/silent observations without fake zero timing", () => {
    expect(matchTrainingOnsets([1000, 2000], [840, 2160], 8000).matched).toBe(2);
    expect(matchTrainingOnsets([1000], [1160.01], 8000).missing).toBe(1);
    expect(matchTrainingOnsets([], [], 48000)).toMatchObject({
      matched: 0,
      missing: 0,
      extra: 0,
      meanAbsoluteMs: null,
      biasMs: null,
    });
    expect(() => matchTrainingOnsets([1, 1], [], 8000)).toThrow();
    expect(() => matchTrainingOnsets([0.5], [], 8000)).toThrow();
    expect(() => matchTrainingOnsets([], [NaN], 8000)).toThrow();
  });
  it("agrees with exhaustive optimal matching across deterministic dense tiny cases", () => {
    let seed = 7;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed >>> 0) % 600;
    };
    for (let run = 0; run < 100; run++) {
      const a = [...new Set([rand(), rand(), rand(), rand()])].sort((a, b) => a - b),
        b = [rand(), rand(), rand(), rand()].sort((a, b) => a - b),
        ref = exhaustive(a, b, 160),
        s = matchTrainingOnsets(a, b, 8000);
      expect(s.matched).toBe(ref.count);
      expect(s.matches.reduce((n, m) => n + Math.abs(m.detectedFrame - m.desiredFrame), 0)).toBe(
        ref.error,
      );
    }
  });
});
describe("source evaluation masks", () => {
  it("owns boundary attacks once, unions overlapping reviewed bars, and counts duration once", async () => {
    const m = await fixture(),
      e = m.examples[0];
    e.desiredFrames = [4000, 8000, 12000];
    const second = {
      ...structuredClone(e),
      bar: { startFrame: 16000, endFrame: 32000 },
      desiredFrames: [16000, 24000],
    };
    second.id = trainingExampleId(e.sourceChecksum, second.bar);
    m.examples.push(second);
    const p = await plan(m),
      s = evaluateTrainingOnsets(
        p,
        "baseline",
        { [e.sourceChecksum]: [4000, 8000, 12000, 16000, 24000] },
        "training",
      );
    expect(s.sources[0].matched).toBe(5);
    expect(s.sources[0].evaluatedSeconds).toBe(4);
    expect(
      unionFrameRanges([
        { startFrame: 0, endFrame: 10 },
        { startFrame: 5, endFrame: 20 },
      ]),
    ).toEqual([{ startFrame: 0, endFrame: 20 }]);
  });
  it("rejects contradictory labels across overlapping reviewed bars", async () => {
    const m = await fixture(),
      e = m.examples[0];
    const bar = { startFrame: 100, endFrame: 16100 };
    m.examples.push({
      ...structuredClone(e),
      bar,
      id: trainingExampleId(e.sourceChecksum, bar),
      reference: { ...e.reference, beatOneFrame: 100 },
      desiredFrames: [4000, 8000],
    });
    await expect(plan(m)).rejects.toThrow("Conflicting");
  });
  it("excludes uncertainty plus tolerance on both desired and calculated markers, and discloses duration", async () => {
    const m = await fixture(),
      e = m.examples[0];
    e.uncertain = [{ startFrame: 7900, endFrame: 8100 }];
    const p = await plan(m),
      s = evaluateTrainingOnsets(
        p,
        "candidate",
        { [e.sourceChecksum]: [4000, 8000, 8259, 12000] },
        "training",
      ).sources[0];
    expect(s.matched).toBe(2);
    expect(s.extra).toBe(0);
    expect(s.excludedDesired).toBe(1);
    expect(s.excludedDetections).toBe(2);
    expect(s.excludedSeconds).toBe(520 / 8000);
    expect(s.evaluatedSeconds).toBe(2 - 520 / 8000);
  });
  it("uses the same maximum startup/minimum terminal mask for every compared configuration", async () => {
    const m = await fixture(),
      e = m.examples[0],
      c = coverage(m);
    c[0].reliableFromFrame = 4500;
    c[1].processedThroughFrame = 11900;
    const p = await createTrainingEvaluationPlan(m, ["baseline", "candidate"], c);
    for (const name of ["baseline", "candidate"]) {
      const s = evaluateTrainingOnsets(
        p,
        name,
        { [e.sourceChecksum]: [4000, 8000, 12000] },
        "training",
      ).sources[0];
      expect(s.matched).toBe(1);
      expect(s.evaluatedSeconds).toBe((11900 - 4500) / 8000);
      expect(s.excludedDesired).toBe(2);
    }
    await expect(
      createTrainingEvaluationPlan(m, ["baseline", "candidate"], c.slice(1)),
    ).rejects.toThrow("coverage");
  });
  it("reports cropped prehistory and fully excluded/unreviewed material as unavailable, never perfect", async () => {
    const m = await fixture(),
      e = m.examples[0];
    m.sources[0].provenance.beginningAvailable = false;
    const p = await plan(m),
      s = evaluateTrainingOnsets(p, "baseline", { [e.sourceChecksum]: [] }, "training");
    expect(s.errorsPerSecond).toBeNull();
    expect(s.sources[0].excludedSeconds).toBe(2);
    expect(s.evidence).toBe("unavailable");
    e.reviewed = false;
    const empty = await plan(m);
    expect(empty.sources).toEqual([]);
  });
  it("rejects missing detector results but accepts an explicit empty observation", async () => {
    const m = await fixture(),
      p = await plan(m);
    expect(() => evaluateTrainingOnsets(p, "baseline", {}, "training")).toThrow("Missing");
    expect(
      evaluateTrainingOnsets(p, "baseline", { [m.sources[0].checksum]: [] }, "training")
        .recordings[0].missing,
    ).toBe(3);
  });
  it("deduplicates a known excerpt on its ancestor timeline without rewarding extra duration", async () => {
    const m = await fixture(),
      original = m.sources[0],
      e = m.examples[0];
    const { source } = await createTrainingSource([new Float32Array(16000)], 8000, {
      kind: "import",
      ancestorChecksum: original.checksum,
      ancestorStartFrame: 0,
      beginningAvailable: true,
      endAvailable: true,
    });
    m.sources.push(source);
    m.groups[0].sourceChecksums.push(source.checksum);
    m.examples.push({
      ...structuredClone(e),
      sourceChecksum: source.checksum,
      id: trainingExampleId(source.checksum, e.bar),
    });
    const p = await plan(m);
    const s = evaluateTrainingOnsets(
      p,
      "baseline",
      { [original.checksum]: e.desiredFrames, [source.checksum]: e.desiredFrames },
      "training",
    );
    expect(s.recordings[0].evaluatedSeconds).toBe(2);
    expect(s.recordings[0].matched).toBe(3);
    expect(s.sources.find((s) => s.checksum === source.checksum)?.excludedSeconds).toBe(2);
  });
});
describe("recording weights, ranking and holdout", () => {
  it("rejects holdout leakage through a common ancestor that is not retained", async () => {
    const m = await fixture(2);
    for (const source of m.sources) {
      source.provenance.ancestorChecksum = "a".repeat(64);
      source.provenance.ancestorStartFrame = 0;
    }
    m.groups[1].assignment = "withheld";
    expect(() => assignTrainingGroups(m, 42)).toThrow("Related recordings");
    await expect(plan(m)).rejects.toThrow("Related recordings");
  });
  it("makes comparison masks immutable and fingerprints sensitive to coverage", async () => {
    const m = await fixture(),
      a = await plan(m),
      b = await plan(m, 100);
    expect(Object.isFrozen(a.sources[0].evaluated)).toBe(true);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("averages recording rates, not pooled seconds; reports timing bias independently", async () => {
    const m = await fixture(2),
      a = m.examples[0],
      b = m.examples[1];
    const second = {
      ...structuredClone(a),
      bar: { startFrame: 16000, endFrame: 32000 },
      desiredFrames: [16000],
    };
    second.id = trainingExampleId(a.sourceChecksum, second.bar);
    m.examples.push(second);
    const p = await plan(m),
      s = evaluateTrainingOnsets(
        p,
        "baseline",
        { [a.sourceChecksum]: [4000, 8000, 12000], [b.sourceChecksum]: [4008, 8008] },
        "training",
      );
    expect(s.errorsPerSecond).toBe((1 / 4 + 1 / 2) / 2);
    expect(s.meanAbsoluteMs).toBe(0.5);
    expect(s.biasMs).toBe(0.5);
  });
  it("does not let undefined timing win a primary-score tie or compare different policies", async () => {
    const m = await fixture(),
      e = m.examples[0];
    e.desiredFrames = [4000];
    const p = await plan(m);
    const misses = evaluateTrainingOnsets(p, "baseline", { [e.sourceChecksum]: [] }, "training"),
      extra = evaluateTrainingOnsets(
        p,
        "candidate",
        { [e.sourceChecksum]: [4001, 8000] },
        "training",
      );
    expect(misses.errorsPerSecond).toBe(extra.errorsPerSecond);
    expect(compareTrainingScores(extra, misses)).toBeLessThan(0);
    expect(() =>
      compareTrainingScores(extra, { ...misses, comparisonFingerprint: "different" }),
    ).toThrow("same fixed");
    expect(compareTrainingScores(misses, misses)).toBe(0);
  });
  it("keeps related bars together and freezes prior assignments through seeded splitting", async () => {
    const m = await fixture(5);
    for (const g of m.groups) g.assignment = "unassigned";
    const split = assignTrainingGroups(m, 42);
    expect(split.groups.filter((g) => g.assignment === "withheld")).toHaveLength(1);
    expect(split.groups.filter((g) => g.assignment === "training")).toHaveLength(4);
    expect(assignTrainingGroups(split, 999)).toEqual(split);
    const reordered = structuredClone(m);
    reordered.groups.reverse();
    expect(
      assignTrainingGroups(reordered, 42).groups.sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(split.groups.sort((a, b) => a.id.localeCompare(b.id)));
    const single = await fixture();
    single.groups[0].assignment = "unassigned";
    expect(assignTrainingGroups(single, 42).groups[0].assignment).toBe("training");
  });
  it("keeps withheld output separate and labels small evidence preliminary", async () => {
    const m = await fixture(2);
    m.groups[1].assignment = "withheld";
    const p = await plan(m);
    const training = evaluateTrainingOnsets(
      p,
      "baseline",
      { [m.sources[0].checksum]: m.examples[0].desiredFrames },
      "training",
    );
    expect(training.recordings).toHaveLength(1);
    expect(training.evidence).toBe("preliminary");
    expect(() => evaluateTrainingOnsets(p, "baseline", {}, "withheld")).toThrow();
    expect((await plan(m)).fingerprint).toBe(p.fingerprint);
  });
});
