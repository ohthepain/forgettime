import { createTrainingRepository, type TrainingSnapshot } from "../audio/training-dataset";
let current: TrainingSnapshot | null = null;
const repository = createTrainingRepository({
  read: async () => structuredClone(current),
  compareAndSwap: async (expected, next) => {
    if ((current?.token ?? null) !== expected) throw new Error("Tutorial data changed");
    current = structuredClone(next);
  },
});
// No Window exists here: production repository validation/CAS runs without broadcasting changes to real app windows.
self.onmessage = async (event: MessageEvent) => {
  const { id, method, args } = event.data;
  try {
    let result: unknown;
    if (method === "init") {
      current = args[0];
      result = null;
    } else if (method === "read") result = await repository.read();
    else if (method === "add") result = await repository.add(args[0]);
    else if (method === "overwrite") result = await repository.overwrite(args[0], args[1]);
    else throw new Error("Unsupported tutorial operation");
    self.postMessage({ id, result, manifest: current?.dataset.manifest });
  } catch (e) {
    self.postMessage({ id, error: (e as Error).message });
  }
};
