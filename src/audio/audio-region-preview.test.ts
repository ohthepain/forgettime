import { afterEach, expect, it, vi } from 'vite-plus/test'
import { AudioRegionPreview } from './audio-region-preview'

afterEach(() => vi.unstubAllGlobals())
function outputEdge(resume?: () => Promise<void>) {
  const contexts: any[] = []
  vi.stubGlobal('AudioContext', class {
    state = 'running'; currentTime = 17.25; destination = {}
    onstatechange: null | (() => void) = null
    source = { buffer: null as any, loop: true, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as null | (() => void) }
    buffer: { samples: Float32Array; sampleRate: number; copyToChannel: (samples: Float32Array) => void } | null = null
    constructor() { contexts.push(this) }
    resume = vi.fn(resume ?? (() => Promise.resolve()))
    close = vi.fn(async () => { this.state = 'closed' })
    createBuffer(channels: number, length: number, sampleRate: number) {
      expect(channels).toBe(1)
      const samples = new Float32Array(length)
      return this.buffer = { samples, sampleRate, copyToChannel: input => samples.set(input) }
    }
    createBufferSource() { return this.source }
  })
  return contexts
}
const audio = { samples: Float32Array.from({ length: 100 }, (_, i) => (i - 50) / 10), sampleRate: 100, channels: 1 }
it('plays only the selected source frames once, at the original rate and level, then releases output', async () => {
  const contexts = outputEdge(), preview = new AudioRegionPreview(), ended = vi.fn(), copy = audio.samples.slice()
  await preview.play(audio, .205, .795, ended)
  const context = contexts[0]
  expect(context.buffer.samples).toEqual(audio.samples.slice(21, 80))
  expect(context.buffer.sampleRate).toBe(100)
  expect(context.source.loop).toBe(false)
  expect(context.source.start).toHaveBeenCalledWith(17.25)
  expect(audio.samples).toEqual(copy)
  context.source.onended()
  expect(context.close).toHaveBeenCalledOnce()
  expect(ended).toHaveBeenCalledOnce()
})
it('stops replaced output and ignores a stale ended event', async () => {
  const contexts = outputEdge(), preview = new AudioRegionPreview(), firstEnd = vi.fn(), secondEnd = vi.fn()
  await preview.play(audio, 0, .5, firstEnd)
  const staleEnd = contexts[0].source.onended
  await preview.play(audio, .5, 1, secondEnd)
  expect(contexts[0].source.stop).toHaveBeenCalledOnce()
  expect(contexts[0].close).toHaveBeenCalledOnce()
  staleEnd()
  expect(firstEnd).not.toHaveBeenCalled()
  expect(contexts[1].source.stop).not.toHaveBeenCalled()
  preview.stop()
  expect(contexts[1].close).toHaveBeenCalledOnce()
})
it('cancels output while audio activation is pending', async () => {
  let activate!: () => void
  const contexts = outputEdge(() => new Promise<void>(resolve => { activate = resolve })), preview = new AudioRegionPreview()
  const playing = preview.play(audio, 0, 1, vi.fn())
  preview.stop(); activate()
  expect(await playing).toBe(false)
  expect(contexts[0].buffer).toBeNull()
  expect(contexts[0].close).toHaveBeenCalledOnce()
})
it('reports output failures and rejects empty or invalid ranges without substituting audio', async () => {
  const contexts = outputEdge(), preview = new AudioRegionPreview()
  await expect(preview.play(audio, .5, .5, vi.fn())).rejects.toThrow()
  expect(contexts).toHaveLength(0)
  const pending = preview.play(audio, 0, 1, vi.fn())
  contexts[0].source.start.mockImplementation(() => { throw new Error('Output unavailable') })
  await expect(pending).rejects.toThrow('Output unavailable')
  expect(contexts[0].close).toHaveBeenCalledOnce()
})
