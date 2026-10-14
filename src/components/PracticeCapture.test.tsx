// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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
