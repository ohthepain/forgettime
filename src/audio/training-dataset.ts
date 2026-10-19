import { assignTrainingGroups } from './training-scoring';
import { trainingFingerprint, type TrainingExample } from "./training-contract";
import {
  decodeTrainingTransfer,
  emptyTrainingDataset,
  encodeTrainingTransfer,
  validateTrainingDataset,
  type TrainingDataset,
} from "./training-transfer";
export interface TrainingSnapshot {
  token: string;
  dataset: TrainingDataset;
}
/** Atomic compare-and-swap is enforced by the backend transaction, across tabs/instances. */
export interface TrainingStore {
  read(): Promise<TrainingSnapshot | null>;
  compareAndSwap(expected: string | null, next: TrainingSnapshot): Promise<void>;
}
export interface TrainingImportPreview {
  currentFingerprint: string;
  incomingFingerprint: string;
  additions: string[];
  identical: string[];
  conflicts: string[];
}
export type TrainingImportChoices = Record<string, "replace" | "skip">;

function annotations(e: TrainingExample) {
  return JSON.stringify({
    reference: e.reference,
    desired: e.desiredFrames,
    uncertain: e.uncertain,
    reviewed: e.reviewed,
  });
}
function prune(dataset: TrainingDataset): TrainingDataset {
  const used = new Set(dataset.manifest.examples.map((e) => e.sourceChecksum));
  dataset.manifest.sources = dataset.manifest.sources.filter((s) => used.has(s.checksum));
  for (const key of Object.keys(dataset.audio)) if (!used.has(key)) delete dataset.audio[key];
  dataset.manifest.groups = dataset.manifest.groups
    .map((g) => ({ ...g, sourceChecksums: g.sourceChecksums.filter((s) => used.has(s)) }))
    .filter((g) => g.sourceChecksums.length);
  return dataset;
}
function merge(
  current: TrainingDataset,
  incoming: TrainingDataset,
  choices: TrainingImportChoices,
): TrainingDataset {
  const result = structuredClone(current),
    m = result.manifest;
  const byId = new Map(m.examples.map((e) => [e.id, e]));
  const added = new Set<string>();
  for (const e of incoming.manifest.examples) {
    const old = byId.get(e.id);
    if (old) {
      if (annotations(old) === annotations(e)) continue;
      if (!choices[e.id]) throw new Error("Choose Replace or Skip for each annotation conflict");
      if (choices[e.id] === "skip") continue;
    }
    if (old) m.examples = m.examples.map((x) => (x.id === e.id ? structuredClone(e) : x));
    else m.examples.push(structuredClone(e));
    byId.set(e.id, e);
    added.add(e.sourceChecksum);
  }
  for (const s of incoming.manifest.sources)
    if (added.has(s.checksum) && !m.sources.some((x) => x.checksum === s.checksum)) {
      m.sources.push(structuredClone(s));
      result.audio[s.checksum] = incoming.audio[s.checksum].slice();
    }
  for (const g of incoming.manifest.groups) {
    const members = g.sourceChecksums.filter((s) => m.sources.some((x) => x.checksum === s));
    if (!members.length) continue;
    const existing = m.groups.filter((x) => x.sourceChecksums.some((s) => members.includes(s)));
    if (existing.length > 1)
      throw new Error("Import would merge existing recording groups; resolve grouping explicitly");
    if (existing.length) {
      const target = existing[0];
      target.sourceChecksums = [...new Set([...target.sourceChecksums, ...members])];
      continue;
    }
    const id = m.groups.some((x) => x.id === g.id) ? "import:" + members.slice().sort()[0] : g.id;
    m.groups.push({ ...structuredClone(g), id, sourceChecksums: members });
  }
  return prune(result);
}
export function createTrainingRepository(store: TrainingStore) {
  async function load() {
    const snapshot = await store.read();
    if (
      snapshot &&
      (typeof snapshot.token !== "string" || !snapshot.token || snapshot.token.length > 128)
    )
      throw new Error("Invalid training storage token");
    return snapshot
      ? { token: snapshot.token, dataset: await validateTrainingDataset(snapshot.dataset) }
      : { token: null, dataset: emptyTrainingDataset() };
  }
  async function commit(expected: string | null, dataset: TrainingDataset) {
    const valid = await validateTrainingDataset(dataset);
    const token = crypto.randomUUID();
    const fingerprint = await trainingFingerprint(valid.manifest);
    await store.compareAndSwap(expected, { token, dataset: valid });
    // Notifications are advisory; failure after a committed transaction must never report a failed write.
    if (typeof window !== 'undefined') {
      try { window.dispatchEvent(new CustomEvent('forgettime-training-changed', { detail: fingerprint })); } catch { /* Storage already committed. */ }
      try { if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('forgettime-training'); channel.postMessage(fingerprint); channel.close(); } } catch { /* Unsupported origin/channel; freshness is rechecked before publication. */ }
    }
    return fingerprint;
  }
  return {
    async read() {
      const { dataset } = await load();
      return {
        dataset,
        fingerprint: await trainingFingerprint(dataset.manifest),
        bytes: dataset.manifest.sources.reduce((n, s) => n + s.frames * 4, 0),
      };
    },
    async assignGroups(expectedFingerprint: string, seed: number) {
      const { token, dataset } = await load();
      if (await trainingFingerprint(dataset.manifest) !== expectedFingerprint) throw new Error('Training dataset changed; review assignments again');
      dataset.manifest = assignTrainingGroups(dataset.manifest, seed);
      return commit(token, dataset);
    },
    async add(input: TrainingDataset) {
      const incoming = await validateTrainingDataset(input);
      if (incoming.manifest.examples.length !== 1)
        throw new Error("Add requires one training example");
      const { token, dataset } = await load();
      const e = incoming.manifest.examples[0];
      if (!e.reviewed) throw new Error("Confirm review before adding");
      if (dataset.manifest.examples.some((x) => x.id === e.id))
        throw new Error("Training example already exists; use Overwrite");
      return commit(token, merge(dataset, incoming, {}));
    },
    async overwrite(example: TrainingExample, expectedFingerprint: string) {
      const next = structuredClone(example);
      const { token, dataset } = await load();
      if ((await trainingFingerprint(dataset.manifest)) !== expectedFingerprint)
        throw new Error("Training dataset changed; review again");
      const old = dataset.manifest.examples.find((x) => x.id === next.id);
      if (!old) throw new Error("Training example missing");
      if (
        old.sourceChecksum !== next.sourceChecksum ||
        old.bar.startFrame !== next.bar.startFrame ||
        old.bar.endFrame !== next.bar.endFrame ||
        old.reference.bpm !== next.reference.bpm ||
        old.reference.beatOneFrame !== next.reference.beatOneFrame ||
        old.reference.meter[0] !== next.reference.meter[0] ||
        old.reference.meter[1] !== next.reference.meter[1]
      )
        throw new Error("Overwrite cannot change source, bar or reference");
      if (!next.reviewed) throw new Error("Confirm review before overwriting");
      dataset.manifest.examples = dataset.manifest.examples.map((x) =>
        x.id === next.id ? next : x,
      );
      return commit(token, dataset);
    },
    async deleteExample(id: string, expectedFingerprint: string, confirmed: boolean) {
      if (!confirmed) throw new Error("Deletion requires explicit confirmation");
      const { token, dataset } = await load();
      if ((await trainingFingerprint(dataset.manifest)) !== expectedFingerprint)
        throw new Error("Training dataset changed; review again");
      if (!dataset.manifest.examples.some((e) => e.id === id))
        throw new Error("Training example missing");
      dataset.manifest.examples = dataset.manifest.examples.filter((e) => e.id !== id);
      return commit(token, prune(dataset));
    },
    async deleteSource(checksum: string, expectedFingerprint: string, confirmed: boolean) {
      if (!confirmed) throw new Error("Deletion requires explicit confirmation");
      const { token, dataset } = await load();
      if ((await trainingFingerprint(dataset.manifest)) !== expectedFingerprint)
        throw new Error("Training dataset changed; review again");
      if (!dataset.manifest.sources.some(source => source.checksum === checksum))
        throw new Error("Training source missing");
      dataset.manifest.examples = dataset.manifest.examples.filter(example => example.sourceChecksum !== checksum);
      return commit(token, prune(dataset));
    },
    async exportFile() {
      return encodeTrainingTransfer((await load()).dataset);
    },
    async previewImport(bytes: ArrayBuffer): Promise<TrainingImportPreview> {
      const incoming = await decodeTrainingTransfer(bytes),
        { dataset } = await load();
      const preview: TrainingImportPreview = {
        currentFingerprint: await trainingFingerprint(dataset.manifest),
        incomingFingerprint: await trainingFingerprint(incoming.manifest),
        additions: [],
        identical: [],
        conflicts: [],
      };
      for (const e of incoming.manifest.examples) {
        const old = dataset.manifest.examples.find((x) => x.id === e.id);
        preview[
          !old ? "additions" : annotations(e) === annotations(old) ? "identical" : "conflicts"
        ].push(e.id);
      }
      return preview;
    },
    async importFile(
      bytes: ArrayBuffer,
      preview: TrainingImportPreview,
      choices: TrainingImportChoices,
    ) {
      const incoming = await decodeTrainingTransfer(bytes),
        { token, dataset } = await load();
      if (
        (await trainingFingerprint(incoming.manifest)) !== preview.incomingFingerprint ||
        (await trainingFingerprint(dataset.manifest)) !== preview.currentFingerprint
      )
        throw new Error("Import preview is stale; preview again");
      const actualConflicts = incoming.manifest.examples
        .filter((e) => {
          const old = dataset.manifest.examples.find((x) => x.id === e.id);
          return old && annotations(old) !== annotations(e);
        })
        .map((e) => e.id);
      if (
        Object.keys(choices).some((id) => !actualConflicts.includes(id)) ||
        actualConflicts.some((id) => !["replace", "skip"].includes(choices[id]))
      )
        throw new Error("Choose Replace or Skip for every conflict");
      return commit(token, merge(dataset, incoming, choices));
    },
  };
}
/** Persistent origin storage in browsers and Capacitor native WebViews. Not a backup. */
export function createIndexedDbTrainingStore(factory: IDBFactory = indexedDB): TrainingStore {
  const connect = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open("forgettime-training", 1);
      let blocked = false;
      req.onupgradeneeded = () => req.result.createObjectStore("dataset");
      req.onerror = () => reject(req.error);
      req.onblocked = () => {
        blocked = true;
        reject(new Error("Close other tabs to open training storage"));
      };
      req.onsuccess = () => {
        if (blocked) req.result.close();
        else resolve(req.result);
      };
    });
  return {
    async read() {
      const db = await connect();
      return new Promise<TrainingSnapshot | null>((resolve, reject) => {
        const tx = db.transaction("dataset", "readonly"),
          req = tx.objectStore("dataset").get("current");
        tx.oncomplete = () => {
          db.close();
          resolve(req.result ?? null);
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error("Training read aborted"));
        };
      });
    },
    async compareAndSwap(expected, next) {
      const db = await connect();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction("dataset", "readwrite"),
          s = tx.objectStore("dataset"),
          req = s.get("current");
        let failure: Error | undefined;
        req.onsuccess = () => {
          if ((req.result?.token ?? null) !== expected) {
            failure = new Error("Training dataset changed in another window");
            tx.abort();
            return;
          }
          s.put(next, "current");
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => {
          db.close();
          reject(failure ?? tx.error ?? new Error("Training write aborted; prior data retained"));
        };
      });
    },
  };
}
export function createLocalTrainingRepository(factory: IDBFactory = indexedDB) {
  return createTrainingRepository(createIndexedDbTrainingStore(factory));
}
