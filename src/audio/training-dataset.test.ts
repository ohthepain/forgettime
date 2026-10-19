import { describe, expect, it } from "vite-plus/test";
import { createTrainingSource, trainingExampleId } from "./training-contract";
import {
  createTrainingRepository,
  type TrainingSnapshot,
  type TrainingStore,
} from "./training-dataset";
import {
  decodeTrainingTransfer,
  emptyTrainingDataset,
  encodeTrainingTransfer,
  type TrainingDataset,
} from "./training-transfer";
function memoryStore() {
  let value: TrainingSnapshot | null = null;
  let failure = false;
  return {
    fail() {
      failure = true;
    },
    async read() {
      return structuredClone(value);
    },
    async compareAndSwap(expected: string | null, next: TrainingSnapshot) {
      if (failure) {
        failure = false;
        throw new Error("QuotaExceededError");
      }
      if ((value?.token ?? null) !== expected) throw new Error("Stale write");
      value = structuredClone(next);
    },
  } satisfies TrainingStore & { fail(): void };
}
async function fixture(value = 0): Promise<TrainingDataset> {
  const pcm = new Float32Array(32000);
  pcm.set([-0, 1.25, -0.5, value], 0);
  const { source, samples } = await createTrainingSource([pcm], 8000, {
    kind: "import",
    beginningAvailable: true,
    endAvailable: true,
  });
  const bar = { startFrame: 0, endFrame: 16000 };
  return {
    manifest: {
      format: "forgettime-training",
      schemaVersion: 1,
      sources: [source],
      groups: [{ id: "source-group", sourceChecksums: [source.checksum], assignment: "training" }],
      examples: [
        {
          id: trainingExampleId(source.checksum, bar),
          sourceChecksum: source.checksum,
          bar,
          reference: { bpm: 120, beatOneFrame: 0, meter: [4, 4] },
          desiredFrames: [10, 4000],
          uncertain: [],
          reviewed: true,
        },
      ],
    },
    audio: { [source.checksum]: samples },
  };
}
function secondBar(dataset: TrainingDataset) {
  const x = structuredClone(dataset),
    e = x.manifest.examples[0];
  e.bar = { startFrame: 16000, endFrame: 32000 };
  e.id = trainingExampleId(e.sourceChecksum, e.bar);
  e.desiredFrames = [16000, 20000];
  return x;
}
describe("portable training dataset codec", () => {
  it("roundtrips full source context, grouping and exact PCM including signed zero", async () => {
    const input = await fixture(),
      bytes = await encodeTrainingTransfer(input);
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("FTDS0001");
    const out = await decodeTrainingTransfer(bytes);
    expect(out.manifest).toEqual(input.manifest);
    const pcm = out.audio[input.manifest.sources[0].checksum];
    expect(Object.is(pcm[0], -0)).toBe(true);
    expect(pcm[1]).toBe(1.25);
    expect(pcm.length).toBe(32000);
  });
  it("rejects corrupt, missing and trailing payloads and malformed UTF8/header", async () => {
    const original = await encodeTrainingTransfer(await fixture());
    for (const bytes of [
      original.slice(0, -1),
      new Uint8Array([...new Uint8Array(original), 0]).buffer,
      new ArrayBuffer(4),
    ])
      await expect(decodeTrainingTransfer(bytes)).rejects.toThrow();
    const corrupt = original.slice(0);
    new DataView(corrupt).setFloat32(corrupt.byteLength - 4, 1, true);
    await expect(decodeTrainingTransfer(corrupt)).rejects.toThrow("checksum");
    const wrong = original.slice(0);
    new DataView(wrong).setUint32(8, 0xffffffff, true);
    await expect(decodeTrainingTransfer(wrong)).rejects.toThrow("header");
    const utf = original.slice(0);
    new Uint8Array(utf)[12] = 255;
    await expect(decodeTrainingTransfer(utf)).rejects.toThrow();
  });
});
describe("local training repository", () => {
  it("deduplicates source PCM, prevents duplicate Add, survives repository recreation and cleans only orphan audio", async () => {
    const store = memoryStore(),
      repo = createTrainingRepository(store),
      input = await fixture();
    await repo.add(input);
    await expect(repo.add(input)).rejects.toThrow("already exists");
    await repo.add(secondBar(input));
    let read = await createTrainingRepository(store).read();
    expect(read.dataset.manifest.examples).toHaveLength(2);
    expect(read.dataset.manifest.sources).toHaveLength(1);
    expect(read.bytes).toBe(128000);
    await expect(
      repo.deleteExample(input.manifest.examples[0].id, read.fingerprint, false),
    ).rejects.toThrow("confirmation");
    await repo.deleteExample(input.manifest.examples[0].id, read.fingerprint, true);
    read = await repo.read();
    expect(Object.keys(read.dataset.audio)).toHaveLength(1);
    await repo.deleteExample(read.dataset.manifest.examples[0].id, read.fingerprint, true);
    expect((await repo.read()).dataset).toEqual(emptyTrainingDataset());
  });
  it("overwrites current reviewed labels only, preserving source/group identity, and rejects stale decisions", async () => {
    const repo = createTrainingRepository(memoryStore()),
      input = await fixture();
    await repo.add(input);
    const first = await repo.read(),
      e = structuredClone(first.dataset.manifest.examples[0]);
    e.desiredFrames = [500];
    await repo.overwrite(e, first.fingerprint);
    const now = await repo.read();
    expect(now.dataset.manifest.examples[0].desiredFrames).toEqual([500]);
    expect(now.fingerprint).not.toBe(first.fingerprint);
    expect(now.dataset.manifest.groups).toEqual(first.dataset.manifest.groups);
    await expect(repo.overwrite(e, first.fingerprint)).rejects.toThrow("changed");
    await expect(repo.overwrite({ ...e, reviewed: false }, now.fingerprint)).rejects.toThrow(
      "review",
    );
    expect(JSON.stringify(now.dataset)).not.toContain("history");
  });
  it("preserves all committed audio/annotations on quota failure and allows retry", async () => {
    const store = memoryStore(),
      repo = createTrainingRepository(store),
      input = await fixture();
    await repo.add(input);
    const prior = await repo.read();
    store.fail();
    await expect(repo.add(secondBar(input))).rejects.toThrow("Quota");
    expect(await repo.read()).toEqual(prior);
    await repo.add(secondBar(input));
    expect((await repo.read()).dataset.manifest.examples).toHaveLength(2);
  });
  it("previews identical/new/conflicting imports and requires explicit conflict choices", async () => {
    const repo = createTrainingRepository(memoryStore()),
      input = await fixture();
    await repo.add(input);
    let bytes = await encodeTrainingTransfer(input),
      preview = await repo.previewImport(bytes);
    expect(preview.identical).toEqual([input.manifest.examples[0].id]);
    const changed = structuredClone(input);
    changed.manifest.examples[0].desiredFrames = [250];
    bytes = await encodeTrainingTransfer(changed);
    preview = await repo.previewImport(bytes);
    expect(preview.conflicts).toHaveLength(1);
    await expect(repo.importFile(bytes, preview, {})).rejects.toThrow("Replace or Skip");
    await repo.importFile(bytes, preview, { [preview.conflicts[0]]: "skip" });
    expect((await repo.read()).dataset.manifest.examples[0].desiredFrames).toEqual([10, 4000]);
    preview = await repo.previewImport(bytes);
    await repo.importFile(bytes, preview, { [preview.conflicts[0]]: "replace" });
    expect((await repo.read()).dataset.manifest.examples[0].desiredFrames).toEqual([250]);
    const second = await encodeTrainingTransfer(secondBar(input));
    preview = await repo.previewImport(second);
    expect(preview.additions).toHaveLength(1);
    await repo.importFile(second, preview, {});
    expect((await repo.read()).dataset.manifest.examples).toHaveLength(2);
  });
  it("rejects changed input after preview and preserves unrelated records and existing assignments", async () => {
    const repo = createTrainingRepository(memoryStore()),
      input = await fixture();
    await repo.add(input);
    const bytes = await encodeTrainingTransfer(secondBar(input)),
      preview = await repo.previewImport(bytes);
    await repo.add(await fixture(0.25));
    await expect(repo.importFile(bytes, preview, {})).rejects.toThrow("stale");
    const incoming = secondBar(input);
    incoming.manifest.groups[0].assignment = "withheld";
    const nextBytes = await encodeTrainingTransfer(incoming),
      next = await repo.previewImport(nextBytes);
    await repo.importFile(nextBytes, next, {});
    const state = await repo.read();
    expect(state.dataset.manifest.examples).toHaveLength(3);
    expect(
      state.dataset.manifest.groups.find((g) =>
        g.sourceChecksums.includes(input.manifest.sources[0].checksum),
      )?.assignment,
    ).toBe("training");
  });
  it("rejects corrupt imports before mutation and failed multi-example imports leave no partial entries", async () => {
    const store = memoryStore(),
      repo = createTrainingRepository(store),
      input = await fixture();
    await repo.add(input);
    const incoming = await fixture(0.75);
    incoming.manifest.examples.push(secondBar(incoming).manifest.examples[0]);
    const bytes = await encodeTrainingTransfer(incoming),
      preview = await repo.previewImport(bytes),
      prior = await repo.read();
    store.fail();
    await expect(repo.importFile(bytes, preview, {})).rejects.toThrow();
    expect(await repo.read()).toEqual(prior);
    const bad = bytes.slice(0);
    new Uint8Array(bad)[bad.byteLength - 1] ^= 1;
    await expect(repo.importFile(bad, preview, {})).rejects.toThrow();
    expect(await repo.read()).toEqual(prior);
  });
  it("rejects stale concurrent commits instead of losing another tab’s update", async () => {
    const store = memoryStore(),
      a = createTrainingRepository(store),
      b = createTrainingRepository(store),
      one = await fixture(),
      two = await fixture(0.5);
    const results = await Promise.allSettled([a.add(one), b.add(two)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await a.read()).dataset.manifest.examples).toHaveLength(1);
  });
  it("rejects over-budget metadata before allocating audio or replacing storage", async () => {
    const repo = createTrainingRepository(memoryStore()),
      input = await fixture();
    await repo.add(input);
    const prior = await repo.read(),
      excess = structuredClone(input);
    const original = excess.manifest.sources[0];
    excess.manifest.sources.push({
      ...original,
      checksum: "f".repeat(64),
      frames: (256 * 1024 * 1024) / 4,
    });
    excess.manifest.groups[0].sourceChecksums.push("f".repeat(64));
    await expect(repo.add(excess)).rejects.toThrow("storage limit");
    expect(await repo.read()).toEqual(prior);
  });
  it("enforces 100-example limit without eviction", async () => {
    const repo = createTrainingRepository(memoryStore()),
      input = await fixture();
    input.manifest.examples = Array.from({ length: 100 }, (_, i) => {
      const bar = { startFrame: i, endFrame: i + 16000 };
      return {
        ...structuredClone(input.manifest.examples[0]),
        bar,
        id: trainingExampleId(input.manifest.sources[0].checksum, bar),
        reference: { bpm: 120, beatOneFrame: i, meter: [4, 4] as [4, 4] },
        desiredFrames: [],
      };
    });
    const bytes = await encodeTrainingTransfer(input);
    await repo.importFile(bytes, await repo.previewImport(bytes), {});
    const before = await repo.read();
    await expect(repo.add(secondBar(await fixture()))).rejects.toThrow();
    expect(await repo.read()).toEqual(before);
  });
});
// Deliberately no UI/native-device evidence: these tests exercise real service and portable codecs against an atomic storage seam.

