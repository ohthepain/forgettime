/** Synthetic host Swift settings/candidate parity; not device or acoustic evidence. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { OnsetDetector } from '../../../src/audio/onset-detector'
import { DEFAULT_DETECTOR_SETTINGS, DETECTOR_CONTROLS } from '../../../src/audio/detector-contract'
import { levelRecoveryFixture } from '../../../src/audio/fixtures/level-recovery'
const directory = mkdtempSync(join(tmpdir(), 'forgettime-swift-diagnostics-'))
try {
  const binary = join(directory, 'diagnostics')
  execFileSync('swiftc', ['-module-cache-path', join(directory, 'cache'),
    resolve('plugins/forgettime-audio/ios/Sources/ForgettimeAudioPlugin/DrumOnsetDetector.swift'),
    resolve('plugins/forgettime-audio/tests/ios-diagnostics/main.swift'), '-o', binary])
  for (const rate of [44100, 48000]) {
    const fixture = levelRecoveryFixture(rate)
    const path = join(directory, 'samples.f32')
    writeFileSync(path, Buffer.from(fixture.samples.buffer))
    const settingsCases = [DEFAULT_DETECTOR_SETTINGS, ...Object.entries(DETECTOR_CONTROLS).flatMap(([key, bounds]) =>
      [bounds.min, bounds.max].map(value => ({ ...DEFAULT_DETECTOR_SETTINGS, [key]: value })))]
    function compare(actual: any, expected: any, path = 'result') {
      if (typeof expected === 'number') { assert.ok(Math.abs(actual - expected) < 1e-9, `${path}: ${actual} vs ${expected}`); return }
      if (expected === null || typeof expected !== 'object') { assert.equal(actual, expected, path); return }
      assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path)
      for (const key of Object.keys(expected)) compare(actual[key], expected[key], `${path}.${key}`)
    }
    for (const settings of settingsCases) {
      const detector = new OnsetDetector(settings)
      const onsets = detector.process(fixture.samples, 0, rate)
      const diagnostics = detector.drainDiagnostics()
      const actual = JSON.parse(execFileSync(binary, [path, String(rate), JSON.stringify(settings)], { encoding: 'utf8', maxBuffer: 8e6 }))
      compare(actual, { onsets, diagnostics })
    }
    const noise = Float32Array.from({ length: 16 * rate }, (_, i) => Math.floor(i / 128) % 2 ? (i % 2 ? -0.1 : 0.1) : 0)
    writeFileSync(path, Buffer.from(noise.buffer))
    const detector = new OnsetDetector()
    const onsets = detector.process(noise, 0, rate)
    const diagnostics = detector.drainDiagnostics()
    const capped = JSON.parse(execFileSync(binary, [path, String(rate), JSON.stringify(DEFAULT_DETECTOR_SETTINGS)], { encoding: 'utf8', maxBuffer: 8e6 }))
    compare(capped, { onsets, diagnostics })
    assert.equal(capped.diagnostics.candidates.length, 2048)
    assert.ok(capped.diagnostics.dropped > 0)
    console.log(`Swift default/every-setting-endpoint candidate/measurement parity and explicit cap at ${rate} Hz`)
  }
} finally { rmSync(directory, { recursive: true, force: true }) }
