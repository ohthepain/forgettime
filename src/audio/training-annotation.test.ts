import { expect, it } from "vite-plus/test";
import { webcrypto } from "node:crypto";
import { TrainingAnnotation } from "./training-annotation";
import { createTrainingRepository, type TrainingSnapshot } from "./training-dataset";
import { DEFAULT_DETECTOR_SETTINGS } from "./detector-contract";
import type { RecordedTake } from "./recorded-take";
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
function fixture() {
  let data: TrainingSnapshot | null = null,
    fail = false;
  const repository = createTrainingRepository({
    read: async () => structuredClone(data),
    compareAndSwap: async (expected, next) => {
      if (fail || (data?.token ?? null) !== expected) throw new Error("aborted");
      data = structuredClone(next);
    },
  });
  const take: RecordedTake = {
    audio: { startFrame: 800, sampleRate: 8000, samples: new Float32Array(40000) },
    source: "web",
    origin: 0.2,
    continuity: 1,
    settings: {
      bpm: 120,
      mode: "straight",
      startSensitivity: 50,
      detector: DEFAULT_DETECTOR_SETTINGS,
    },
    onsets: [],
    results: [],
    endReason: "stopped",
  };
  return {
    take,
    repository,
    fail: () => {
      fail = true;
    },
    recover: () => {
      fail = false;
    },
  };
}
it("uses source frames, preserves attacks beyond a tempo recut, and undoes without touching originals", async () => {
  const f = fixture(),
    before = structuredClone(f.take);
  const s = await TrainingAnnotation.open(f.take, 0, [800, 10000, 16000, 20000], f.repository);
  expect(s.beatOneFrame).toBe(800);
  expect(s.bar).toEqual({ startFrame: 800, endFrame: 16800 });
  s.setAttack(10000, 10001);
  s.setRegion(null, { startFrame: 900, endFrame: 1200 });
  s.setTempo(240);
  expect(s.bar.endFrame).toBe(8800);
  expect(s.example().desiredFrames).toEqual([800]);
  s.setTempo(120);
  expect(s.example().desiredFrames).toEqual([800, 10001, 16000]);
  expect(s.draft.desired).toContain(20000);
  s.undo();
  expect(s.draft.bpm).toBe(240);
  expect(f.take).toEqual(before);
});
it("validates edits and uncertainty without deleting labels, and reset is explicit and undoable", async () => {
  const f = fixture(),
    s = await TrainingAnnotation.open(f.take, 0, [800, 1600], f.repository);
  s.setRegion(null, { startFrame: 800, endFrame: 1800 });
  expect(s.example().desiredFrames).toEqual([800, 1600]);
  expect(() => s.setRegion(null, { startFrame: 1700, endFrame: 2000 })).toThrow("overlap");
  expect(() => s.setAttack(null, 0)).toThrow("inside");
  s.reset([900, 1000, 20000]);
  expect(s.example().desiredFrames).toEqual([900, 1000]);
  s.undo();
  expect(s.example().desiredFrames).toEqual([800, 1600]);
});
it("adds full source once, restores silence/annotations and overwrites only current labels", async () => {
  const f = fixture(),
    s = await TrainingAnnotation.open(f.take, 0, [800], f.repository);
  s.setAttack(800, null);
  await s.save();
  expect(s.dirty).toBe(false);
  expect(s.overwrite).toBe(true);
  const reopened = await TrainingAnnotation.open(f.take, 0, [800, 900], f.repository);
  expect(reopened.example().desiredFrames).toEqual([]);
  reopened.setAttack(null, 900);
  await reopened.save();
  const next = await TrainingAnnotation.open(f.take, 1, [20000], f.repository);
  await next.save();
  const data = (await f.repository.read()).dataset;
  expect(data.manifest.sources).toHaveLength(1);
  expect(data.manifest.examples).toHaveLength(2);
  expect(data.audio[s.source.checksum]).toEqual(f.take.audio.samples);
  expect(data.manifest.examples.find((e) => e.id === s.example().id)!.desiredFrames).toEqual([900]);
  expect(data.manifest.groups[0].assignment).toBe("unassigned");
});
it("retains draft and prior saved data on failure and refuses stale overwrites", async () => {
  const f = fixture(),
    s = await TrainingAnnotation.open(f.take, 0, [800], f.repository);
  await s.save();
  s.setAttack(null, 1600);
  f.fail();
  await expect(s.save()).rejects.toThrow("aborted");
  expect(s.dirty).toBe(true);
  expect(s.example().desiredFrames).toEqual([800, 1600]);
  expect((await f.repository.read()).dataset.manifest.examples[0].desiredFrames).toEqual([800]);
  f.recover();
  const other = await TrainingAnnotation.open(f.take, 0, [], f.repository);
  other.setAttack(null, 1700);
  await other.save();
  await expect(s.save()).rejects.toThrow("changed");
  expect(s.dirty).toBe(true);
});
it("changes example identity with tempo without discarding the previous example; partial bars cannot save", async () => {
  const f = fixture(),
    s = await TrainingAnnotation.open(f.take, 0, [800, 8000], f.repository);
  const old = await s.save();
  s.setTempo(240);
  const next = await s.save();
  expect(next.id).not.toBe(old.id);
  expect((await f.repository.read()).dataset.manifest.examples).toHaveLength(2);
  const partial = await TrainingAnnotation.open(f.take, 2, [35000], f.repository);
  expect(partial.coverage.complete).toBe(false);
  await expect(partial.save()).rejects.toThrow("Partial");
});
