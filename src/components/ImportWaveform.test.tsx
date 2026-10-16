// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { ImportWaveform } from './ImportWaveform'
import { sensitivitySettings } from '../audio/detector-sensitivity'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
const rate = 48000
function audio() {
  const samples = new Float32Array(rate)
  for (const [time, strength] of [[.1, .6], [.6, .008]]) for (let i = 0; i < 128; i++) samples[Math.round(time * rate) + i] = i % 2 ? -strength : strength
  return { samples, sampleRate: rate, channels: 1 }
}
it('recomputes full-source markers on tuning, preserves audio and exposes source timestamps', async () => {
  const source = audio(), copy = source.samples.slice(), place = vi.fn()
  const { rerender, container } = render(<ImportWaveform audio={source} beatOne={0} place={place} settings={sensitivitySettings(0)} />)
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('1 detected attacks'))
  rerender(<ImportWaveform audio={source} beatOne={0} place={place} settings={sensitivitySettings(100)} />)
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('2 detected attacks'))
  fireEvent.click(screen.getByRole('button', { name: 'Attack at 0.600000 s' }))
  expect(screen.getByText('Selected attack: 0.600000 source seconds.')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'Zoom time in' }))
  expect(container.querySelectorAll('.import-detection-marker')).toHaveLength(1)
  expect(screen.getByRole('status').textContent).toContain('2 detected attacks')
  expect(place).not.toHaveBeenCalled()
  expect(source.samples).toEqual(copy)
})
function gestureSetup() {
  class TestPointerEvent extends MouseEvent {
    pointerId: number
    pointerType: string
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? 'touch' }
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent)
  const place = vi.fn()
  const rendered = render(<ImportWaveform audio={audio()} beatOne={0} place={place} settings={sensitivitySettings(50)} />)
  const plot = screen.getByRole('slider', { name: 'Beat one position' })
  vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 512 } as DOMRect)
  const overview = screen.getByRole('slider', { name: 'Visible audio passage' })
  vi.spyOn(overview, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 512 } as DOMRect)
  const pointer = (type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel' | 'lostPointerCapture', id: number, x: number, y: number, pointerType = 'touch', surface = 'main') => fireEvent[type](surface === 'main' ? plot : overview, { button: 0, pointerId: id, pointerType, clientX: x, clientY: y })
  const start = () => Number(screen.getByRole('slider', { name: 'Visible audio passage' }).getAttribute('aria-valuenow'))
  return { ...rendered, place, pointer, start }
}
it.each(['touch', 'mouse'])('zooms time with a single %s drag on either waveform and locks the axis', type => {
  const { pointer, place, start } = gestureSetup()
  pointer('pointerDown', 1, 256, 100, type); pointer('pointerMove', 1, 256, 30, type); pointer('pointerMove', 1, 400, 30, type); pointer('pointerUp', 1, 400, 30, type)
  expect(start()).toBeCloseTo((1 - Math.exp(-.7)) / 2)
  expect(screen.getByText(/waveform height 1.00×/)).toBeDefined()
  pointer('pointerDown', 1, 256, 30, type, 'overview'); pointer('pointerMove', 1, 256, 100, type, 'overview'); pointer('pointerUp', 1, 256, 100, type, 'overview')
  expect(start()).toBeCloseTo(0)
  expect(screen.getByRole('slider', { name: 'Visible audio passage' }).getAttribute('aria-valuemax')).toBe('0')
  expect(place).not.toHaveBeenCalled()
})
it.each(['touch', 'mouse'])('uses horizontal %s drags for main amplitude and overview navigation', type => {
  const { pointer, place, start } = gestureSetup()
  fireEvent.click(screen.getByRole('button', { name: 'Zoom time in' }))
  pointer('pointerDown', 1, 256, 100, type); pointer('pointerMove', 1, 326, 100, type); pointer('pointerMove', 1, 326, 0, type); pointer('pointerUp', 1, 326, 0, type)
  expect(start()).toBe(.25)
  expect(screen.getByText(/waveform height 2.01×/)).toBeDefined()
  pointer('pointerDown', 1, 256, 100, type, 'overview'); pointer('pointerMove', 1, 384, 100, type, 'overview'); pointer('pointerUp', 1, 384, 100, type, 'overview')
  expect(start()).toBe(.5)
  pointer('pointerDown', 1, 256, 100, type, 'overview'); pointer('pointerMove', 1, 0, 100, type, 'overview'); pointer('pointerUp', 1, 0, 100, type, 'overview')
  expect(start()).toBe(0)
  expect(place).not.toHaveBeenCalled()
  pointer('pointerDown', 1, 256, 100, type); pointer('pointerUp', 1, 256, 100, type)
  expect(place).toHaveBeenCalledWith(.25)
})
it('suppresses taps and further motion after cancellation, capture loss or an extra pointer', () => {
  const { pointer, place, start } = gestureSetup()
  pointer('pointerDown', 1, 256, 100); pointer('pointerMove', 1, 256, 30)
  const zoomedStart = start()
  pointer('pointerDown', 2, 384, 100); pointer('pointerMove', 1, 256, 0)
  pointer('pointerCancel', 2, 384, 100); pointer('pointerMove', 1, 400, 30); pointer('pointerUp', 1, 400, 30)
  expect(start()).toBe(zoomedStart)
  pointer('pointerDown', 1, 256, 100); pointer('lostPointerCapture', 1, 256, 100); pointer('pointerUp', 1, 256, 100)
  expect(place).not.toHaveBeenCalled()
})
it('cancels stale detection work when settings or the source change', async () => {
  vi.useFakeTimers()
  const source = audio(), place = vi.fn()
  const { rerender } = render(<ImportWaveform audio={source} beatOne={0} place={place} settings={sensitivitySettings(100)} />)
  rerender(<ImportWaveform audio={source} beatOne={0} place={place} settings={sensitivitySettings(0)} />)
  await act(() => vi.runAllTimersAsync())
  expect(screen.getByRole('status').textContent).toContain('1 detected attacks')
  const silent = { ...source, samples: new Float32Array(rate) }
  rerender(<ImportWaveform audio={silent} beatOne={0} place={place} settings={sensitivitySettings(100)} />)
  await act(() => vi.runAllTimersAsync())
  expect(screen.getByRole('status').textContent).toContain('0 detected attacks')
})

