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
it('exposes persisted microphone gain without activating capture', () => {
  const listen = vi.fn(async () => {})
  render(<RecordControl active={false} auto={false} busy={false} disabled={false} stopLabel="Stop listening" listen={listen} stop={vi.fn(async () => {})} />)
  fireEvent.click(screen.getByRole('button', { name: 'Recording options' }))
  fireEvent.change(screen.getByRole('slider', { name: 'Input gain' }), { target: { value: '2' } })
  expect(usePreferences.getState().inputGain).toBe(2)
  expect(listen).not.toHaveBeenCalled()
})

it('places microphone selection inside recording options without starting capture', () => {
  const select = vi.fn(), listen = vi.fn(async () => {})
  const props = { active: false, auto: false, busy: false, disabled: false, stopLabel: 'Stop listening', listen, stop: vi.fn(async () => {}), microphone: { devices: [{ deviceId: 'usb', label: 'USB microphone' }], deviceId: '', select } }
  const { rerender, container } = render(<RecordControl {...props} />)
  expect(screen.queryByRole('combobox')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Recording options' }))
  const control = screen.getByRole('combobox', { name: 'MICROPHONE' }) as HTMLSelectElement
  expect(container.querySelector('#recording-options')?.contains(control)).toBe(true)
  fireEvent.change(control, { target: { value: 'usb' } })
  expect(select).toHaveBeenCalledWith('usb')
  expect(listen).not.toHaveBeenCalled()
  rerender(<RecordControl {...props} active microphone={{ ...props.microphone, deviceId: 'missing' }} />)
  expect(control.disabled).toBe(true)
  expect(screen.getByRole('option', { name: 'Selected microphone (unavailable)' })).toBeDefined()
  rerender(<RecordControl {...props} busy />)
  expect(control.disabled).toBe(true)
  rerender(<RecordControl {...props} microphone={undefined} />)
  expect(screen.queryByRole('combobox')).toBeNull()
})
