// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { SettingsDialog } from './SettingsDialog'
import { calibrateAudio } from '../audio/calibration'
import { usePreferences } from '../lib/preferences'
vi.mock('../audio/calibration', () => ({ calibrateAudio: vi.fn() }))
beforeEach(() => {
  vi.clearAllMocks()
  usePreferences.setState({ audioCalibration: null })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('puts Calibrate first and never captures when instructions are closed', () => {
  const close = vi.fn()
  render(<SettingsDialog onClose={close} />)
  const buttons = screen.getAllByRole('button')
  expect(buttons[1].textContent).toBe('Calibrate')
  fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }))
  expect(screen.getByText(/Turn up your speaker volume/)).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
  expect(close).toHaveBeenCalledOnce()
  expect(calibrateAudio).not.toHaveBeenCalled()
})
it('closes instructions on Start, stops practice, saves a successful result and opens completion', async () => {
  let finish!: (value: { seconds: number; spreadMs: number; deviceId: string; sampleRate: number; measuredAt: number }) => void
  vi.mocked(calibrateAudio).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const stop = vi.fn().mockResolvedValue(undefined)
  render(<SettingsDialog onClose={vi.fn()} prepareCalibration={stop} deviceId="mic" />)
  fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start calibration' })))
  expect(stop).toHaveBeenCalledOnce()
  expect(document.querySelector('dialog')?.open).toBe(false)
  expect(calibrateAudio).toHaveBeenCalledWith(expect.any(AbortSignal), 'mic')
  await act(async () => finish({ seconds: .123, spreadMs: 1, deviceId: 'mic', sampleRate: 48000, measuredAt: 1 }))
  expect(screen.getByText('Calibration complete')).toBeDefined()
  expect(screen.getByText('123 ms')).toBeDefined()
  expect(usePreferences.getState().audioCalibration?.seconds).toBe(.123)
})
it('keeps the prior offset on failure', async () => {
  usePreferences.setState({ audioCalibration: { seconds: .1, spreadMs: 1, deviceId: 'mic', sampleRate: 48000, measuredAt: 1 } })
  vi.mocked(calibrateAudio).mockRejectedValue(new Error('Too quiet'))
  render(<SettingsDialog onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start calibration' })))
  expect(screen.getByRole('alert').textContent).toBe('Too quiet')
  expect(usePreferences.getState().audioCalibration?.seconds).toBe(.1)
})

it('aborts on cancellation and ignores a late successful result', async () => {
  let finish!: (value: { seconds: number; spreadMs: number; deviceId: string; sampleRate: number; measuredAt: number }) => void
  vi.mocked(calibrateAudio).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const close = vi.fn()
  render(<SettingsDialog onClose={close} />)
  fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start calibration' })))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel calibration' }))
  expect(vi.mocked(calibrateAudio).mock.calls[0][0].aborted).toBe(true)
  expect(close).toHaveBeenCalledOnce()
  await act(async () => finish({ seconds: .123, spreadMs: 1, deviceId: 'mic', sampleRate: 48000, measuredAt: 1 }))
  expect(usePreferences.getState().audioCalibration).toBeNull()
})
