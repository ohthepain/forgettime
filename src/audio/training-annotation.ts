import type { RecordedTake } from "./recorded-take";
import {
  createTrainingSource,
  trainingBarFrames,
  trainingCoverage,
  trainingExampleId,
  type FrameRange,
  type TrainingExample,
  type TrainingSource,
} from "./training-contract";
import type { createTrainingRepository } from "./training-dataset";
import { emptyTrainingDataset } from "./training-transfer";

export type AnnotationRepository = ReturnType<typeof createTrainingRepository>;
type Draft = { bpm: number; desired: number[]; uncertain: FrameRange[] };
/** One selected bar, with source-wide labels retained across tempo recuts. */
export class TrainingAnnotation {
  private history: Draft[] = [];
  private baseline: string;
  private fingerprint: string;
  private existing: Map<string, TrainingExample>;
  draft: Draft;
  readonly beatOneFrame: number;
  private constructor(
    readonly take: RecordedTake,
    readonly index: number,
    readonly source: TrainingSource,
    readonly samples: Float32Array,
    private repository: AnnotationRepository,
    snapshot: Awaited<ReturnType<AnnotationRepository["read"]>>,
    calculated: number[],
  ) {
    this.beatOneFrame = take.origin * source.sampleRate - take.audio.startFrame;
    const bar = trainingBarFrames(source.sampleRate, take.settings.bpm, this.beatOneFrame, index);
    this.existing = new Map(snapshot.dataset.manifest.examples.map((e) => [e.id, e]));
    const old = this.existing.get(trainingExampleId(source.checksum, bar));
    this.draft = old
      ? {
          bpm: old.reference.bpm,
          desired: [...old.desiredFrames],
          uncertain: structuredClone(old.uncertain),
        }
      : {
          bpm: take.settings.bpm,
          desired: [...new Set(calculated)].sort((a, b) => a - b),
          uncertain: [],
        };
    this.baseline = old ? JSON.stringify(this.draft) : "";
    this.fingerprint = snapshot.fingerprint;
  }
  static async open(
    take: RecordedTake,
    index: number,
    calculated: number[],
    repository: AnnotationRepository,
  ) {
    const pcm = await createTrainingSource([take.audio.samples], take.audio.sampleRate, {
      kind:
        take.provenance?.kind ??
        (take.source === "web" || take.source === "native"
          ? "capture"
          : take.source === "imported"
            ? "import"
            : "unknown"),
      ...(take.provenance?.name ? { name: take.provenance.name } : {}),
      beginningAvailable: take.source === "imported" && take.barCount === undefined,
      endAvailable: take.source === "imported" && take.barCount === undefined,
    });
    const snapshot = await repository.read();
    const source =
      snapshot.dataset.manifest.sources.find((s) => s.checksum === pcm.source.checksum) ??
      pcm.source;
    return new TrainingAnnotation(
      take,
      index,
      source,
      pcm.samples,
      repository,
      snapshot,
      calculated,
    );
  }
  get bar() {
    return trainingBarFrames(this.source.sampleRate, this.draft.bpm, this.beatOneFrame, this.index);
  }
  get coverage() {
    return trainingCoverage(this.example(), this.source);
  }
  get dirty() {
    return JSON.stringify(this.draft) !== this.baseline;
  }
  get canUndo() {
    return this.history.length > 0;
  }
  get overwrite() {
    return this.existing.has(this.example().id);
  }
  private edit(next: Draft) {
    if (JSON.stringify(next) === JSON.stringify(this.draft)) return;
    this.history.push(structuredClone(this.draft));
    if (this.history.length > 100) this.history.shift();
    this.draft = next;
  }
  setTempo(bpm: number) {
    const bar = trainingBarFrames(this.source.sampleRate, bpm, this.beatOneFrame, this.index);
    if (bar.endFrame <= 0 || bar.startFrame >= this.source.frames)
      throw new Error("This tempo puts the selected bar outside the retained audio.");
    this.edit({ ...this.draft, bpm });
  }
  setAttack(previous: number | null, frame: number | null) {
    if (
      frame !== null &&
      (!Number.isSafeInteger(frame) ||
        frame < Math.max(0, this.bar.startFrame) ||
        frame >= Math.min(this.source.frames, this.bar.endFrame))
    )
      throw new Error("Choose an attack inside the available bar.");
    const desired = this.draft.desired.filter((f) => f !== previous);
    if (frame !== null) desired.push(frame);
    this.edit({ ...this.draft, desired: [...new Set(desired)].sort((a, b) => a - b) });
  }
  setRegion(index: number | null, region: FrameRange | null) {
    const uncertain = this.draft.uncertain.filter((_, i) => i !== index);
    if (region) {
      if (
        !Number.isSafeInteger(region.startFrame) ||
        !Number.isSafeInteger(region.endFrame) ||
        region.startFrame < Math.max(0, this.bar.startFrame) ||
        region.endFrame > Math.min(this.source.frames, this.bar.endFrame) ||
        region.endFrame <= region.startFrame
      )
        throw new Error("Choose a nonempty uncertainty interval inside the available bar.");
      uncertain.push(region);
    }
    uncertain.sort((a, b) => a.startFrame - b.startFrame);
    if (uncertain.some((r, i) => i && r.startFrame < uncertain[i - 1].endFrame))
      throw new Error("Uncertainty intervals cannot overlap.");
    this.edit({ ...this.draft, uncertain });
  }
  reset(calculated: number[]) {
    const { startFrame, endFrame } = this.bar;
    this.edit({
      ...this.draft,
      desired: [
        ...new Set([
          ...this.draft.desired.filter((f) => f < startFrame || f >= endFrame),
          ...calculated.filter(
            (f) => f >= Math.max(0, startFrame) && f < Math.min(this.source.frames, endFrame),
          ),
        ]),
      ].sort((a, b) => a - b),
    });
  }
  undo() {
    const previous = this.history.pop();
    if (previous) this.draft = previous;
  }
  example(): TrainingExample {
    const bar = this.bar,
      start = Math.max(0, bar.startFrame),
      end = Math.min(this.source.frames, bar.endFrame);
    return {
      id: trainingExampleId(this.source.checksum, bar),
      sourceChecksum: this.source.checksum,
      bar,
      reference: { bpm: this.draft.bpm, beatOneFrame: this.beatOneFrame, meter: [4, 4] },
      desiredFrames: this.draft.desired.filter((f) => f >= start && f < end),
      uncertain: this.draft.uncertain
        .map((r) => ({
          startFrame: Math.max(start, r.startFrame),
          endFrame: Math.min(end, r.endFrame),
        }))
        .filter((r) => r.endFrame > r.startFrame),
      reviewed: false,
    };
  }
  async save() {
    if (!this.coverage.complete)
      throw new Error(
        "Partial bars can be inspected, but need complete audio before adding to training.",
      );
    const example = { ...this.example(), reviewed: true };
    // Resolve current identity after a tempo recut, without bypassing the original conflict token.
    const current = await this.repository.read();
    const stored = current.dataset.manifest.examples.find((e) => e.id === example.id);
    let fingerprint: string;
    if (stored) {
      if (!this.existing.has(example.id))
        throw new Error(
          "This example was added elsewhere; close and reopen annotations before choosing Overwrite.",
        );
      fingerprint = await this.repository.overwrite(example, this.fingerprint);
    } else {
      const dataset = emptyTrainingDataset();
      dataset.manifest.sources.push(this.source);
      const group = current.dataset.manifest.groups.find((g) =>
        g.sourceChecksums.includes(this.source.checksum),
      );
      dataset.manifest.groups.push(
        group
          ? { ...group, sourceChecksums: [this.source.checksum] }
          : {
              id: `source:${this.source.checksum}`,
              assignment: "unassigned",
              sourceChecksums: [this.source.checksum],
            },
      );
      dataset.manifest.examples.push(example);
      dataset.audio[this.source.checksum] = this.samples;
      fingerprint = await this.repository.add(dataset);
    }
    this.fingerprint = fingerprint;
    this.existing.set(example.id, example);
    this.baseline = JSON.stringify(this.draft);
    return example;
  }
}
