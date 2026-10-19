import type { RecordedTake } from "./recorded-take";
import {
  createTrainingSource,
  validateTrainingManifest,
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
type Draft = { bpm: number; beatOneFrame: number; desired: number[]; uncertain: FrameRange[] };
/** One selected bar, with source-wide labels retained across tempo recuts. */
export class TrainingAnnotation {
  private history: Draft[] = [];
  private baseline: string;
  private fingerprint: string;
  private existing: Map<string, TrainingExample>;
  private savedId: string | null = null;
  draft: Draft;
  restoredDraft = false;
  private readonly initialBeatOneFrame: number;
  private constructor(
    readonly take: RecordedTake,
    readonly index: number,
    readonly source: TrainingSource,
    readonly samples: Float32Array,
    private repository: AnnotationRepository,
    snapshot: Awaited<ReturnType<AnnotationRepository["read"]>>,
    calculated: number[],
  ) {
    this.initialBeatOneFrame = take.origin * source.sampleRate - take.audio.startFrame;
    const bar = trainingBarFrames(source.sampleRate, take.settings.bpm, this.initialBeatOneFrame, index);
    this.existing = new Map(snapshot.dataset.manifest.examples.map((e) => [e.id, e]));
    const old = this.existing.get(trainingExampleId(source.checksum, bar));
    this.savedId = old?.id ?? null;
    this.draft = old
      ? {
          bpm: old.reference.bpm,
          beatOneFrame: old.reference.beatOneFrame,
          desired: [...old.desiredFrames],
          uncertain: structuredClone(old.uncertain),
        }
      : {
          bpm: take.settings.bpm,
          beatOneFrame: this.initialBeatOneFrame,
          desired: [...new Set(calculated)].sort((a, b) => a - b),
          uncertain: [],
        };
    this.baseline = JSON.stringify(this.draft);
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
    const session = new TrainingAnnotation(
      take,
      index,
      source,
      pcm.samples,
      repository,
      snapshot,
      calculated,
    );
    if (typeof sessionStorage !== "undefined") {
      try {
        const saved = JSON.parse(sessionStorage.getItem(session.draftKey) || "null");
        if (saved && saved.draft) {
          const previous = session.draft;
          session.draft = { ...saved.draft, beatOneFrame: saved.draft.beatOneFrame ?? session.initialBeatOneFrame };
          try {
            trainingBarFrames(source.sampleRate, session.draft.bpm, session.beatOneFrame, index);
            validateTrainingManifest({
              format: "forgettime-training",
              schemaVersion: 1,
              sources: [source],
              groups: [
                { id: "draft", assignment: "unassigned", sourceChecksums: [source.checksum] },
              ],
              examples: [session.example()],
            });
            session.restoredDraft = true;
          } catch {
            session.draft = previous;
          }
        }
      } catch {
        /* An unreadable draft never replaces authoritative annotations. */
      }
    }
    return session;
  }
  private get draftKey() {
    return `forgettime-annotation-draft:${this.source.checksum}:${this.initialBeatOneFrame}:${this.index}`;
  }
  saveDraft() {
    sessionStorage.setItem(
      this.draftKey,
      JSON.stringify({ fingerprint: this.fingerprint, draft: this.draft }),
    );
  }
  discardDraft() {
    try {
      sessionStorage.removeItem(this.draftKey);
    } catch {
      /* No draft stored. */
    }
  }

  get beatOneFrame() { return this.draft.beatOneFrame; }
  setBeatOne(frame: number) {
    if (!Number.isSafeInteger(frame) || frame < 0 || frame >= this.source.frames)
      throw new Error("Place beat one inside the source audio.");
    const bar = trainingBarFrames(this.source.sampleRate, this.draft.bpm, frame, this.index);
    if (bar.startFrame >= this.source.frames) throw new Error("Beat one puts this bar outside the audio.");
    this.edit({ ...this.draft, beatOneFrame: frame });
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
  get savedExampleId() {
    const current = this.example().id;
    return this.existing.has(current) ? current : this.savedId;
  }
  async exclude() {
    const id = this.savedExampleId;
    if (!id) throw new Error("This bar has not been saved to training.");
    const fingerprint = await this.repository.deleteExample(id, this.fingerprint, true);
    this.fingerprint = fingerprint;
    this.existing.delete(id);
    if (this.savedId === id) this.savedId = null;
    this.baseline = JSON.stringify(this.draft);
    this.discardDraft();
  }
  isBarIncluded(index: number) {
    const bar = trainingBarFrames(this.source.sampleRate, this.draft.bpm, this.beatOneFrame, index);
    return this.existing.has(trainingExampleId(this.source.checksum, bar));
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
    this.savedId = example.id;
    this.baseline = JSON.stringify(this.draft);
    this.discardDraft();
    return example;
  }
}
