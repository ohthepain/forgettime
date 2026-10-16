// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { RecordControl } from './RecordControl'
import { usePreferences } from '../lib/preferences'
afterEach(() => { cleanup(); vi.useRealTimers() })
it('holds for Auto without also starting a single take and cancels interrupted holds', () => {
  vi.useFakeTimers()
  const listen = vi.fn(async () => {})
  render(<RecordControl active={false} auto={false} busy={false} disabled={false} stopLabel="Stop listening" listen={listen} stop={vi.fn(async () => {})} />)
  const button = screen.getByRole('button', { name: 'Enable microphone' })
  fireEvent.pointerDown(button, { button: 0, pointerId: 1 })
  act(() => vi.advanceTimersByTime(600))
  fireEvent.pointerUp(button)
  fireEvent.click(button)
  expect(listen.mock.calls).toEqual([['auto']])
  listen.mockClear()
  fireEvent.pointerDown(button, { button: 0, pointerId: 2 })
  fireEvent.pointerCancel(button)
  act(() => vi.advanceTimersByTime(700))
  expect(listen).not.toHaveBeenCalled()
})
it('exposes persisted start sensitivity without activating capture', () => {
  const listen = vi.fn(async () => {})
  render(<RecordControl active={false} auto={false} busy={false} disabled={false} stopLabel="Stop listening" listen={listen} stop={vi.fn(async () => {})} />)
  fireEvent.click(screen.getByRole('button', { name: 'Recording options' }))
  fireEvent.change(screen.getByRole('slider', { name: 'Sensitivity' }), { target: { value: '15' } })
  expect(usePreferences.getState().startSensitivity).toBe(15)
  expect(listen).not.toHaveBeenCalled()
})
