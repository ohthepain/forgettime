import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFixture, sha256 } from "./lib/audio-fixtures";
import {
  analyzeOnsets,
  detectionProfiles,
  formatGridTable,
  gridRows,
  type ProfileName,
  type StartupMode,
} from "./lib/audio-comparison";

const root = fileURLToPath(new URL("..", import.meta.url));
const [input, ...flags] = process.argv.slice(2);
if (!input || flags.some((flag) => flag !== "--assume-silence" && !/^--frequency-balance=(0|[1-9][0-9]?|100)$/.test(flag))) {
  throw new Error(
    'Usage: pnpm audio:compare "fixture.wav" [--assume-silence] [--frequency-balance=0..100] (adds a separately labelled silent-prehistory experiment)',
  );
}
const frequencyBalance = Number(flags.find(flag => flag.startsWith("--frequency-balance="))?.split("=")[1] ?? 0);
const filename = basename(input.endsWith(".wav") ? input : `${input}.wav`);
if (
  input.includes("/") &&
  resolve(root, input.endsWith(".wav") ? input : `${input}.wav`) !==
    join(root, "test-data/audio", filename)
) {
  throw new Error(
    "Select a filename in test-data/audio; paths outside the fixture corpus are not accepted",
  );
}
const fixture = readFixture(join(root, "test-data/audio"), filename);
const sources = [
  "src/audio/onset-detector.ts",
  "src/audio/frequency-evidence.ts",
  "src/audio/detector-contract.ts",
  "scripts/lib/wav.ts",
  "scripts/lib/audio-comparison.ts",
  "scripts/lib/audio-fixtures.ts",
  "scripts/compare-audio.ts",
];
const sourceHashes = Object.fromEntries(
  sources.map((path) => [path, sha256(readFileSync(join(root, path)))]),
);
const sourceFingerprint = sha256(JSON.stringify(sourceHashes));
const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const startupModes: StartupMode[] = flags.includes("--assume-silence")
  ? ["captured", "assumed-silent"]
  : ["captured"];
const runs = startupModes.flatMap((startup) =>
  (Object.keys(detectionProfiles) as ProfileName[]).map((profile) => {
    const result = analyzeOnsets(fixture.samples, fixture.sampleRate, profile, startup, frequencyBalance);
    return { ...result, rows: gridRows(result.onsets, fixture.metadata) };
  }),
);
const generatedAt = new Date().toISOString();
const report = {
  schemaVersion: 1,
  generatedAt,
  provenance: {
    gitHead: git(["rev-parse", "HEAD"]),
    sourceHashes,
    sourceFingerprint,
    sourcesDifferFromHead: Boolean(
      git(["status", "--porcelain", "--untracked-files=all", "--", ...sources]),
    ),
    node: process.version,
  },
  fixture: fixture.metadata,
  method:
    "Onset comparison only; grid errors use the declared render origin, never first-hit acquisition. Musical grid matching is not acoustic-onset precision/recall.",
  experiment:
    "assumed-silent feeds twelve synthetic silent windows before sample zero without changing original WAV timestamps. It is not captured silence or a production startup fix.",
  runs,
};
const directory = join(root, "output/audio-validation/comparisons");
mkdirSync(directory, { recursive: true });
const path = join(
  directory,
  `${filename.slice(0, -4).replaceAll(" ", "-")}-${fixture.metadata.sha256.slice(0, 8)}-${generatedAt.replaceAll(":", "-")}.json`,
);
writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
console.log(
  `${filename}: ${fixture.metadata.bpm} BPM; ${fixture.metadata.durationSeconds}s; grid origin ${fixture.metadata.renderOffsetSeconds ?? "unknown"} (${fixture.metadata.gridOriginStatus}).`,
);
console.log(
  `Source ${sourceFingerprint.slice(0, 12)}; HEAD ${report.provenance.gitHead.slice(0, 12)}; runtime ${process.version}.`,
);
for (const run of runs) {
  console.log(
    `\n${run.profile} / ${run.startup === "captured" ? "production startup" : "EXPERIMENT: assumed silent prehistory"}: ${run.onsets.length} detections; ${run.frequencyBalance}% frequency change; minimum RMS ${run.settings.minimumRms}`,
  );
  console.log(formatGridTable(run.rows));
}
console.log(`\nComplete report: ${path}`);
