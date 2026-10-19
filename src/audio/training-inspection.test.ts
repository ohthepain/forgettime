import { it, expect } from "vite-plus/test";
import { createTrainingSource, trainingExampleId } from "./training-contract";
import { emptyTrainingDataset } from "./training-transfer";
import { inspectTrainingDataset } from "./training-inspection";
import { baselineParameters } from "./training-optimizer";

it("compares authoritative annotations with either causal detector, respecting excluded coverage", async () => {
  const pcm = await createTrainingSource([new Float32Array(32000)], 8000, {
    kind: "import",
    beginningAvailable: true,
    endAvailable: true,
  });
  const dataset = emptyTrainingDataset(),
    bar = { startFrame: 0, endFrame: 16000 };
  const id = trainingExampleId(pcm.source.checksum, bar);
  dataset.manifest.sources.push(pcm.source);
  dataset.manifest.groups.push({
    id: "recording",
    sourceChecksums: [pcm.source.checksum],
    assignment: "training",
  });
  dataset.manifest.examples.push({
    id,
    sourceChecksum: pcm.source.checksum,
    bar,
    reference: { bpm: 120, beatOneFrame: 0, meter: [4, 4] },
    desiredFrames: [100, 8000, 9000],
    uncertain: [{ startFrame: 8500, endFrame: 9500 }],
    reviewed: true,
  });
  dataset.audio[pcm.source.checksum] = pcm.samples;
  for (const family of ["current", "mel"] as const) {
    const result = await inspectTrainingDataset(dataset, baselineParameters(family));
    expect(result.onsets[pcm.source.checksum]).toEqual([]);
    expect(result.scores[id]).toMatchObject({ matched: 0, missing: 1, extra: 0, missingFrames: [8000], extraFrames: [], matchedFrames: [] });
    expect(result.scores[id].seconds).toBeGreaterThan(0);
    expect(result.scores[id].seconds).toBeLessThan(2);
  }
  expect(dataset.manifest.examples[0].desiredFrames).toEqual([100, 8000, 9000]);
});
