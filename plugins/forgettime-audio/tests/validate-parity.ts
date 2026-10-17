import { frequencyOverlapFixture } from '../../../src/audio/fixtures/frequency-overlap'
/** Host-side port check with synthetic PCM and supplied WAVs, not physical-device validation. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { OnsetDetector, type DetectedOnset } from "../../../src/audio/onset-detector";
import {
  WaveformEnvelopeCapture,
  type WaveformEnvelope,
} from "../../../src/audio/waveform-envelope";
import {
  accentFollowUpFixture,
  levelRecoveryFixture,
  roomNoiseAfterAccentFixture,
} from "../../../src/audio/fixtures/level-recovery";
import { decodeWav } from "../../../scripts/lib/wav";
import { detectionProfiles } from "../../../scripts/lib/audio-comparison";
import {
  DEFAULT_DETECTOR_SETTINGS,
  type DetectorSettings,
} from "../../../src/audio/detector-contract";

const base = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "forgettime-detector-parity-"));
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed: ${result.error ?? result.stderr}`);
  return result.stdout;
}
function parse(output: string): DetectedOnset[] {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [time, strength, confidence] = line.split(",").map(Number);
      return { time, strength, confidence };
    });
}
try {
  run("javac", [
    "-d",
    temporary,
    ...["DrumOnsetDetector", "WaveformEnvelopeCapture"].map((name) =>
      resolve(base, `android/src/main/java/app/forgettime/audio/${name}.java`),
    ),
    resolve(base, "tests/ParityRunner.java"),
  ]);
  run("swiftc", [
    "-module-cache-path",
    join(temporary, "swift-cache"),
    ...["DrumOnsetDetector", "WaveformEnvelopeCapture"].map((name) =>
      resolve(base, `ios/Sources/ForgettimeAudioPlugin/${name}.swift`),
    ),
    resolve(base, "tests/main.swift"),
    "-o",
    join(temporary, "swift-parity"),
  ]);
  for (const rate of [44100, 48000]) {
    let seed = 35231;
    const noise = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 31 - 1;
    };
    const samples = new Float32Array(rate * 6);
    for (let i = 0; i < samples.length; i++) samples[i] = noise() * 0.00015;
    // Hard/soft hits, a close flam, rapid roll and a long ringing/noisy decay.
    const events = [
      [0.4, 0.7],
      [0.9, 0.5],
      [1.4, 0.04],
      [1.9, 0.6],
      [1.925, 0.4],
      [2.4, 0.5],
      [2.46, 0.3],
      [2.52, 0.4],
      [2.58, 0.3],
      [3.2, 0.8],
      [4.1, 0.05],
      [4.7, 0.7],
    ];
    for (const [time, amplitude] of events) {
      const length = Math.round(rate * (time === 3.2 ? 1.7 : 0.12));
      const start = Math.round(time * rate);
      for (let n = 0; n < length && start + n < samples.length; n++) {
        const t = n / rate;
        const decay = Math.exp(-t / (time === 3.2 ? 0.5 : 0.017));
        samples[start + n] +=
          amplitude * decay * (Math.sin(2 * Math.PI * 173 * t) * 0.65 + noise() * 0.35);
      }
    }
    function compare(
      name: string,
      pcm: Float32Array,
      silent = false,
      expectedTimes?: number[],
      settings: DetectorSettings = DEFAULT_DETECTOR_SETTINGS,
      associationToleranceSeconds = 0.004,
      frequencyBalance = 0,
    ) {
      const path = join(temporary, `${name}-${rate}.f32`);
      writeFileSync(path, Buffer.from(pcm.buffer));
      const detector = new OnsetDetector(settings, frequencyBalance);
      const waveform = new WaveformEnvelopeCapture();
      const envelope: WaveformEnvelope[] = [];
      const expected: DetectedOnset[] = [];
      let frame = 0;
      for (let chunk = 0; frame < pcm.length; chunk++) {
        const size = [127, 1024, 256, 381][chunk % 4];
        const batch = pcm.subarray(frame, Math.min(pcm.length, frame + size));
        expected.push(...detector.process(batch, frame / rate, rate));
        envelope.push(...waveform.process(batch, frame / rate, rate));
        frame += batch.length;
      }
      if (silent)
        assert.equal(expected.length, 0, "Synthetic ambience must not start a performance");
      else if (expectedTimes) {
        assert.equal(expected.length, expectedTimes.length, `${name}: expected attack count`);
        expectedTimes.forEach((time, i) =>
          assert.ok(
            Math.abs(expected[i].time - time) < associationToleranceSeconds,
            `${name}: attack ${i}`,
          ),
        );
      } else assert.ok(expected.length > 0, "Fixture must exercise actual onset detections");
      const nativeSettings = [
        settings.minimumRms,
        settings.contrastRatio,
        settings.minSeparationMs,
        settings.recoverySeconds,
        frequencyBalance,
      ].map(String);
      for (const [language, actual] of [
        [
          "Java",
          parse(
            run("java", [
              "-cp",
              temporary,
              "ParityRunner",
              path,
              String(rate),
              "onsets",
              ...nativeSettings,
            ]),
          ),
        ],
        [
          "Swift",
          parse(
            run(join(temporary, "swift-parity"), [path, String(rate), "onsets", ...nativeSettings]),
          ),
        ],
      ] as const) {
        assert.equal(
          actual.length,
          expected.length,
          `${language} ${name} onset count at ${rate} Hz`,
        );
        for (let i = 0; i < expected.length; i++) {
          for (const field of ["time", "strength", "confidence"] as const) {
            assert.ok(
              Math.abs(actual[i][field] - expected[i][field]) < 1e-10,
              `${language} ${name} ${field} onset ${i} at ${rate} Hz`,
            );
          }
        }
        console.log(
          `${language} ${name}: ${actual.length} detections match TypeScript at ${rate} Hz (time/strength/confidence)`,
        );
      }
      if (name === "percussion" || silent) {
        for (const [language, output] of [
          ["Java", run("java", ["-cp", temporary, "ParityRunner", path, String(rate), "waveform"])],
          ["Swift", run(join(temporary, "swift-parity"), [path, String(rate), "waveform"])],
        ]) {
          const actual = output
            .trim()
            .split("\n")
            .map((line) => line.split(",").map(Number));
          assert.equal(actual.length, envelope.length, `${language} waveform count`);
          actual.forEach((row, i) =>
            [envelope[i].time, envelope[i].duration, envelope[i].min, envelope[i].max].forEach(
              (value, field) => {
                assert.ok(
                  Math.abs(row[field] - value) < 1e-10,
                  `${language} waveform ${name} ${i}/${field}`,
                );
              },
            ),
          );
          console.log(
            `${language} ${name}: ${actual.length} waveform min/max windows match TypeScript at ${rate} Hz`,
          );
        }
      }
    }
    const overlap = frequencyOverlapFixture(rate);
    compare("frequency-overlap", overlap.samples, false, overlap.expectedTimes, DEFAULT_DETECTOR_SETTINGS, .006, 100);
    compare("percussion", samples);
    for (const balance of [50, 100]) compare(`percussion-balance-${balance}`, samples, false, undefined, DEFAULT_DETECTOR_SETTINGS, .004, balance);
    if (rate === 44100) {
      // Real supplied render plus a deliberate startup lead-in. Native/shared
      // parity here is offline behavior, not a physical microphone benchmark.
      for (const name of ["beat 1 simple 120", "beat 1 simple dyn 120"]) {
        const recording = decodeWav(
          readFileSync(resolve(base, `../../test-data/audio/${name}.wav`)),
        );
        assert.equal(recording.sampleRate, rate);
        for (const lead of [4410, 4449]) {
          const pcm = new Float32Array(lead + recording.samples.length);
          pcm.set(recording.samples, lead);
          for (const [profile, settings] of Object.entries(detectionProfiles)) {
            // The sensitive default must retain every group. Conservative
            // quiet-hat recall is checked in the profile matrix; parity checks
            // the complete resulting candidate stream without blessing misses.
            const times =
              profile === "default" || !name.includes("dyn")
                ? Array.from({ length: 8 }, (_, i) => i * 0.25 + lead / rate)
                : undefined;
            compare(`${name}-${lead}-${profile}`, pcm, false, times, settings, 0.02);
            for (const balance of [50, 100]) compare(`${name}-${lead}-${profile}-balance-${balance}`, pcm, false, times, settings, .02, balance);
          }
        }
      }
    }
    const rumble = new Float32Array(samples.length);
    const mixed = new Float32Array(samples.length);
    for (let i = 0; i < rumble.length; i++) {
      const time = i / rate;
      rumble[i] =
        0.04 *
        (0.4 + 0.6 * Math.sin((Math.PI * time) / 6) ** 2) *
        (0.8 * Math.sin(2 * Math.PI * 45 * time) + 0.2 * noise());
      mixed[i] = samples[i] + rumble[i] * 0.3;
    }
    compare("ambient-rumble", rumble, true);
    for (const balance of [50, 100]) compare(`ambient-rumble-balance-${balance}`, rumble, true, undefined, DEFAULT_DETECTOR_SETTINGS, .004, balance);
    compare("percussion-with-rumble", mixed);
    for (const [name, fixture] of [
      [
        "sensitive-level-recovery",
        {
          samples: levelRecoveryFixture(rate).samples,
          expectedTimes: levelRecoveryFixture(rate).sensitiveExpectedTimes,
        },
      ],
      ["softer-accent-follow-ups", accentFollowUpFixture(rate)],
      ["room-noise-after-accent", roomNoiseAfterAccentFixture(rate)],
    ] as const)
      {
        compare(name, fixture.samples, false, fixture.expectedTimes);
        for (const balance of [50, 100]) compare(`${name}-balance-${balance}`, fixture.samples, false, fixture.expectedTimes, DEFAULT_DETECTOR_SETTINGS, .004, balance);
      }
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
