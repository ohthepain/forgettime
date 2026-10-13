// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePresentedHits } from './use-presented-hits'
import type { ResolvedHit } from './engine'

const line = (id: number): ResolvedHit => ({
  id, time: id, errorMs: id * 4, confidence: 0.9,
  subdivision: 'quarter', uncertain: false, displayedAt: id + 0.24,
})

describe('meter presentation lifetime', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('retains a line through capture-clock expiry until its actual CSS animation finishes', () => {
    const { result, rerender } = renderHook(({ incoming }) => usePresentedHits(incoming, true), { initialProps: { incoming: [line(1)] } })
    expect(result.current.hits).toHaveLength(1)
    rerender({ incoming: [] })
    act(() => vi.advanceTimersByTime(999))
    expect(result.current.hits).toHaveLength(1)
    act(() => result.current.removeHit(1))
    expect(result.current.hits).toEqual([])
  })

  it('does not remount expired IDs or change existing positions when later snapshots arrive', () => {
    const { result, rerender } = renderHook(({ incoming }) => usePresentedHits(incoming, true), { initialProps: { incoming: [line(1)] } })
    const first = result.current.hits[0]
    rerender({ incoming: [{ ...line(1), errorMs: 50 }, line(2)] })
    expect(result.current.hits[0]).toBe(first)
    expect(result.current.hits.map(hit => hit.errorMs)).toEqual([4, 8])
    act(() => result.current.removeHit(1))
    rerender({ incoming: [line(1), line(2)] })
    expect(result.current.hits.map(hit => hit.id)).toEqual([2])
  })

  it('clears on reference reset, permits a fresh engine, and never draws uncertain scores', () => {
    const { result, rerender } = renderHook(({ incoming, active }) => usePresentedHits(incoming, active), { initialProps: { incoming: [line(1)], active: true } })
    rerender({ incoming: [], active: false })
    expect(result.current.hits).toEqual([])
    rerender({ incoming: [line(1), { ...line(2), errorMs: null, uncertain: true }], active: true })
    expect(result.current.hits.map(hit => hit.id)).toEqual([1])
    act(() => vi.advanceTimersByTime(2000))
    expect(result.current.hits).toEqual([])
  })
})
