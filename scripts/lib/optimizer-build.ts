import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
/** Pin actual detector, scorer, contract and search source bytes, including local uncommitted code. */
const hash = createHash("sha256");
for (const file of [
  "training-optimizer",
  "training-scoring",
  "training-contract",
  "training-transfer",
  "onset-detector",
  "detector-contract",
  "frequency-evidence",
  "mel-detector",
])
  hash.update(file).update(readFileSync(new URL(`../../src/audio/${file}.ts`, import.meta.url)));
export const optimizerBuildDefines = {
  __TRAINING_OPTIMIZER_BUILD__: JSON.stringify(hash.digest("hex")),
};
