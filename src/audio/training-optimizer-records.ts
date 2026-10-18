import { optimizerRunSchema, validateOptimizerRun, type OptimizerRun } from "./training-optimizer";
export const MAX_OPTIMIZER_RUNS = 20,
  MAX_OPTIMIZER_RECORD_BYTES = 2 * 1024 * 1024,
  MAX_OPTIMIZER_STORAGE_BYTES = 8 * 1024 * 1024;
export function encodeOptimizerRun(input: OptimizerRun): string {
  const run = validateOptimizerRun(input),
    budget = run.mode === "quick" ? 100 : 500;
  if (
    run.trials.some((t, i) => t.order !== i || t.parameters.family !== run.family) ||
    run.trials.length > budget ||
    (run.status === "completed" && run.trials.length !== budget) ||
    (run.bestOrder !== null && !run.trials[run.bestOrder]?.score) ||
    (run.frozenOrder !== null && run.frozenOrder !== run.bestOrder)
  )
    throw new Error("Invalid optimizer trial sequence or candidate");
  const text = JSON.stringify(run);
  if (new TextEncoder().encode(text).length > MAX_OPTIMIZER_RECORD_BYTES)
    throw new Error("Optimizer run record exceeds 2 MiB; current result remains in memory");
  return text;
}
export function parseOptimizerRun(text: string): OptimizerRun {
  if (new TextEncoder().encode(text).length > MAX_OPTIMIZER_RECORD_BYTES)
    throw new Error("Optimizer record exceeds size limit");
  const run = optimizerRunSchema.parse(JSON.parse(text));
  encodeOptimizerRun(run);
  return run;
}
/** Separate origin-local records contain fingerprints/parameters/metrics, never audio or labels. */
export function createOptimizerRunStore(factory: IDBFactory = indexedDB) {
  const connect = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open("forgettime-optimizer", 1);
      let blocked = false;
      req.onupgradeneeded = () => req.result.createObjectStore("runs", { keyPath: "id" });
      req.onerror = () => reject(req.error);
      req.onblocked = () => {
        blocked = true;
        reject(new Error("Close other windows to open optimizer records"));
      };
      req.onsuccess = () => {
        if (blocked) req.result.close();
        else resolve(req.result);
      };
    });
  async function transaction<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore, set: (value: T) => void, fail: (error: unknown) => void) => void,
  ): Promise<T> {
    const db = await connect();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction("runs", mode);
      let result: T, failure: unknown;
      try {
        work(
          tx.objectStore("runs"),
          (value) => {
            result = value;
          },
          (error) => {
            failure = error;
            tx.abort();
          },
        );
      } catch (e) {
        failure = e;
        tx.abort();
      }
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onabort = () => {
        db.close();
        reject(failure ?? tx.error ?? new Error("Optimizer record transaction aborted"));
      };
    });
  }
  return {
    list: () =>
      transaction<OptimizerRun[]>("readonly", (store, set, fail) => {
        const req = store.getAll();
        req.onsuccess = () => {
          try {
            set(req.result.map((r: { text: string }) => parseOptimizerRun(r.text)));
          } catch (e) {
            fail(e);
          }
        };
      }),
    async save(input: OptimizerRun) {
      const text = encodeOptimizerRun(input),
        bytes = new TextEncoder().encode(text).length;
      await transaction<void>("readwrite", (store, set, fail) => {
        const req = store.getAll();
        req.onsuccess = () => {
          const other = req.result.filter((r: { id: string }) => r.id !== input.id);
          if (
            other.length >= MAX_OPTIMIZER_RUNS ||
            other.reduce((n: number, r: { bytes: number }) => n + r.bytes, bytes) >
              MAX_OPTIMIZER_STORAGE_BYTES
          ) {
            fail(
              new Error(
                "Optimizer history is full (20 runs / 8 MiB). Delete a run record before saving another.",
              ),
            );
            return;
          }
          store.put({ id: input.id, text, bytes });
          set(undefined);
        };
      });
    },
    remove: (id: string) =>
      transaction<void>("readwrite", (store, set) => {
        store.delete(id);
        set(undefined);
      }),
  };
}
