import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { expect, it } from 'vite-plus/test'
import { BrowserOutputAlignment } from '../../../src/audio/output-alignment'
import { OnsetDetector } from '../../../src/audio/onset-detector'
import { TimingEngine } from '../../../src/audio/engine'
import { MetronomeCoach } from '../../../src/audio/metronome'
import { BarWaveformBuffer } from '../../../src/audio/bar-waveform'

type Samples = { type: 'samples'; samples: Float32Array; startFrame: number; sampleRate: number }
function createWorklet() {
  const messages: (Samples | { type: 'gap' })[] = []
  let Processor: new () => { process: (input: Float32Array[][], output?: Float32Array[][]) => boolean; port: { onmessage: (event: { data: unknown }) => void } }
  const sandbox = {
    AudioWorkletProcessor: class { port = { postMessage: (message: typeof messages[number]) => messages.push(message) } },
    Float32Array, sampleRate: 48000, currentFrame: 144000,
    registerProcessor: (_name: string, implementation: typeof Processor) => { Processor = implementation },
  }
  vm.runInNewContext(readFileSync(new URL('../../../public/audio/capture-worklet.js', import.meta.url), 'utf8'), sandbox)
  const capture = new Processor!()
  function render(samples: Float32Array | null, length = 128) {
    const output = new Float32Array(samples?.length ?? length)
    capture.process([samples ? [samples] : []], [[output]])
    sandbox.currentFrame += samples?.length ?? length
    return output
  }
  return { messages, sandbox, render, command: (plan: unknown) => capture.port.onmessage({ data: { type: 'metronome', plan } }), batches: () => messages.filter((message): message is Samples => message.type === 'samples') }
}

it('transfers silent captured frames with their sample positions for the pause clock', () => {
  const { render, batches } = createWorklet()
  for (let i = 0; i < 16; i++) render(new Float32Array(128))
  expect(batches().map(({ startFrame }) => startFrame)).toEqual([144000, 145024])
  expect(batches()[1].samples).toHaveLength(1024)
  expect(batches()[1].samples.every(sample => sample === 0)).toBe(true)
})

it('waits through empty startup quanta without fabricating silence or an interruption', () => {
  const { render, messages, batches } = createWorklet()
  for (let i = 0; i < 10; i++) render(null)
  expect(messages).toEqual([])
  for (let i = 0; i < 8; i++) render(new Float32Array(128))
  expect(messages).toHaveLength(1)
  expect(batches()[0].startFrame).toBe(145280)
})

it('discards a partial packet across empty input and reports a single gap before resuming', () => {
  const { render, messages, batches, sandbox } = createWorklet()
  for (let i = 0; i < 11; i++) render(new Float32Array(128).fill(0.1))
  for (let i = 0; i < 4; i++) render(null)
  const resumedAt = sandbox.currentFrame
  for (let i = 0; i < 8; i++) render(new Float32Array(128).fill(0.5))
  expect(messages.map(message => message.type)).toEqual(['samples', 'gap', 'samples'])
  expect(batches()[1].startFrame).toBe(resumedAt)
  expect(batches()[1].samples.every(sample => sample === 0.5)).toBe(true)
})

it.each([128, -128])('detects a render-clock jump of %i frames inside a partially filled packet', jump => {
  const { render, messages, batches, sandbox } = createWorklet()
  render(new Float32Array(128).fill(0.1))
  sandbox.currentFrame += jump
  const resumedAt = sandbox.currentFrame
  for (let i = 0; i < 8; i++) render(new Float32Array(128).fill(0.5))
  expect(messages.map(message => message.type)).toEqual(['gap', 'samples'])
  expect(batches()[0].startFrame).toBe(resumedAt)
  expect(batches()[0].samples.every(sample => sample === 0.5)).toBe(true)
})

it('keeps exact packet timestamps with nonstandard render quantum sizes', () => {
  const { render, messages, batches } = createWorklet()
  for (let i = 0; i < 16; i++) render(new Float32Array(192))
  expect(messages.map(message => message.type)).toEqual(['samples', 'samples', 'samples'])
  expect(batches().map(message => message.startFrame)).toEqual([144000, 145024, 146048])
})

it('renders audible quarter-note clicks on sample frames, accents beat 1 and expires the plan without JS callbacks', () => {
  const { render, command, batches } = createWorklet()
  command({ origin: 3, bpm: 120, fromBeat: 1, untilTime: 5.025 })
  const output: number[] = []
  for (let i = 0; i < 1000; i++) output.push(...render(new Float32Array(128)))
  // The opening hit defines beat 1; no retrospective click. Then 2, 3, 4, accented 1.
  const starts = output.flatMap((sample, index) => Math.abs(sample) > 1e-5 && (index === 0 || !output.slice(Math.max(0, index - 100), index).some(v => Math.abs(v) > 1e-5)) ? [index] : [])
  expect(starts).toEqual([24001, 48001, 72001, 96001])
  const peak = (start: number) => Math.max(...output.slice(start, start + 1200).map(Math.abs))
  expect(peak(96000)).toBeGreaterThan(peak(24000))
  expect(output.slice(97200).every(sample => sample === 0)).toBe(true)
  expect(batches().every(batch => batch.samples.every(sample => sample === 0))).toBe(true) // No electrical loopback.
})

