/** Host-side port check with synthesized PCM; this is NOT physical-device validation. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { OnsetDetector, type DetectedOnset } from '../../../src/audio/onset-detector'

const base = fileURLToPath(new URL('..', import.meta.url))
const temporary = mkdtempSync(join(tmpdir(), 'forgettime-detector-parity-'))
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error ?? result.stderr}`)
  return result.stdout
}
function parse(output: string): DetectedOnset[] {
  return output.trim().split('\n').filter(Boolean).map((line) => {
    const [time, strength, confidence] = line.split(',').map(Number)
    return { time, strength, confidence }
  })
}
try {
  run('javac', ['-d', temporary, resolve(base, 'android/src/main/java/app/forgettime/audio/DrumOnsetDetector.java'), resolve(base, 'tests/ParityRunner.java')])
  run('swiftc', ['-module-cache-path', join(temporary, 'swift-cache'), resolve(base, 'ios/Sources/ForgettimeAudioPlugin/DrumOnsetDetector.swift'), resolve(base, 'tests/main.swift'), '-o', join(temporary, 'swift-parity')])
  for (const rate of [44100, 48000]) {
    let seed = 35231
    const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 31 - 1 }
    const samples = new Float32Array(rate * 6)
    for (let i = 0; i < samples.length; i++) samples[i] = noise() * 0.00015
    // Hard/soft hits, a close flam, rapid roll and a long ringing/noisy decay.
    const events = [[0.4, 0.7], [0.9, 0.5], [1.4, 0.04], [1.9, 0.6], [1.925, 0.4],
      [2.4, 0.5], [2.46, 0.3], [2.52, 0.4], [2.58, 0.3], [3.2, 0.8], [4.1, 0.05], [4.7, 0.7]]
    for (const [time, amplitude] of events) {
      const length = Math.round(rate * (time === 3.2 ? 1.7 : 0.12))
      const start = Math.round(time * rate)
      for (let n = 0; n < length && start + n < samples.length; n++) {
        const t = n / rate
        const decay = Math.exp(-t / (time === 3.2 ? 0.5 : 0.017))
        samples[start + n] += amplitude * decay * (Math.sin(2 * Math.PI * 173 * t) * 0.65 + noise() * 0.35)
      }
    }
    const path = join(temporary, `fixture-${rate}.f32`)
    writeFileSync(path, Buffer.from(samples.buffer))
    const detector = new OnsetDetector()
    const expected: DetectedOnset[] = []
    let frame = 0
    for (let chunk = 0; frame < samples.length; chunk++) {
      const size = [127, 1024, 256, 381][chunk % 4]
      const batch = samples.subarray(frame, Math.min(samples.length, frame + size))
      expected.push(...detector.process(batch, frame / rate, rate))
      frame += batch.length
    }
    assert.ok(expected.length >= 8, 'Fixture must exercise actual onset detections')
    for (const [language, actual] of [
      ['Java', parse(run('java', ['-cp', temporary, 'ParityRunner', path, String(rate)]))],
      ['Swift', parse(run(join(temporary, 'swift-parity'), [path, String(rate)]))],
    ] as const) {
      assert.equal(actual.length, expected.length, `${language} onset count at ${rate} Hz`)
      for (let i = 0; i < expected.length; i++) {
        for (const field of ['time', 'strength', 'confidence'] as const) {
          assert.ok(Math.abs(actual[i][field] - expected[i][field]) < 1e-10, `${language} ${field} onset ${i} at ${rate} Hz`)
        }
      }
      console.log(`${language}: ${actual.length} detections match TypeScript at ${rate} Hz (time/strength/confidence)`)
    }
  }
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
