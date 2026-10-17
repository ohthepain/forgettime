import {
  DEFAULT_DETECTOR_SETTINGS,
  normalizeDetectorSettings,
} from "../../src/audio/detector-contract";
import { OnsetDetector, type DetectedOnset } from "../../src/audio/onset-detector";
import type { FixtureMetadata } from "./audio-fixtures";

export const detectionProfiles = {
  default: normalizeDetectorSettings(DEFAULT_DETECTOR_SETTINGS),
  conservative: normalizeDetectorSettings({ minimumRms: 0.006 }),
};
export type ProfileName = keyof typeof detectionProfiles;
export type StartupMode = "captured" | "assumed-silent";

export function analyzeOnsets(
  samples: Float32Array,
  sampleRate: number,
  profile: ProfileName,
  startup: StartupMode,
  frequencyBalance = 0,
) {
  const settings = { ...detectionProfiles[profile] };
  const detector = new OnsetDetector(settings, frequencyBalance);
  let assumedSilentFrames = 0;
  if (startup === "assumed-silent") {
    // Explicit experiment: twelve silent detector windows before the WAV.
    // Their negative source times preserve every original sample timestamp.
    assumedSilentFrames = 12 * Math.max(32, Math.round(sampleRate * 0.002667));
    detector.process(
      new Float32Array(assumedSilentFrames),
      -assumedSilentFrames / sampleRate,
      sampleRate,
    );
    detector.drainDiagnostics();
  }
  const onsets: DetectedOnset[] = [];
  for (let offset = 0; offset < samples.length; offset += 997) {
    onsets.push(
      ...detector.process(samples.subarray(offset, offset + 997), offset / sampleRate, sampleRate),
    );
    detector.drainDiagnostics();
  }
  return { profile, startup, settings, frequencyBalance, assumedSilentFrames, onsets };
}

export interface GridRow {
  bar: number | null;
  position: string | null;
  detectedSeconds: number | null;
  gridSeconds: number | null;
  errorMs: number | null;
  status: "matched" | "extra" | "unconfirmed" | "missing";
}

export function gridRows(onsets: DetectedOnset[], metadata: FixtureMetadata): GridRow[] {
  const origin = metadata.renderOffsetSeconds;
  const step = 60 / metadata.bpm / 4;
  const locate = (time: number) => {
    if (origin === null) return { bar: null, position: null, gridSeconds: null };
    const index = Math.round((time - origin) / step);
    const withinBar = ((index % 16) + 16) % 16;
    return {
      bar: Math.floor(index / 16) + 1,
      position: `${Math.floor(withinBar / 4) + 1}.${(withinBar % 4) + 1}`,
      gridSeconds: origin + index * step,
    };
  };
  const remaining = new Set(onsets.map((_, index) => index));
  const matched = new Set<number>();
  const missing: number[] = [];
  for (const expected of metadata.expectedGridSeconds ?? []) {
    const index = [...remaining].sort(
      (a, b) => Math.abs(onsets[a].time - expected) - Math.abs(onsets[b].time - expected),
    )[0];
    if (
      index === undefined ||
      Math.abs(onsets[index].time - expected) * 1000 > metadata.associationToleranceMs
    )
      missing.push(expected);
    else {
      remaining.delete(index);
      matched.add(index);
    }
  }
  const rows: GridRow[] = onsets.map((onset, index) => {
    const location = locate(onset.time);
    return {
      ...location,
      detectedSeconds: onset.time,
      errorMs: location.gridSeconds === null ? null : (onset.time - location.gridSeconds) * 1000,
      status: matched.has(index)
        ? "matched"
        : metadata.patternStatus === "confirmed"
          ? "extra"
          : "unconfirmed",
    };
  });
  rows.push(
    ...missing.map((time) => ({
      ...locate(time),
      detectedSeconds: null,
      errorMs: null,
      status: "missing" as const,
    })),
  );
  return rows.sort(
    (a, b) => (a.detectedSeconds ?? a.gridSeconds ?? 0) - (b.detectedSeconds ?? b.gridSeconds ?? 0),
  );
}

export function formatGridTable(rows: GridRow[]) {
  const text = [
    "| Bar | Position | Detected time | Timing error | Result |",
    "|---|---|---:|---:|---|",
  ];
  for (const row of rows) {
    text.push(
      `| ${row.bar ?? "—"} | ${row.position ?? "—"} | ${row.detectedSeconds === null ? "—" : `${row.detectedSeconds.toFixed(6)} s`} | ${row.errorMs === null ? "—" : `${row.errorMs >= 0 ? "+" : ""}${row.errorMs.toFixed(2)} ms`} | ${row.status} |`,
    );
  }
  return text.join("\n");
}
