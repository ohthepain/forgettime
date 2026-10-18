import {
  encodeTrainingManifest,
  parseTrainingManifest,
  verifyTrainingSource,
  MAX_TRAINING_AUDIO_BYTES,
  MAX_TRAINING_MANIFEST_BYTES,
  type TrainingManifest,
} from "./training-contract";
export interface TrainingDataset {
  manifest: TrainingManifest;
  audio: Record<string, Float32Array>;
}
export const emptyTrainingDataset = (): TrainingDataset => ({
  manifest: {
    format: "forgettime-training",
    schemaVersion: 1,
    sources: [],
    examples: [],
    groups: [],
  },
  audio: {},
});
export const MAX_TRAINING_TRANSFER_BYTES =
  12 + MAX_TRAINING_MANIFEST_BYTES + MAX_TRAINING_AUDIO_BYTES;

export async function validateTrainingDataset(dataset: TrainingDataset): Promise<TrainingDataset> {
  const manifest = parseTrainingManifest(encodeTrainingManifest(dataset.manifest));
  if (!dataset.audio || Object.keys(dataset.audio).length !== manifest.sources.length)
    throw new Error("Incomplete training audio");
  const audio: Record<string, Float32Array> = {};
  for (const source of manifest.sources) {
    const pcm = dataset.audio[source.checksum];
    if (!(pcm instanceof Float32Array)) throw new Error("Missing training source audio");
    const copy = pcm.slice();
    await verifyTrainingSource(source, copy);
    audio[source.checksum] = copy;
  }
  return { manifest, audio };
}
/** Binary v1: FTDS0001, uint32 LE manifest length, UTF8 manifest, sorted source Float32 LE payloads. */
export async function encodeTrainingTransfer(input: TrainingDataset): Promise<ArrayBuffer> {
  const dataset = await validateTrainingDataset(input),
    text = encodeTrainingManifest(dataset.manifest),
    header = new TextEncoder().encode(text);
  const bytes = new ArrayBuffer(
      12 + header.length + dataset.manifest.sources.reduce((n, s) => n + s.frames * 4, 0),
    ),
    view = new DataView(bytes);
  new Uint8Array(bytes).set(new TextEncoder().encode("FTDS0001"));
  view.setUint32(8, header.length, true);
  new Uint8Array(bytes, 12, header.length).set(header);
  let offset = 12 + header.length;
  for (const source of dataset.manifest.sources)
    for (const sample of dataset.audio[source.checksum]) {
      view.setFloat32(offset, sample, true);
      offset += 4;
    }
  return bytes;
}
export async function decodeTrainingTransfer(input: ArrayBuffer): Promise<TrainingDataset> {
  if (
    !(input instanceof ArrayBuffer) ||
    input.byteLength < 12 ||
    input.byteLength > MAX_TRAINING_TRANSFER_BYTES
  )
    throw new Error("Invalid training file size");
  // Take ownership before asynchronous checksum validation.
  const bytes = input.slice(0),
    view = new DataView(bytes);
  if (new TextDecoder().decode(bytes.slice(0, 8)) !== "FTDS0001")
    throw new Error("Unsupported training file");
  const length = view.getUint32(8, true);
  if (length > MAX_TRAINING_MANIFEST_BYTES || 12 + length > bytes.byteLength)
    throw new Error("Invalid training header");
  const manifest = parseTrainingManifest(
    new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes, 12, length)),
  );
  const expected = 12 + length + manifest.sources.reduce((n, s) => n + s.frames * 4, 0);
  if (expected !== bytes.byteLength) throw new Error("Incomplete or trailing training audio");
  // Physical order is the order in the parsed manifest, not a recomputed sort.
  const audio: Record<string, Float32Array> = {};
  let offset = 12 + length;
  for (const source of manifest.sources) {
    const pcm = new Float32Array(source.frames);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = view.getFloat32(offset, true);
      offset += 4;
    }
    audio[source.checksum] = pcm;
  }
  return validateTrainingDataset({ manifest, audio });
}
