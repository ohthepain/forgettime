import type { PendingTrainingSample } from './training-import';
import { MAX_TRAINING_AUDIO_BYTES } from './training-contract';

export interface TrainingSampleCatalog {
  read(): Promise<PendingTrainingSample[]>;
  add(samples: PendingTrainingSample[]): Promise<PendingTrainingSample[]>;
}
function validate(samples: PendingTrainingSample[]) {
  if (!Array.isArray(samples) || samples.length > 100 || new Set(samples.map(sample => sample.checksum)).size !== samples.length) throw new Error('Invalid imported sample catalog');
  let bytes = 0;
  for (const sample of samples) {
    const take = sample.take;
    if (!/^[a-f0-9]{64}$/.test(sample.checksum) || typeof sample.name !== 'string' || !sample.name.length || sample.name.length > 255 || !take?.audio || !(take.audio.samples instanceof Float32Array) || !take.audio.samples.length || !Number.isFinite(take.audio.sampleRate) || take.audio.sampleRate < 8000 || take.audio.sampleRate > 192000 || take.audio.samples.length > take.audio.sampleRate * 120 || !Number.isFinite(take.origin) || !Number.isFinite(take.settings?.bpm) || take.settings.bpm < 30 || take.settings.bpm > 300 || !Array.isArray(take.onsets) || !Array.isArray(take.results)) throw new Error('Invalid imported sample catalog');
    bytes += take.audio.samples.byteLength;
  }
  if (bytes > MAX_TRAINING_AUDIO_BYTES) throw new Error('Imported sample storage limit reached (100 samples / 256 MiB)');
  return samples;
}
/** Imported source files are retained independently of authoritative training annotations. */
export function createTrainingSampleCatalog(factory: IDBFactory = indexedDB): TrainingSampleCatalog {
  const connect = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('forgettime-imported-samples', 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore('samples');
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('Close other tabs to open imported samples')); };
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
  });
  async function transaction(incoming?: PendingTrainingSample[]) {
    if (incoming) validate(incoming);
    const db = await connect();
    return new Promise<PendingTrainingSample[]>((resolve, reject) => {
      const tx = db.transaction('samples', incoming ? 'readwrite' : 'readonly');
      const store = tx.objectStore('samples'), request = store.getAll();
      let result: PendingTrainingSample[] = [], error: unknown;
      request.onsuccess = () => {
        try {
          const existing = validate(request.result);
          const merged = new Map(existing.map(sample => [sample.checksum, sample]));
          for (const sample of incoming ?? []) if (!merged.has(sample.checksum)) merged.set(sample.checksum, sample);
          result = validate([...merged.values()]);
          for (const sample of incoming ?? []) if (!existing.some(old => old.checksum === sample.checksum)) store.put(sample, sample.checksum);
        } catch (cause) { error = cause; tx.abort(); }
      };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = () => { db.close(); reject(error ?? tx.error ?? new Error('Imported sample storage failed; prior files retained')); };
    });
  }
  return { read: () => transaction(), add: samples => transaction(samples) };
}
