import { describe, expect, it } from 'vitest'
import { TimingEngine, type ResolvedHit, type TimingSnapshot } from './engine'
import { DEFAULT_METRONOME, MetronomeCoach } from './metronome'

function snapshot(hits: ResolvedHit[] = []): TimingSnapshot {
  return { status: 'playing', bpm: 120, mode: 'auto', beat: 1, phaseOrigin: 0, hits, pendingCount: 0, lockConfidence: 1, lastHitTime: 20 }
}
function hit(index: number, errorMs: number, id = index): ResolvedHit {
  return { id, time: index * 0.5 + errorMs / 1000, errorMs: null, confidence: 0.45, subdivision: 'quarter', uncertain: true,
    displayedAt: index * 0.5 + 0.24, guidance: { intendedTime: index * 0.5, errorMs } }
}
const help = { ...DEFAULT_METRONOME, mode: 'need-help' as const }

describe('metronome coaching', () => {
  it('joins beat 2, ends at the first bar boundary, and replays on a fresh start', () => {
    const coach = new MetronomeCoach()
    expect(coach.update(snapshot(), 0.02, DEFAULT_METRONOME).plan).toEqual({ origin: 0, bpm: 120, fromBeat: 1, untilTime: 0.37, stopTime: 2 })
    expect(coach.update(snapshot(), 1.9, DEFAULT_METRONOME).plan?.untilTime).toBe(2)
    expect(coach.update(snapshot(), 2, DEFAULT_METRONOME).plan).toBeNull()
    coach.update({ ...snapshot(), status: 'paused', phaseOrigin: null }, 3, DEFAULT_METRONOME)
    expect(coach.update({ ...snapshot(), phaseOrigin: 4 }, 4.01, DEFAULT_METRONOME).plan?.fromBeat).toBe(1)
  })

  it('continues always mode through a short pause but never schedules beyond a full bar of silence', () => {
    const coach = new MetronomeCoach()
    const options = { ...DEFAULT_METRONOME, mode: 'always' as const }
    const value = { ...snapshot(), lastHitTime: 1.1 }
    coach.update(value, 0.1, options)
    expect(coach.update(value, 2.9, options).plan?.untilTime).toBe(3.1)
    expect(coach.update({ ...value, status: 'paused', phaseOrigin: null }, 3.1, options).plan).toBeNull()
    expect(coach.update(snapshot(), 4, { ...options, enabled: false }).plan).toBeNull()
  })

  it('requires four completed beats beyond the strict threshold, then four within it to go quiet', () => {
    const coach = new MetronomeCoach()
    coach.update(snapshot(), 0, help)
    for (let i = 1; i <= 3; i++) {
      coach.update(snapshot([hit(i, 120)]), i * 0.5 + 0.37, help)
      expect(coach.update(snapshot(), (i + 1) * 0.5 + 0.49, help).helping).toBe(false)
    }
    coach.update(snapshot([hit(4, -120)]), 2.3, help)
    expect(coach.update(snapshot(), 2.989, help).helping).toBe(false)
    expect(coach.update(snapshot(), 2.99, help).helping).toBe(true)
    for (let i = 5; i <= 8; i++) {
      coach.update(snapshot([hit(i, 100)]), i * 0.5 + 0.37, help)
      const state = coach.update(snapshot(), (i + 1) * 0.5 + 0.49, help)
      expect(state.helping).toBe(i < 8)
      if (i === 8) expect(state.plan).toBeNull()
    }
  })

  it('does not turn a fill into four beats, count repeated snapshots, or treat rests/uncertainty as bad playing', () => {
    const coach = new MetronomeCoach()
    coach.update(snapshot(), 0, help)
    const fill = [1, 2, 3, 4].map(id => hit(1, 120, id))
    coach.update(snapshot(fill), 0.9, help)
    coach.update(snapshot(fill), 0.95, help)
    expect(coach.update(snapshot(), 1.49, help).badBeats).toBe(1)
    expect(coach.update(snapshot(), 1.99, help).badBeats).toBe(0) // Rest on beat 2.
    const ambiguous = { ...hit(3, 150, 5), guidance: undefined }
    coach.update(snapshot([ambiguous]), 1.9, help)
    expect(coach.update(snapshot(), 2.49, help).badBeats).toBe(0)
  })

  it('responds to real sequence estimates over 100 ms even while the precise meter withholds a score', () => {
    const engine = new TimingEngine({ bpm: 120 })
    const coach = new MetronomeCoach()
    engine.start(0)
    const times = [0, 0.5, 1, 1.5, 2, 2.62, 3.12, 3.62, 4.12, 4.51, 5.01, 5.51, 6.01]
    const transitions: boolean[] = []
    let previous = false
    let estimatedLargeError = false
    for (let i = 0; i <= 710; i++) {
      const time = i / 100
      while (times.length && times[0] <= time) engine.addOnset({ time: times.shift()!, strength: 0.8, confidence: 0.95 })
      const view = engine.snapshot(time)
      estimatedLargeError ||= view.hits.some(hit => hit.errorMs === null && (hit.guidance?.errorMs ?? 0) > 100)
      const current = coach.update(view, time, help).helping
      if (current !== previous) transitions.push(current)
      previous = current
    }
    expect(estimatedLargeError).toBe(true)
    expect(transitions).toEqual([true, false])
    expect(engine.snapshot(7.1).phaseOrigin).toBe(0)
  })
})
