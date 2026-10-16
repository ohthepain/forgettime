import { describe, expect, it } from 'vite-plus/test'
import { BarWaveformBuffer, hitStrengthColor, HIT_STRENGTH_COLORS } from './bar-waveform'
import { TimingEngine, type TimingSnapshot } from './engine'

function state(origin = 10, bpm = 120): TimingSnapshot {
  const engine = new TimingEngine({ bpm, startSensitivity: 50 })
  engine.start(origin)
  engine.addOnset({ time: origin, strength: 0.8, confidence: 0.9 })
  return engine.snapshot(origin)
}
const point = (time: number, max: number, duration = 0.002) => ({ time, duration, min: -max / 2, max })
const hit = (time: number, strength = 0.8) => ({ time, strength, confidence: 0.9 })

describe('one-bar circular waveform', () => {
  it('preserves signed waveform ranges instead of forcing every audio window through zero', () => {
    const view = new BarWaveformBuffer().addFrame(10.1, [
      { time: 10, duration: 0.002, min: 0.2, max: 0.5 },
      { time: 10.05, duration: 0.002, min: -0.8, max: -0.3 },
    ], [], state())
    expect(view.min[0]).toBe(0.2)
    expect(view.max[0]).toBe(0.5)
    expect(view.min[13]).toBe(-0.8)
    expect(view.max[13]).toBe(-0.3)
  })

  it.each([60, 120, 240])('aligns peaks and detected hits with the locked %i BPM beat clock', bpm => {
    const buffer = new BarWaveformBuffer()
    const beat = 60 / bpm
    const view = buffer.addFrame(10 + beat * 2, [point(10, 0.8), point(10 + beat, 0.2)], [hit(10), hit(10 + beat, 0.2)], state(10, bpm))
    expect(view.progress).toBeCloseTo(0.5)
    expect(view.hits.map(h => h.position)).toEqual([0, 0.25])
    expect(view.max[0]).toBe(0.8)
    expect(view.max[128]).toBe(0.2)
  })

  it('overwrites progressively from beat 1, including silence, and retains the unwritten remainder', () => {
    const buffer = new BarWaveformBuffer()
    buffer.addFrame(11.9, [point(10, 0.8), point(10.5, 0.2), point(11, 0.5)], [hit(10), hit(10.5), hit(11)], state())
    const boundary = buffer.addFrame(12, [], [], state())
    expect(boundary.progress).toBe(0)
    expect(boundary.hits.map(h => h.time)).toEqual([10.5, 11])
    const view = buffer.addFrame(12.1, [point(12, 0, 0.1)], [], state())
    expect(view.progress).toBeCloseTo(0.05)
    expect(view.max[0]).toBe(0)
    expect(view.max[128]).toBe(0.2)
    expect(view.max[256]).toBe(0.5)
    expect(view.hits.map(h => h.position)).toEqual([0.25, 0.5])
    const later = buffer.addFrame(12.6, [point(12.5, 0, 0.1)], [], state())
    expect(later.max[128]).toBe(0)
    expect(later.hits.map(h => h.time)).toEqual([11])
  })

  it('splits captured windows crossing beat 1 between the edges without drawing across the bar', () => {
    const view = new BarWaveformBuffer().addFrame(12.01, [point(11.99, 0.8, 0.02)], [hit(12)], state())
    expect(view.max[511]).toBe(0.8)
    expect(view.max[0]).toBe(0.8)
    expect(view.max[256]).toBe(0)
    expect(view.hits[0].position).toBe(0)
  })

  it('keeps a pre-roll for an anchor detected in the next packet, then clears on a fresh reference', () => {
    const buffer = new BarWaveformBuffer()
    buffer.addFrame(10.019, [point(10.018, 0.8)], [], { ...state(), status: 'listening', phaseOrigin: null })
    const view = buffer.addFrame(10.04, [], [hit(10.018)], state(10.018))
    expect(view.max[0]).toBe(0.8)
    expect(view.hits[0].position).toBe(0)
    const restart = buffer.addFrame(20.1, [point(20, 0.3)], [hit(20, 0.3)], state(20))
    expect(restart.hits).toHaveLength(1)
    expect(restart.max[0]).toBe(0.3)
    expect(buffer.reset()).toMatchObject({ min: [], max: [], hits: [], progress: null })
  })

  it('holds a short take through the silence timeout and handles a missing native waveform honestly', () => {
    const buffer = new BarWaveformBuffer()
    const playing = state()
    expect(buffer.addFrame(10.2, undefined, [hit(10)], playing).available).toBe(false)
    buffer.addFrame(11.9, [point(11.8, 0.2)], [], playing)
    const paused = { ...playing, status: 'paused' as const, phaseOrigin: null, beat: null }
    const final = buffer.addFrame(12.1, [point(12, 0, 0.1)], [], paused)
    expect(final.progress).toBe(1)
    expect(final.review).toBe('partial')
    expect(buffer.addFrame(15, [point(14.9, 0.7)], [], paused)).toBe(final)
    expect(final.hits.map(h => h.time)).toEqual([10])
  })

  it.each([60, 120, 240])('recovers a full played bar after the %i BPM silence timeout without mixing sweeps', bpm => {
    const buffer = new BarWaveformBuffer()
    const engine = new TimingEngine({ bpm, startSensitivity: 50 })
    const beat = 60 / bpm
    const bar = beat * 4
    engine.start(10)
    const attacks = Array.from({ length: 10 }, (_, i) => hit(10 + i * beat, 0.2 + i * 0.05))
    for (const attack of attacks) {
      engine.addOnset(attack)
      buffer.addFrame(attack.time + 0.01, [point(attack.time, attack.strength)], [attack], engine.snapshot(attack.time + 0.01))
    }
    const last = attacks.at(-1)!.time
    const waiting = buffer.addFrame(last + bar - 0.01, [point(last + 0.01, 0, bar - 0.02)], [], engine.snapshot(last + bar - 0.01))
    expect(waiting.review).toBeNull()
    expect(engine.snapshot(last + bar - 0.01).status).toBe('playing')
    const held = buffer.addFrame(last + bar, [point(last + bar - 0.01, 0, 0.01)], [], engine.snapshot(last + bar))
    expect(held.review).toBe('complete')
    expect(held.progress).toBe(1)
    expect(held.hits.map(h => h.time)).toEqual(attacks.slice(4, 8).map(h => h.time))
    expect(held.hits.map(h => h.position)).toEqual([0, 0.25, 0.5, 0.75])
    attacks.slice(4, 8).forEach((attack, i) => expect(held.max[i * 128]).toBe(attack.strength))
    expect(buffer.addFrame(last + bar * 3, [point(last + bar * 3 - 0.01, 0.7)], [], engine.snapshot(last + bar * 3))).toBe(held)
    const restart = hit(last + bar * 3 + 0.1)
    engine.addOnset(restart)
    const fresh = buffer.addFrame(restart.time + 0.01, [point(restart.time, 0.8)], [restart], engine.snapshot(restart.time + 0.01))
    expect(fresh.review).toBeNull()
    expect(fresh.hits.map(h => h.time)).toEqual([restart.time])
    expect(fresh.hits[0].position).toBe(0)
  })

  it('preserves a complete bar on explicit stop, with the boundary attack belonging to the next bar', () => {
    const buffer = new BarWaveformBuffer()
    const attacks = [hit(10), hit(10.5), hit(11), hit(11.5), hit(12)]
    buffer.addFrame(12.01, attacks.map(h => point(h.time, h.strength)), attacks, { ...state(), lastHitTime: 12 })
    const held = buffer.hold()
    expect(held.review).toBe('complete')
    expect(held.hits.map(h => h.time)).toEqual([10, 10.5, 11, 11.5])
    expect(buffer.hold()).toBe(held)
  })

  it('keeps an unavailable waveform unavailable when held', () => {
    const buffer = new BarWaveformBuffer()
    buffer.addFrame(12.1, undefined, [hit(10), hit(11), hit(12)], { ...state(), lastHitTime: 12 })
    expect(buffer.hold()).toMatchObject({ available: false, review: 'complete' })
  })

  it('does not let rejected restart candidates replace the played bar at timeout', () => {
    const buffer = new BarWaveformBuffer()
    const engine = new TimingEngine({ bpm: 120 })
    engine.start(10)
    for (let time = 10; time <= 14; time += 0.5) {
      const onset = hit(time)
      engine.addOnset(onset)
      buffer.addFrame(time + 0.01, [point(time, 0.8)], [onset], engine.snapshot(time + 0.01))
    }
    const quiet = { ...hit(16.01, 0.03), confidence: 0.4 }
    engine.addOnset(quiet)
    const paused = engine.snapshot(16.02)
    expect(paused.status).toBe('paused')
    const held = buffer.addFrame(16.02, [point(16.01, 0.03)], [quiet], paused)
    expect(held.hits.map(h => h.time)).toEqual([12, 12.5, 13, 13.5])
  })

  it('keeps all detected attacks regardless of later scoring ambiguity, with the requested colour ordering', () => {
    const strengths = [0.04, 0.14, 0.3, 0.5, 0.8]
    const hits = strengths.map((strength, i) => ({ ...hit(10 + i * 0.02, strength), confidence: 0.4 }))
    const view = new BarWaveformBuffer().addFrame(10.1, [], hits, state())
    expect(view.hits).toHaveLength(5)
    expect(view.hits.map(h => hitStrengthColor(h.strength))).toEqual(HIT_STRENGTH_COLORS.map(band => band.color))
  })
})