it('silences a muted or interrupted metronome without discarding microphone samples', () => {
  const { render, command, sandbox, batches } = createWorklet()
  const plan = { origin: 2.5, bpm: 120, fromBeat: 1, untilTime: 4 }
  command(plan)
  expect(render(new Float32Array(128).fill(0.25)).some(value => value !== 0)).toBe(true)
  command(null)
  expect(render(new Float32Array(128).fill(0.25)).every(value => value === 0)).toBe(true)
  command(plan)
  render(null)
  for (let i = 0; i < 8; i++) expect(render(new Float32Array(128).fill(0.25)).every(value => value === 0)).toBe(true)
  expect(batches().at(-1)?.samples.every(sample => sample === 0.25)).toBe(true)
  expect(sandbox.currentFrame).toBeGreaterThan(144000)
})

it('skips a click when activation arrives after its deadline, retaining the next beat across plan renewals', () => {
  const { render, command, sandbox } = createWorklet()
  sandbox.currentFrame = 144480 // 3.010 s: already 10 ms into the click scheduled for 3 s.
  const output: number[] = []
  for (let i = 0; i < 250; i++) {
    command({ origin: 2.5, bpm: 120, fromBeat: 1, untilTime: 4 })
    output.push(...render(new Float32Array(128)))
  }
  expect(output.findIndex(value => Math.abs(value) > 1e-5)).toBe(168001 - 144480)
})

it.each([[90, 0], [120, 0], [90, 0.025], [120, 0.025]])('compensates 250 ms of device delay at %i BPM while preserving %s seconds of later drift', (bpm, drift) => {
  const rate = 48000
  const delay = Math.round(rate * 0.25)
  const { render, command, sandbox, batches } = createWorklet()
  sandbox.currentFrame = 0
  const detector = new OnsetDetector()
  // This output-clock fixture deliberately detects quiet loopback clicks.
  const engine = new TimingEngine({ bpm, startSensitivity: 100 })
  const coach = new MetronomeCoach()
  const alignment = new BrowserOutputAlignment()
  const waveform = new BarWaveformBuffer()
  const recorded: number[] = []
  const count = Math.ceil((0.1 + 60 / bpm * 8) * rate / 128)
  const loopback = new Float32Array(count * 128 + delay + Math.ceil(drift * rate))
  let consumed = 0
  engine.start(0)
  for (let quantum = 0; quantum < count; quantum++) {
    const frame = sandbox.currentFrame
    const input = loopback.slice(frame, frame + 128)
    for (let i = 0; i < input.length; i++) {
      const age = (frame + i) / rate - 0.1
      if (age >= 0 && age < 0.015) input[i] += 0.8 * Math.exp(-age * 200)
    }
    const output = render(input)
    // Change delay between clicks, never halfway through a render quantum's attack.
    const late = frame / rate >= 0.1 + 60 / bpm * 3.5 - 0.25 ? Math.round(drift * rate) : 0
    loopback.set(output, frame + delay + late) // Physical output + input delay, not JS callback delay.
    for (const batch of batches().slice(consumed)) {
      const onsets = detector.process(batch.samples, batch.startFrame / rate, rate)
      const now = detector.processedThrough!
      for (const hit of onsets) { engine.addOnset(hit); recorded.push(hit.time) }
      const snapshot = engine.snapshot(now)
      const plan = coach.update(snapshot, now, { enabled: true, mode: 'always', thresholdMs: 100 }).plan
      command(alignment.align(plan, sandbox.currentFrame / rate, 0.25))
      const view = waveform.addFrame(now, [], onsets, snapshot)
      for (const hit of view.hits) {
        const distanceFromBeat = Math.abs(hit.position * 4 - Math.round(hit.position * 4)) * 60 / bpm
        expect(distanceFromBeat).toBeLessThan(drift + 0.004)
      }
      consumed++
    }
  }
  expect(recorded.length).toBeGreaterThanOrEqual(7)
  const origin = recorded[0]
  recorded.slice(1).forEach((time, index) => expect(time - origin - (index + 1) * 60 / bpm).toBeCloseTo(index + 1 >= 4 ? drift : 0, 2))
  expect(engine.snapshot(sandbox.currentFrame / rate).phaseOrigin).toBe(origin)
})
