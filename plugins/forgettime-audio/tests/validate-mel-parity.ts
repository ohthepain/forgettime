/** Synthetic PCM clocks and real Java/Swift hosts; no physical device/acoustic validation. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import {
  MelDetector,
  DEFAULT_MEL_SETTINGS,
  type MelSettings,
} from "../../../src/audio/mel-detector";
const temp = mkdtempSync(join(tmpdir(), "forgettime-mel-"));
function command(bin: string, args: string[]) {
  const r = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`${bin}: ${r.error ?? r.stderr}`);
  return r.stdout;
}
function parse(text: string) {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      const [kind, ...v] = row.split(",");
      return { kind, values: v.map(Number) };
    });
}
function compare(
  actual: ReturnType<typeof parse>,
  expected: ReturnType<typeof parse>,
  name: string,
) {
  assert.equal(actual.length, expected.length, name + " row count");
  for (let i = 0; i < actual.length; i++) {
    assert.equal(actual[i].kind, expected[i].kind, name + " row kind");
    assert.equal(actual[i].values.length, expected[i].values.length);
    for (let j = 0; j < actual[i].values.length; j++) {
      const a = actual[i].values[j],
        e = expected[i].values[j];
      const kind = actual[i].kind;
      const exact =
        kind === "S" ||
        ((kind === "A" || kind === "O") && j < 2) ||
        (kind === "A" && j === 4) ||
        ((kind === "P" || kind === "M") && j === 0);
      if (exact) {
        assert.equal(a, e, `${name} exact source clock ${i}:${j}`);
        continue;
      }
      assert.ok(
        Number.isFinite(a) && Math.abs(a - e) <= 1e-8 * Math.max(1, Math.abs(e)),
        `${name} ${i}:${j}: ${a} vs ${e}`,
      );
    }
  }
}
type Mode = "ringing" | "silence" | "constant" | "impulse" | "rate-change" | "threshold";
function reference(rate: number, config: MelSettings, mode: Mode) {
  const count = Math.floor(rate * 0.65),
    bytes = Buffer.alloc(count * 16),
    d = new MelDetector(config),
    expected: ReturnType<typeof parse> = [];
  let last = -1,
    rows = 0;
  for (let i = 0; i < count; i++) {
    let value = mode === "constant" ? 0.25 : mode === "impulse" && i === 512 ? 1 : 0;
    if (mode === "threshold")
      value =
        (0.05 + 0.03 * Math.sin((i / rate) * 2 * Math.PI * 37)) *
        (Math.sin(i * 0.371) + 0.2 * Math.sin(i * 0.177));
    if (mode === "ringing" || mode === "rate-change")
      for (const [time, gain, decay] of [
        [0.18, 0.8, 0.07],
        [0.22, 0.3, 0.015],
        [0.4, 0.6, 0.03],
        [0.43, 0.2, 0.008],
      ])
        if (i >= Math.round(time * rate)) {
          const t = i - Math.round(time * rate);
          value += gain * Math.exp(-t / (rate * decay)) * Math.sin(t * 2.7123);
        }
    const sample = Math.fround(value),
      frame = i + (i >= Math.floor(rate * 0.5) ? 71 : 0),
      actualRate = mode === "rate-change" && i >= Math.floor(rate * 0.3) ? 44100 : rate;
    bytes.writeFloatLE(sample, i * 16);
    bytes.writeBigInt64LE(BigInt(frame), i * 16 + 4);
    bytes.writeInt32LE(actualRate, i * 16 + 12);
    const onset = d.process(sample, frame, actualRate),
      clock = d.state;
    const row =
      clock.receivedThroughFrame - clock.segmentStartFrame >= clock.windowFrames &&
      clock.pendingSamples === 0
        ? d.diagnostic.row
        : null;
    if (row && row.through !== last) {
      last = row.through;
      expected.push({
        kind: "A",
        values: [row.through, row.center, row.flux, row.threshold, row.ready ? 1 : 0],
      });
      if (rows++ % 47 === 0) {
        expected.push(
          { kind: "P", values: [row.through, ...d.diagnostic.power] },
          { kind: "M", values: [row.through, ...d.diagnostic.logMel] },
        );
      }
    }
    if (onset)
      expected.push({
        kind: "O",
        values: [onset.sourceFrame, onset.analyzedThroughFrame, onset.flux, onset.threshold],
      });
  }
  const state = d.state;
  expected.push({
    kind: "S",
    values: [
      state.windowFrames,
      state.hopFrames,
      state.processedThroughFrame,
      state.reliableFromFrame,
      state.receivedThroughFrame,
    ],
  });
  return { bytes, expected };
}
try {
  command("javac", [
    "-d",
    temp,
    "plugins/forgettime-audio/android/src/main/java/app/forgettime/audio/MelDetector.java",
    "plugins/forgettime-audio/tests/MelParityRunner.java",
  ]);
  command("swiftc", [
    "-module-cache-path",
    join(temp, "swift-cache"),
    "plugins/forgettime-audio/ios/Sources/ForgettimeAudioPlugin/MelDetector.swift",
    "plugins/forgettime-audio/tests/mel-parity/main.swift",
    "-o",
    join(temp, "mel-swift"),
  ]);
  let cases = 0;
  function check(rate: number, config: MelSettings, mode: Mode = "ringing") {
    const { bytes, expected } = reference(rate, config, mode),
      file = join(temp, "pcm.bin");
    writeFileSync(file, bytes);
    const args = [
      file,
      String(config.windowMs),
      String(config.bands),
      String(config.neighbor),
      String(config.confirmation),
      String(config.rearming),
      String(config.threshold),
    ];
    compare(
      parse(command("java", ["-cp", temp, "MelParityRunner", ...args])),
      expected,
      `Java ${rate} ${mode}`,
    );
    compare(parse(command(join(temp, "mel-swift"), args)), expected, `Swift ${rate} ${mode}`);
    cases++;
  }
  const settings: MelSettings[] = [
    { ...DEFAULT_MEL_SETTINGS },
    { ...DEFAULT_MEL_SETTINGS, windowMs: 40, bands: 96, neighbor: 3, confirmation: 2 },
    {
      ...DEFAULT_MEL_SETTINGS,
      bands: 24,
      neighbor: 1,
      confirmation: 0,
      rearming: false,
      threshold: 0.5,
    },
    { ...DEFAULT_MEL_SETTINGS, windowMs: 10, bands: 24, threshold: 4 },
  ];
  for (const rate of [8000, 44100, 48000, 192000])
    for (const config of settings) check(rate, config);
  for (const mode of ["silence", "constant", "impulse", "rate-change"] as Mode[])
    check(48000, { ...DEFAULT_MEL_SETTINGS }, mode);
  // Derive a true decision threshold from causal feature history, then compare both sides.
  const base = reference(
    48000,
    { ...DEFAULT_MEL_SETTINGS, confirmation: 0, rearming: false },
    "threshold",
  );
  const history: number[] = [];
  let edge: number | null = null;
  for (const row of base.expected.filter((r) => r.kind === "A")) {
    const flux = row.values[2],
      mean = history.reduce((a, b) => a + b, 0) / Math.max(1, history.length),
      sd = Math.sqrt(
        history.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, history.length),
      ),
      k = (flux - mean - 0.005) / sd;
    if (history.length === 40 && flux > history[history.length - 1] && k > 0.6 && k < 3.9) {
      edge = k;
      break;
    }
    history.push(flux);
    if (history.length > 40) history.shift();
  }
  assert.notEqual(edge, null, "fixture must exercise threshold-adjacent decisions");
  for (const delta of [-1e-6, 1e-6])
    check(
      48000,
      {
        ...DEFAULT_MEL_SETTINGS,
        confirmation: 0,
        rearming: false,
        threshold: edge! + delta,
      },
      "threshold",
    );
  // Invalid filter/rate combinations must reject on all three implementations.
  const invalid = Buffer.alloc(16);
  invalid.writeInt32LE(8000, 12);
  const file = join(temp, "invalid.bin");
  writeFileSync(file, invalid);
  const badArgs = [file, "10", "96", "5", "1", "true", "2"];
  assert.throws(() =>
    new MelDetector({ ...DEFAULT_MEL_SETTINGS, windowMs: 10, bands: 96 }).process(0, 0, 8000),
  );
  for (const [bin, args] of [
    ["java", ["-cp", temp, "MelParityRunner", ...badArgs]],
    [join(temp, "mel-swift"), badArgs],
  ] as [string, string[]][])
    assert.notEqual(
      spawnSync(bin, args, { encoding: "utf8" }).status,
      0,
      "native invalid configuration must reject",
    );
  console.log(
    `Mel spectra/log-mel/flux/onset/watermark parity passed: ${cases} cases, 8–192 kHz; ringing, quiet follow-ups, silence, analytic signals, gaps/rate changes, threshold-adjacent and invalid-filter checks. Real Java/Swift host code; no device claim.`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
