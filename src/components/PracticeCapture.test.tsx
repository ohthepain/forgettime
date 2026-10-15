// @vitest-environment jsdom
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { PracticeScreen } from './PracticeScreen'
import { usePreferences } from '../lib/preferences'
import type { CaptureCallbacks, CaptureInfo } from '../audio/capture'

const capture = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../audio/capture', () => ({ createAudioCapture: capture.create }))
const info: CaptureInfo = { source: 'web', sampleRate: 48000, timestampQuality: 'sample-clock' }
let callbacks: CaptureCallbacks
let released: boolean
beforeEach(() => {
  localStorage.clear()
  usePreferences.setState({ bpm: 120, mode: 'auto' })
  released = false
  capture.create.mockReset().mockImplementation((next: CaptureCallbacks) => {
    callbacks = next
    return { start: async () => info, stop: async () => { released = true }, setMetronome: () => {} }
  })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('offers explicit single or Auto capture without confusing rhythmic Auto, and lets Stop disable Auto', async () => {
  const view = render(<PracticeScreen />)
  expect(capture.create).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Auto' })).toBeDefined() // rhythmic interpretation
  fireEvent.click(screen.getByRole('button', { name: 'Recording options' }))
  const auto = screen.getByRole('button', { name: 'Auto capture' })
  expect(auto.getAttribute('aria-pressed')).toBe('false')
  await act(async () => fireEvent.click(auto))
  expect(auto.getAttribute('aria-pressed')).toBe('true')
  act(() => callbacks.onFrame({ ...info, time: 10, level: 0.8, onsets: [{ time: 10, strength: 0.8, confidence: 0.95 }] }))
  act(() => callbacks.onFrame({ ...info, time: 12, level: 0, onsets: [] }))
  expect(released).toBe(false)
  expect(screen.getByText('Paused · listening for you')).toBeDefined()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop listening' })))
  expect(released).toBe(true)
  expect(auto.getAttribute('aria-pressed')).toBe('false')
  view.unmount()
  capture.create.mockClear()
  render(<PracticeScreen />)
  expect(capture.create).not.toHaveBeenCalled()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enable microphone' })))
  act(() => callbacks.onFrame({ ...info, time: 20, level: 0.8, onsets: [{ time: 20, strength: 0.8, confidence: 0.95 }] }))
  await act(async () => callbacks.onFrame({ ...info, time: 22, level: 0, onsets: [] }))
  expect(screen.getByRole('button', { name: 'Enable microphone' })).toBeDefined()
})

it('overlays accessible bar navigation and stops Auto when reviewing retained audio', async () => {
  render(<PracticeScreen />)
  fireEvent.click(screen.getByRole('button', { name: 'Recording options' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Auto capture' })))
  act(() => callbacks.onFrame({ ...info, time: 6, level: 0.8,
    onsets: [0.1, 0.6, 1.1, 1.6, 2.1, 2.6, 3.1, 3.6].map(time => ({ time, strength: 0.8, confidence: 0.95 })),
    pcm: { startFrame: 0, samples: new Float32Array(6 * 48000) },
  }))
  expect(screen.getByRole('button', { name: 'Review bar 1 of 3' })).toBeDefined()
  expect((screen.getByRole('button', { name: 'Previous bar' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Next bar' })))
  expect(screen.getByRole('button', { name: 'Review bar 2 of 3' })).toBeDefined()
  expect((screen.getByRole('button', { name: 'Next bar' }) as HTMLButtonElement).disabled).toBe(false)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Next bar' })))
  expect(screen.getByRole('button', { name: 'Review bar 3 of 3' })).toBeDefined()
  expect((screen.getByRole('button', { name: 'Next bar' }) as HTMLButtonElement).disabled).toBe(true)
  expect(released).toBe(true)
  expect(screen.getByRole('button', { name: 'Auto capture' }).getAttribute('aria-pressed')).toBe('false')
  expect(screen.getByText('RECORDED AUDIO')).toBeDefined()
})

it('reveals real PCM candidates without moving existing hits or reopening capture', async () => {
  const { OnsetDetector } = await import('../audio/onset-detector')
  const detector = new OnsetDetector()
  const view = render(<PracticeScreen />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enable microphone' })))
  const rate = 48000
  const samples = new Float32Array(rate)
  for (const [time, amplitude] of [[0.1, 0.8], [0.6, 0.003]]) for (let i = 0; i < 128; i++) samples[Math.round(time * rate) + i] = i % 2 ? -amplitude : amplitude
  const onsets = detector.process(samples, 0, rate)
  act(() => callbacks.onFrame({ ...info, time: detector.processedThrough!, level: 0, onsets, pcm: { startFrame: 0, samples }, diagnostics: detector.drainDiagnostics() }))
  const positions = [...view.container.querySelectorAll('.waveform-hit')].map(hit => hit.getAttribute('data-position'))
  fireEvent.click(screen.getByRole('button', { name: 'Detection details' }))
  expect(screen.getAllByRole('button', { name: /Inspect candidate/ }).length).toBeGreaterThan(0)
  expect([...view.container.querySelectorAll('.waveform-hit')].map(hit => hit.getAttribute('data-position'))).toEqual(positions)
  expect(capture.create).toHaveBeenCalledOnce()
  expect(released).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Detection details' }))
  expect(view.container.querySelector('.waveform-candidate')).toBeNull()
})


it('hydrates the server screen before loading the browser saved library without rebuilding the page', async () => {
  vi.stubGlobal('indexedDB', undefined)
  const container = document.createElement('div')
  container.innerHTML = renderToString(<PracticeScreen />)
  document.body.append(container)
  // IndexedDB is a browser-only system edge; it already contains one saved bar.
  vi.stubGlobal('indexedDB', { open: () => {
    const request: { result: unknown; onsuccess?: () => void } = { result: {
      close() {}, transaction() {
        const result = [{ id: 'kept', name: 'Saved practice', createdAt: 0, bpm: 110, complete: true, bytes: 128 }]
        const transaction = { objectStore: () => ({ getAll: () => ({ result }) }), oncomplete: undefined as (() => void) | undefined }
        queueMicrotask(() => transaction.oncomplete?.())
        return transaction
      },
    } }
    queueMicrotask(() => request.onsuccess?.())
    return request
  } })
  const onRecoverableError = vi.fn()
  let root!: ReturnType<typeof hydrateRoot>
  try {
    await act(async () => { root = hydrateRoot(container, <PracticeScreen />, { onRecoverableError }) })
    expect(onRecoverableError).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Saved bars (1)')
    expect(container.textContent).toContain('Saved practice')
    expect(container.textContent).not.toContain('Local saved bars are unavailable')
    expect(capture.create).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()); container.remove() }
})


it('enters review before inspecting completed Auto candidates while leaving active live inspection running', async () => {
  render(<PracticeScreen />)
  fireEvent.click(screen.getByRole('button', { name: 'Recording options' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Auto capture' })))
  act(() => callbacks.onFrame({ ...info, time: 1, level: .8, onsets: [{ time: .1, strength: .8, confidence: .95 }], pcm: { startFrame: 0, samples: new Float32Array(48000) } }))
  fireEvent.click(screen.getByRole('button', { name: 'Detection details' }))
  expect(released).toBe(false)
  act(() => callbacks.onFrame({ ...info, time: 3, level: 0, onsets: [], pcm: { startFrame: 48000, samples: new Float32Array(96000) } }))
  expect(screen.getByRole('button', { name: 'Auto capture' }).getAttribute('aria-pressed')).toBe('true')
  // The details panel is already open when live playing becomes review.
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reset detector defaults' })))
  expect(released).toBe(true)
  expect(screen.getByRole('button', { name: 'Auto capture' }).getAttribute('aria-pressed')).toBe('false')
})
