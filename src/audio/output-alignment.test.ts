import { describe, expect, it } from 'vitest'
import { BrowserOutputAlignment, browserLatencyEstimate } from './output-alignment'
import type { MetronomePlan } from './metronome'

describe('browser microphone/output clock alignment', () => {
  it('sums input, render and hardware delays in seconds without inventing missing values', () => {
    expect(browserLatencyEstimate({ baseLatency: 0.01, outputLatency: 0.14 }, { latency: 0.1 } as MediaTrackSettings)).toEqual({
      inputSeconds: 0.1, outputSeconds: expect.closeTo(0.15), correctionSeconds: 0.25,
    })
    expect(browserLatencyEstimate({ baseLatency: NaN, outputLatency: -1 }, {})).toEqual({ inputSeconds: null, outputSeconds: null, correctionSeconds: 0 })
    expect(browserLatencyEstimate({ baseLatency: 0.01, outputLatency: undefined! }, {})).toEqual({ inputSeconds: null, outputSeconds: 0.01, correctionSeconds: 0.01 })
  })

  it.each([90, 120])('advances the click by the same milliseconds at %i BPM without moving the original reference', bpm => {
    const alignment = new BrowserOutputAlignment()
    const plan: MetronomePlan = { origin: 10, bpm, fromBeat: 1, untilTime: 10.4, stopTime: 10 + 240 / bpm }
    const output = alignment.align(plan, 10.02, 0.25)!
    expect(output.origin).toBe(9.75)
    expect(output.origin + 60 / bpm + 0.25).toBeCloseTo(plan.origin + 60 / bpm)
    expect(plan.origin).toBe(10)
    expect(output.fromBeat).toBe(1)
  })

  it('keeps the watchdog live on long-delay routes, but excludes the next downbeat in First bar', () => {
    const alignment = new BrowserOutputAlignment()
    const plan: MetronomePlan = { origin: 10, bpm: 120, fromBeat: 1, untilTime: 10.37, stopTime: 12 }
    expect(alignment.align(plan, 10.02, 0.45)?.untilTime).toBe(10.37)
    expect(alignment.align({ ...plan, untilTime: 11.9 }, 11.6, 0.45)?.untilTime).toBe(11.55)
  })

  it('skips beats whose scheduling deadline has already passed, without truncating a click on each refresh', () => {
    const alignment = new BrowserOutputAlignment()
    const plan: MetronomePlan = { origin: 10, bpm: 120, fromBeat: 1, untilTime: 10.4, stopTime: 12 }
    expect(alignment.align(plan, 10.05, 0.6)?.fromBeat).toBe(2)
    expect(alignment.align({ ...plan, untilTime: 10.8 }, 10.41, 0.6)?.fromBeat).toBe(2)
  })

  it('freezes correction across the whole performance including quiet coaching periods; reset starts fresh', () => {
    const alignment = new BrowserOutputAlignment()
    const plan: MetronomePlan = { origin: 10, bpm: 120, fromBeat: 1, untilTime: 10.4 }
    expect(alignment.align(plan, 10, 0.25)?.origin).toBe(9.75)
    expect(alignment.align(plan, 10.2, 0.4)?.origin).toBe(9.75)
    expect(alignment.align(null, 12, 0.4)).toBeNull()
    expect(alignment.align({ ...plan, fromBeat: 8, untilTime: 14.5 }, 13.9, 0.4)?.origin).toBe(9.75)
    expect(alignment.align({ ...plan, origin: 20 }, 20, 0.1)?.origin).toBe(19.9)
    alignment.reset()
    expect(alignment.align(plan, 10, 0.3)?.origin).toBe(9.7)
  })
})
