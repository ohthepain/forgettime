import { inspectTrainingDataset } from "./training-inspection";
self.onmessage = async (event) => {
  try {
    self.postMessage(await inspectTrainingDataset(event.data.dataset, event.data.parameters));
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
