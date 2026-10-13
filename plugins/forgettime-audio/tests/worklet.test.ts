import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { expect, it } from 'vitest'

type Samples = { type: 'samples'; samples: Float32Array; startFrame: number; sampleRate: number }
function createWorklet() {
  const messages: (Samples | { type: 'gap' })[] = []
  let Processor: new () => { process: (input: Float32Array[][]) => boolean }
  const sandbox = {
    AudioWorkletProcessor: class { port = { postMessage: (message: typeof messages[number]) => messages.push(message) } },
    Float32Array, sampleRate: 48000, currentFrame: 144000,
    registerProcessor: (_name: string, implementation: typeof Processor) => { Processor = implementation },
  }
  vm.runInNewContext(readFileSync(new URL('../../../public/audio/capture-worklet.js', import.meta.url), 'utf8'), sandbox)
  const capture = new Processor!()
  function render(samples: Float32Array | null, length = 128) {
    capture.process([samples ? [samples] : []])
    sandbox.currentFrame += samples?.length ?? length
  }
  return { messages, sandbox, render, batches: () => messages.filter((message): message is Samples => message.type === 'samples') }
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
