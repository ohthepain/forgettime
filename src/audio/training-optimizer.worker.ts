import {
  optimizeTraining,
  evaluateOptimizerWithheld,
  type OptimizerRun,
} from "./training-optimizer";
import type { TrainingDataset } from "./training-transfer";
let running = false,
  cancelled = false,
  stale = false;
self.onmessage = async (event: MessageEvent) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelled = true;
    stale = Boolean(message.stale);
    return;
  }
  if (running) return;
  running = true;
  cancelled = false;
  stale = false;
  const control = {
    cancelled: () => cancelled,
    stale: () => stale,
    progress: (progress: unknown) => self.postMessage({ type: "progress", progress }),
  };
  try {
    const run: OptimizerRun =
      message.type === "withheld"
        ? await evaluateOptimizerWithheld(message.dataset as TrainingDataset, message.run, control)
        : await optimizeTraining(message.dataset, message.options, control);
    self.postMessage({ type: "result", run });
  } catch (e) {
    self.postMessage({ type: "error", error: (e as Error).message });
  } finally {
    running = false;
  }
};