it("removes all bars for one source atomically while retaining other training files", async () => {
  const store = memoryStore(), repository = createTrainingRepository(store);
  const first = await fixture(0), second = await fixture(.75);
  const extraBar = { startFrame: 16000, endFrame: 32000 };
  await repository.add(first);
  const anotherBar = structuredClone(first);
  anotherBar.manifest.examples = [{ ...first.manifest.examples[0], id: trainingExampleId(first.manifest.sources[0].checksum, extraBar), bar: extraBar, desiredFrames: [18000] }];
  await repository.add(anotherBar);
  second.manifest.groups[0].id = 'other-group';
  await repository.add(second);
  const before = await repository.read();
  const checksum = first.manifest.sources[0].checksum;
  await expect(repository.deleteSource(checksum, before.fingerprint, false)).rejects.toThrow('confirmation');
  store.fail();
  await expect(repository.deleteSource(checksum, before.fingerprint, true)).rejects.toThrow('QuotaExceededError');
  expect((await repository.read()).dataset.manifest.examples).toHaveLength(3);
  await repository.deleteSource(checksum, before.fingerprint, true);
  const after = await repository.read();
  expect(after.dataset.manifest.examples).toHaveLength(1);
  expect(after.dataset.manifest.sources.map(source => source.checksum)).toEqual([second.manifest.sources[0].checksum]);
  expect(Object.keys(after.dataset.audio)).toEqual([second.manifest.sources[0].checksum]);
});
