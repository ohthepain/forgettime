import { filenameTempo, importedMaterial, prepareAudioImport, type AudioImportAdapter, type ImportFile, type ImportPreparation } from './audio-import';
import { createTrainingSource, MAX_TRAINING_AUDIO_BYTES } from './training-contract';
import type { RecordedTake, TakeSettings } from './recorded-take';
export type PendingTrainingSample = { checksum: string; name: string; take: RecordedTake };
export type TrainingImportReport = { duplicates: string[]; errors: { name: string; message: string }[] };
/** Decode sequentially, deduplicate source PCM, and retain only bounded, unsaved working samples. */
export async function prepareTrainingImport(files: readonly ImportFile[], adapter: AudioImportAdapter, settings: TakeSettings, known: Set<string>, usedBytes = 0, availableSlots = 100, current = () => true) {
  let fallback: Extract<ImportPreparation, { kind: "fallback" }> | null = null;
  const samples: PendingTrainingSample[] = [], report: TrainingImportReport = { duplicates: [], errors: [] };
  const audio = files.filter(file => /\.(wav|m4a)$/i.test(file.name));
  const metadata = files.filter(file => /\.forget$/i.test(file.name));
  const seen = new Set(known), paired = new Set<ImportFile>();
  const stem = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase();
  for (const file of files.filter(file => !/\.(wav|m4a|forget)$/i.test(file.name))) report.errors.push({ name: file.name, message: 'Unsupported file type.' });
  for (const file of audio) {
    if (!current()) break;
    try {
      const sidecars = audio.length === 1 ? metadata : metadata.filter(sidecar => stem(sidecar.name) === stem(file.name));
      sidecars.forEach(sidecar => paired.add(sidecar));
      const prepared = await prepareAudioImport([file, ...sidecars], adapter);
      if (!current()) break;
      if (prepared.kind === 'fallback') { if (audio.length === 1) { fallback = prepared; continue; } throw new Error('Metadata could not be restored. Import this file separately to choose audio only.'); }
      const bpm = filenameTempo(file.name) ?? settings.bpm;
      const take = prepared.kind === 'restored' ? { ...prepared.take, provenance: { ...prepared.take.provenance, kind: prepared.take.provenance?.kind ?? 'import' as const, name: file.name } } : importedMaterial({ ...prepared, bpm }, { ...settings, bpm }, 0);
      const pcm = await createTrainingSource([take.audio.samples], take.audio.sampleRate, { kind: 'import', beginningAvailable: true, endAvailable: true });
      if (!current()) break;
      if (seen.has(pcm.source.checksum)) { report.duplicates.push(file.name); continue; }
      if (samples.length >= availableSlots || usedBytes + take.audio.samples.byteLength > MAX_TRAINING_AUDIO_BYTES) throw new Error('Training sample memory limit reached (100 samples / 256 MiB).');
      seen.add(pcm.source.checksum);
      usedBytes += take.audio.samples.byteLength;
      samples.push({ checksum: pcm.source.checksum, name: file.name, take });
    } catch (cause) { report.errors.push({ name: file.name, message: (cause as Error).message }); }
  }
  for (const file of metadata.filter(file => !paired.has(file))) report.errors.push({ name: file.name, message: 'No matching audio filename selected.' });
  return { samples, report, fallback };
}
