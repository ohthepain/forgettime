/** Native Swift replay seam driven by synthetic output sample positions, not device audio. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { OnsetDetector } from '../../../src/audio/onset-detector'
import { DEFAULT_DETECTOR_SETTINGS } from '../../../src/audio/detector-contract'
const directory = mkdtempSync(join(tmpdir(), 'forgettime-swift-replay-'))
try {
  const binary = join(directory, 'replay')
  execFileSync('swiftc', ['-module-cache-path', join(directory, 'cache'),
    ...['DrumOnsetDetector', 'NativeReplayStream'].map(name => resolve(`plugins/forgettime-audio/ios/Sources/ForgettimeAudioPlugin/${name}.swift`)),
    resolve('plugins/forgettime-audio/tests/ios-replay/main.swift'), '-o', binary])
  console.log(execFileSync(binary, [], { encoding: 'utf8' }))
  for (const rate of [44100, 48000]) {
    const source = new Float32Array(rate / 2)
    for (const start of [0.04, 0.27, 0.48]) {
      for (let i = 0; i < rate * 0.015; i++) {
        const frame = Math.round(start * rate) + i
        if (frame < source.length) source[frame] += 0.5 * Math.sin(i * 1.7) * Math.exp(-i / (rate * 0.003))
      }
    }
    const path = join(directory, 'source.f32')
    writeFileSync(path, Buffer.from(source.buffer))
    const polls = [127, 1024, rate, rate + 381, rate * 2]
    for (const settings of [DEFAULT_DETECTOR_SETTINGS, { ...DEFAULT_DETECTOR_SETTINGS, minimumRms: 0.1, contrastRatio: 4 }]) {
    const actual = execFileSync(binary, [path, String(rate), JSON.stringify(settings), polls.join(',')], { encoding: 'utf8', maxBuffer: 8e6 }).trim().split('\n').map(line => JSON.parse(line))
    const detector = new OnsetDetector(settings)
    let cursor = 0
    actual.forEach((packet, index) => {
      const chunk = new Float32Array(polls[index] - cursor)
      for (let i = 0; i < chunk.length; i++) chunk[i] = source[(cursor + i) % source.length]
      const expected = detector.process(chunk, cursor / rate, rate)
      const diagnostics = detector.drainDiagnostics()
      cursor = polls[index]
      assert.equal(packet.audibleFrame, polls[index])
      assert.equal(packet.analyzedThroughFrame, Math.round((detector.processedThrough ?? 0) * rate))
      assert.equal(packet.onsets.length, expected.length)
      packet.onsets.forEach((hit: any, i: number) => assert.ok(Math.abs(hit.time - expected[i].time) < 1e-10))
      assert.deepEqual(packet.diagnostics.candidates.map((v: any) => [v.id, v.accepted, v.reasons]), diagnostics.candidates.map(v => [v.id, v.accepted, v.reasons]))
    })
    if (settings.minimumRms === 0.1) assert.equal(actual.reduce((count, frame) => count + frame.onsets.length, 0), 0)
    }
    console.log(`Swift replay carries native detector state across four loops at ${rate} Hz`)
  }
} finally { rmSync(directory, { recursive: true, force: true }) }
