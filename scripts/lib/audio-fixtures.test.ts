import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { checkFixtureDirectory, inspectFixture, readFixture } from "./audio-fixtures";

const directory = fileURLToPath(new URL("../../test-data/audio", import.meta.url));
const filename = "beat 1 simple dyn 120.wav";
const bytes = readFileSync(join(directory, filename));
const metadata = JSON.parse(
  readFileSync(join(directory, filename.replace(".wav", ".metadata.json")), "utf8"),
);

describe("WAV fixture declarations", () => {
  it("validates every supplied fixture without inferring unknown intention", () => {
    expect(checkFixtureDirectory(directory)).toEqual([]);
    expect(readFixture(directory, "beat 1 120.wav").metadata.patternStatus).toBe("partial");
  });

  it("rejects a replaced WAV until its provenance is reviewed", () => {
    const altered = Buffer.from(bytes);
    altered[altered.length - 1] ^= 1;
    expect(() => inspectFixture(altered, metadata, filename)).toThrow(/checksum/);
  });

  it.each([
    ["duration", { durationSeconds: 0.125 }, /duration/],
    ["format", { sampleRate: 48000 }, /format/],
    ["filename", { file: "different.wav" }, /filename/],
    ["tempo", { bpm: 0 }, /bpm/],
    ["off-grid tempo", { bpm: 121 }, /grid/],
    ["missing origin", { renderOffsetSeconds: null }, /origin/],
    ["outside file", { expectedGridSeconds: [0, 2] }, /inside WAV/],
    ["duplicate positions", { expectedGridSeconds: [0, 0] }, /unique/],
    ["invented intention", { patternStatus: "unknown" }, /Unknown patterns/],
  ])("rejects incorrect %s", (_name, patch, message) => {
    expect(() => inspectFixture(bytes, { ...metadata, ...patch }, filename)).toThrow(message);
  });

  it("allows explicitly unknown pattern and origin without inventing expectations", () => {
    const result = inspectFixture(
      bytes,
      {
        ...metadata,
        patternStatus: "unknown",
        intendedPattern: null,
        expectedGridSeconds: null,
        renderOffsetSeconds: null,
        gridOriginStatus: "unknown",
      },
      filename,
    );
    expect(result.metadata.expectedGridSeconds).toBeNull();
    expect(result.metadata.renderOffsetSeconds).toBeNull();
  });

  it("reports missing metadata and orphan sidecars", () => {
    const temporary = mkdtempSync(join(tmpdir(), "forgettime-fixtures-"));
    try {
      writeFileSync(join(temporary, filename), bytes);
      writeFileSync(join(temporary, "orphan.metadata.json"), "{}");
      const errors = checkFixtureDirectory(temporary);
      expect(errors).toHaveLength(2);
      expect(errors.some((error) => error.includes(filename))).toBe(true);
      expect(errors.some((error) => error.includes("source WAV is missing"))).toBe(true);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
