/** Host Swift capture contract; synthetic PCM, not physical-device recording. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { OnsetDetector, type DetectedOnset } from '../../../src/audio/onset-detector'
import { levelRecoveryFixture } from '../../../src/audio/fixtures/level-recovery'

const base = fileURLToPath(new URL('..', import.meta.url))
const temporary = mkdtempSync(join(tmpdir(), 'forgettime-ios-capture-'))
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error ?? result.stderr}`)
  return result.stdout
}
try {
  run('swiftc', ['-module-cache-path', join(temporary, 'swift-cache'),
    ...['DrumOnsetDetector', 'WaveformEnvelopeCapture', 'NativeCaptureStream'].map(name => resolve(base, `ios/Sources/ForgettimeAudioPlugin/${name}.swift`)),
    resolve(base, 'tests/ios-capture/main.swift'), '-o', join(temporary, 'capture')])
  console.log(run(join(temporary, 'capture'), []))
  for (const rate of [44100, 48000]) {
    const fixture = levelRecoveryFixture(rate)
    const input = join(temporary, `source-${rate}.f32`)
    const output = join(temporary, `retained-${rate}.f32`)
    const bytes = Buffer.from(fixture.samples.buffer)
    writeFileSync(input, bytes)
    const actual = JSON.parse(run(join(temporary, 'capture'), [input, String(rate), output])) as {
      onsets: DetectedOnset[]; packets: { startFrame: number; count: number; time: number }[]
    }
    assert.deepEqual(readFileSync(output), bytes, 'Every source sample, including opening onset context, survives native capture')
    const detector = new OnsetDetector()
    const expected = detector.process(fixture.samples, 0, rate)
    assert.equal(actual.onsets.length, fixture.expectedTimes.length)
    actual.onsets.forEach((onset, index) => {
      assert.ok(Math.abs(onset.time - fixture.expectedTimes[index]) < 0.004, 'Known fixture attack time')
      for (const field of ['time', 'strength', 'confidence'] as const) {
        assert.ok(Math.abs(onset[field] - expected[index][field]) < 1e-10, `${rate} native capture ${field} parity`)
      }
    })
    let expectedFrame = 0
    let watermark = 0
    for (const packet of actual.packets) {
      assert.equal(packet.startFrame, expectedFrame)
      expectedFrame += packet.count
      assert.ok(packet.time >= watermark && packet.time <= expectedFrame / rate + 1e-10)
      watermark = packet.time
    }
    assert.equal(expectedFrame, fixture.samples.length)
    console.log(`Swift capture: exact retained PCM, opening attacks and TypeScript parity at ${rate} Hz across variable callbacks`)
  }
} finally { rmSync(temporary, { recursive: true, force: true }) }
