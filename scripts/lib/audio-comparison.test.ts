import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import {
  accentFollowUpFixture,
  roomNoiseAfterAccentFixture,
} from "../../src/audio/fixtures/level-recovery";
import {
  analyzeOnsets,
  detectionProfiles,
  formatGridTable,
  gridRows,
  type ProfileName,
} from "./audio-comparison";
import { readFixture } from "./audio-fixtures";

const directory = fileURLToPath(new URL("../../test-data/audio", import.meta.url));
const dynamic = readFixture(directory, "beat 1 simple dyn 120.wav");

describe.each(Object.keys(detectionProfiles) as ProfileName[])(
  "%s sensitivity matrix",
  (profile) => {
    it.each([
      ["beat 1 simple 120.wav", 8],
      ["beat 1 simple dyn 120.wav", profile === "default" ? 8 : 6],
    ])("keeps expected groups without extras in %s", (filename, count) => {
      const fixture = readFixture(directory, filename);
      const original = fixture.samples.slice();
      const result = analyzeOnsets(fixture.samples, fixture.sampleRate, profile, "assumed-silent");
      const rows = gridRows(result.onsets, fixture.metadata);
      // Preserve known detections, but permit a later detector improvement to
      // recover more conservative-profile hats without rewriting a failure as
      // the desired outcome. Full default recall and zero extras stay required.
      expect(result.onsets.length).toBeGreaterThanOrEqual(count);
      expect(rows.filter((row) => row.status === "extra")).toHaveLength(0);
      expect(rows.filter((row) => row.status === "missing")).toHaveLength(8 - result.onsets.length);
      expect(fixture.samples).toEqual(original);
    });

    it("retains separate close attacks and soft follow-ups", () => {
      const rate = 48000;
      const samples = new Float32Array(rate / 2);
      const expected = [0.1, 0.129];
      for (const time of expected) {
        for (let n = 0; n < rate * 0.04; n++) {
          samples[Math.round(time * rate) + n] +=
            0.7 * Math.exp(-n / rate / 0.004) * Math.cos((2 * Math.PI * 120 * n) / rate);
        }
      }
      const result = analyzeOnsets(samples, rate, profile, "captured");
      expect(result.onsets).toHaveLength(2);
      result.onsets.forEach((onset, index) =>
        expect(Math.abs(onset.time - expected[index])).toBeLessThan(0.004),
      );
      const soft = accentFollowUpFixture(rate);
      const hits = analyzeOnsets(soft.samples, rate, profile, "captured").onsets;
      expect(hits).toHaveLength(soft.expectedTimes.length);
      hits.forEach((hit, index) =>
        expect(Math.abs(hit.time - soft.expectedTimes[index])).toBeLessThan(0.004),
      );
    });

    it("rejects ongoing room noise after one accent", () => {
      const { samples, expectedTimes } = roomNoiseAfterAccentFixture(48000);
      const result = analyzeOnsets(samples, 48000, profile, "captured");
      expect(result.onsets).toHaveLength(1);
      expect(Math.abs(result.onsets[0].time - expectedTimes[0])).toBeLessThan(0.004);
    });

    it.each([4410, 4449])(
      "makes quiet-hat profile/alignment losses visible at %i lead-in frames",
      (lead) => {
        const pcm = new Float32Array(lead + dynamic.samples.length);
        pcm.set(dynamic.samples, lead);
        const result = analyzeOnsets(pcm, dynamic.sampleRate, profile, "captured");
        const expected = Array.from({ length: 8 }, (_, i) => i).filter(
          (index) =>
            profile !== "conservative" || !(lead === 4449 ? [1, 3, 5] : [1, 3]).includes(index),
        );
        const rows = gridRows(result.onsets, {
          ...dynamic.metadata,
          renderOffsetSeconds: lead / dynamic.sampleRate,
          expectedGridSeconds: dynamic.metadata.expectedGridSeconds!.map(
            (time) => time + lead / dynamic.sampleRate,
          ),
        });
        expect(rows.filter((row) => row.status === "extra")).toHaveLength(0);
        for (const index of expected) {
          expect(
            result.onsets.some(
              (hit) => Math.abs(hit.time - lead / dynamic.sampleRate - index * 0.25) < 0.02,
            ),
          ).toBe(true);
        }
      },
    );
  },
);

describe("honest grid reporting", () => {
  it("keeps production startup separate from assumed silent prehistory, with unshifted source time", () => {
    const original = analyzeOnsets(dynamic.samples, dynamic.sampleRate, "default", "captured");
    const experiment = analyzeOnsets(
      dynamic.samples,
      dynamic.sampleRate,
      "default",
      "assumed-silent",
    );
    expect(original.assumedSilentFrames).toBe(0);
    expect(original.onsets).toHaveLength(7);
    expect(experiment.onsets).toHaveLength(8);
    expect(experiment.onsets[0].time).toBeLessThan(0.004);
    expect(experiment.onsets.slice(1)).toEqual(original.onsets);
    expect(
      gridRows(original.onsets, dynamic.metadata).find((row) => row.status === "missing")?.position,
    ).toBe("1.1");
  });

  it("shows every duplicate and missing event instead of hiding extras in a summary", () => {
    const onsets = [0.004, 0.027, 0.496, 1.004, 1.033].map((time) => ({
      time,
      strength: 0.5,
      confidence: 0.9,
    }));
    const rows = gridRows(onsets, dynamic.metadata);
    expect(rows.filter((row) => row.detectedSeconds !== null)).toHaveLength(onsets.length);
    expect(rows.filter((row) => row.status === "extra")).toHaveLength(2);
    expect(rows.filter((row) => row.status === "missing")).toHaveLength(5);
    expect(rows.find((row) => row.detectedSeconds === 0.496)?.errorMs).toBeCloseTo(-4);
    const table = formatGridTable(rows);
    expect(table).toContain("0.027000 s");
    expect(table).toContain("1.033000 s");
    expect(table.split("\n")).toHaveLength(rows.length + 2);
  });

  it("leaves grid positions/errors unknown when no origin is established", () => {
    const rows = gridRows([{ time: 0.2, strength: 0.2, confidence: 0.9 }], {
      ...dynamic.metadata,
      patternStatus: "unknown",
      expectedGridSeconds: null,
      renderOffsetSeconds: null,
      gridOriginStatus: "unknown",
    });
    expect(rows[0]).toMatchObject({ position: null, errorMs: null, status: "unconfirmed" });
  });
});