it('brightens a hovered marker and keeps its aligned play button available across the button column', async () => {
  const { container, place } = gestureSetup()
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('2 detected attacks'))
  const plot = screen.getByRole('slider', { name: 'Beat one position' })
  fireEvent.pointerMove(plot, { pointerType: 'mouse', clientX: 51.2, clientY: 10 })
  const button = screen.getByRole('button', { name: 'Play from 0.100000 seconds to 1.000000 seconds' })
  expect(button.style.left).toBe('10%')
  expect(container.querySelector('.import-detection-marker')?.getAttribute('stroke')).toBe('#fff1c9')
  fireEvent.pointerMove(plot, { pointerType: 'mouse', clientX: 74, clientY: 30 })
  expect(screen.getByRole('button', { name: 'Play from 0.100000 seconds to 1.000000 seconds' })).toBe(button)
  fireEvent.pointerEnter(button, { pointerType: 'mouse' })
  expect(screen.getByRole('button', { name: 'Play from 0.100000 seconds to 1.000000 seconds' })).toBe(button)
  fireEvent.pointerLeave(container.querySelector('.import-detail')!)
  expect(screen.queryByRole('button', { name: /Play from/ })).toBeNull()
  expect(place).not.toHaveBeenCalled()
})
it('auditions a selected marker to the visible endpoint and stops on view changes or unmount', async () => {
  const contexts: any[] = []
  vi.stubGlobal('AudioContext', class {
    state = 'running'; currentTime = 9; destination = {}; onstatechange = null
    output = { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), buffer: null, loop: false, onended: null }
    buffer: Float32Array | null = null
    constructor() { contexts.push(this) }
    resume = async () => {}
    close = vi.fn(async () => {})
    createBuffer(_channels: number, length: number, sampleRate: number) { expect(sampleRate).toBe(rate); this.buffer = new Float32Array(length); return { copyToChannel: (pcm: Float32Array) => this.buffer!.set(pcm) } }
    createBufferSource() { return this.output }
  })
  const { place, unmount } = gestureSetup()
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('2 detected attacks'))
  fireEvent.click(screen.getByRole('button', { name: 'Zoom time in' })) // visible .25–.75
  fireEvent.click(screen.getByRole('button', { name: 'Attack at 0.600000 s' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Play from 0.600000 seconds to 0.750000 seconds' })))
  expect(contexts[0].buffer).toEqual(audio().samples.slice(.6 * rate, .75 * rate))
  expect(contexts[0].output.start).toHaveBeenCalledWith(9)
  expect(place).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Zoom time out' }))
  expect(contexts[0].output.stop).toHaveBeenCalled()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Play from 0.600000 seconds to 1.000000 seconds' })))
  unmount()
  expect(contexts[1].output.stop).toHaveBeenCalled()
})
it('shows an audio output error instead of starting capture or hiding playback failure', async () => {
  const { place } = gestureSetup()
  vi.stubGlobal('AudioContext', class { constructor() { throw new Error('Audio unavailable') } })
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('2 detected attacks'))
  fireEvent.click(screen.getByRole('button', { name: 'Attack at 0.100000 s' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Play from 0.100000 seconds to 1.000000 seconds' })))
  expect(screen.getByRole('alert').textContent).toBe('Audio unavailable')
  expect(place).not.toHaveBeenCalled()
})
