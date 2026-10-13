import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { expect, it } from 'vitest'

it('transfers silent captured frames with their sample positions for the pause clock', () => {
  const messages: { samples: Float32Array; startFrame: number; sampleRate: number }[] = []
  let Processor: new () => { process: (input: Float32Array[][]) => boolean }
  const sandbox = {
    AudioWorkletProcessor: class { port = { postMessage: (message: typeof messages[number]) => messages.push(message) } },
    Float32Array, sampleRate: 48000, currentFrame: 144000,
    registerProcessor: (_name: string, implementation: typeof Processor) => { Processor = implementation },
  }
  vm.runInNewContext(readFileSync(new URL('../../../public/audio/capture-worklet.js', import.meta.url), 'utf8'), sandbox)
  const capture = new Processor!()
  for (let i = 0; i < 16; i++) {
    capture.process([[new Float32Array(128)]])
    sandbox.currentFrame += 128
  }
  expect(messages).toHaveLength(2)
  expect(messages.map(({ startFrame }) => startFrame)).toEqual([144000, 145024])
  expect(messages[1].samples).toHaveLength(1024)
  expect(messages[1].samples.every((sample) => sample === 0)).toBe(true)
})
