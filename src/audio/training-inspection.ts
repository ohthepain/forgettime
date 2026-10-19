import { OnsetDetector } from "./onset-detector";
import { MelDetector } from "./mel-detector";
import {
  optimizerParametersSchema,
  optimizerPlan,
  type OptimizerParameters,
} from "./training-optimizer";
import { validateTrainingDataset } from "./training-transfer";
import { matchTrainingOnsets } from "./training-scoring";

export async function inspectTrainingDataset(
  input: Parameters<typeof validateTrainingDataset>[0],
  profile: OptimizerParameters,
) {
  const dataset = await validateTrainingDataset(input);
  const parameters = optimizerParametersSchema.parse(profile);
  const plan = await optimizerPlan(dataset);
  const onsets: Record<string, number[]> = {};
  for (const source of dataset.manifest.sources) {
    const rate = source.sampleRate,
      pcm = dataset.audio[source.checksum],
      frames: number[] = [];
    const current =
      parameters.family === "current"
        ? new OnsetDetector(
            {
              version: 1,
              minimumRms: parameters.minimumRms,
              contrastRatio: parameters.contrastRatio,
              minSeparationMs: parameters.minSeparationMs,
              recoverySeconds: parameters.recoverySeconds,
            },
            parameters.frequencyBalance,
          )
        : null;
    const mel =
      parameters.family === "mel"
        ? new MelDetector({
            windowMs: parameters.windowMs,
            bands: parameters.bands,
            neighbor: parameters.neighbor,
            confirmation: parameters.confirmation,
            rearming: parameters.rearming,
            threshold: parameters.threshold,
          })
        : null;
    for (let offset = 0; offset < pcm.length; offset += 4096) {
      if (current) {
        frames.push(
          ...current
            .process(pcm.subarray(offset, offset + 4096), offset / rate, rate)
            .map((hit) => Math.round(hit.time * rate)),
        );
        current.drainDiagnostics();
      } else
        for (let i = offset; i < Math.min(pcm.length, offset + 4096); i++) {
          const hit = mel!.process(pcm[i], i, rate);
          if (hit) frames.push(hit.sourceFrame);
        }
      if (frames.length > 20000) throw new Error("Detected attack limit exceeded");
    }
    onsets[source.checksum] = frames;
  }
  const scores = Object.fromEntries(
    dataset.manifest.examples.map((example) => {
      const source = plan.sources.find((source) => source.checksum === example.sourceChecksum)!;
      const ranges = source.evaluated
        .map((r) => ({
          startFrame: Math.max(r.startFrame, example.bar.startFrame),
          endFrame: Math.min(r.endFrame, example.bar.endFrame),
        }))
        .filter((r) => r.endFrame > r.startFrame);
      const parts = ranges.map((r) =>
        matchTrainingOnsets(
          example.desiredFrames.filter((f) => f >= r.startFrame && f < r.endFrame),
          onsets[example.sourceChecksum].filter((f) => f >= r.startFrame && f < r.endFrame),
          source.sampleRate,
        ),
      );
      return [
        example.id,
        {
          missingFrames: parts.flatMap(part => part.missingFrames),
          extraFrames: parts.flatMap(part => part.extraFrames),
          matchedFrames: parts.flatMap(part => part.matches.map(match => match.detectedFrame)),
          matched: parts.reduce((n, p) => n + p.matched, 0),
          missing: parts.reduce((n, p) => n + p.missing, 0),
          extra: parts.reduce((n, p) => n + p.extra, 0),
          seconds: ranges.reduce((n, r) => n + (r.endFrame - r.startFrame) / source.sampleRate, 0),
        },
      ];
    }),
  );
  return { onsets, scores };
}
