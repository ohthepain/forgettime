import { fileURLToPath } from "node:url";
import { checkFixtureDirectory } from "./lib/audio-fixtures";

const errors = checkFixtureDirectory(fileURLToPath(new URL("../test-data/audio", import.meta.url)));
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "Audio fixtures: filenames, checksums, formats, durations and declared musical grids validated.",
  );
