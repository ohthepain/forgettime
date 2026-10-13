import { describe, expect, it } from 'vitest';
import { hitOpacity, TimingEngine, type InterpretationMode } from './engine';

const hit = (engine: TimingEngine, time: number, confidence = 0.95) => engine.addOnset({ time, strength: 0.7, confidence });
function locked(bpm = 120, mode: InterpretationMode = 'auto') {
  const engine = new TimingEngine({ bpm, mode });
  engine.start(0);
  for (let i = 0; i < 6; i += 1) hit(engine, i * 60 / bpm);
  expect(engine.snapshot(5 * 60 / bpm).status).toBe('playing');
  return engine;
}

describe('the locked musical reference', () => {
  it('listens automatically, finds an opening reference, and does not score calibration hits', () => {
    const engine = new TimingEngine({ bpm: 120 });
    expect(engine.snapshot(0).status).toBe('idle');
    engine.start(0);
    expect(engine.snapshot(0).status).toBe('listening');
    hit(engine, 1);
    expect(engine.snapshot(1).status).toBe('finding');
    for (const time of [1.5, 2, 2.5, 3, 3.5]) hit(engine, time);
    expect(engine.snapshot(3.5)).toMatchObject({ status: 'playing', phaseOrigin: 1, hits: [] });
  });

  it('holds phase and selected BPM fixed when the drummer gradually drifts late', () => {
    const engine = locked();
    const errors: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const time = 3 + i * 0.5 + (i + 1) * 0.01;
      hit(engine, time);
      const state = engine.snapshot(time + 0.25);
      errors.push(state.hits.at(-1)!.errorMs!);
      expect(state.phaseOrigin).toBe(0);
      expect(state.bpm).toBe(120);
    }
    expect(errors[0]).toBeCloseTo(10, 4);
    expect(errors.at(-1)).toBeCloseTo(60, 4);
    expect(errors.every((error, i) => i === 0 || error > errors[i - 1])).toBe(true);
  });

  it('counts beats from time, never from number of attacks, including during a pause', () => {
    const engine = locked();
    hit(engine, 2.625);
    hit(engine, 2.75);
    hit(engine, 2.875);
    expect(engine.snapshot(2.99).beat).toBe(2);
    expect(engine.snapshot(3).beat).toBe(3);
    expect(engine.snapshot(3.5).beat).toBe(4);
    expect(engine.snapshot(4).beat).toBe(1);
    expect(engine.snapshot(4.5).beat).toBe(2);
  });

  it.each([60, 120, 240])('waits a full bar from the last hit at %s BPM, not the next boundary', (bpm) => {
    const engine = locked(bpm);
    const beat = 60 / bpm;
    const last = beat * 7.8;
    hit(engine, last);
    expect(engine.snapshot(beat * 8).status).toBe('playing');
    expect(engine.snapshot(last + 4 * beat - 0.0001).status).toBe('playing');
    expect(engine.snapshot(last + 4 * beat)).toMatchObject({ status: 'paused', beat: null, phaseOrigin: null });
  });

  it('continues the original reference after a shorter pause, and finds a fresh one after timeout', () => {
    const engine = locked();
    hit(engine, 4.49);
    expect(engine.snapshot(4.49).phaseOrigin).toBe(0);
    expect(engine.snapshot(6.49).status).toBe('paused');
    hit(engine, 7.13);
    expect(engine.snapshot(7.13)).toMatchObject({ status: 'finding', phaseOrigin: null, beat: null });
    for (let i = 1; i < 6; i += 1) hit(engine, 7.13 + i * 0.5);
    expect(engine.snapshot(9.63).phaseOrigin).toBeCloseTo(7.13);
  });

  it('does not lock a short burst or an incoherent opening', () => {
    const engine = new TimingEngine({ bpm: 60, mode: 'straight' });
    engine.start(0);
    for (const time of [0, 0.11, 0.21, 0.33, 0.44, 0.53]) hit(engine, time);
    expect(engine.snapshot(0.53).status).toBe('finding');
    for (const time of [0.77, 1.12, 1.64, 1.81, 2.12, 2.39, 2.64]) hit(engine, time);
    expect(engine.snapshot(2.64).status).toBe('finding');
  });

  it('resets the reference on tempo or interpretation edits, and stops completely on request', () => {
    const engine = locked();
    engine.configure({ bpm: 80 });
    expect(engine.snapshot(3)).toMatchObject({ bpm: 80, status: 'listening', beat: null });
    engine.stop();
    hit(engine, 4);
    expect(engine.snapshot(4)).toMatchObject({ status: 'idle', hits: [] });
    expect(() => engine.configure({ bpm: 0 })).toThrow(RangeError);
  });
});

describe('rhythmic intention and uncertainty', () => {
  it('recognizes a sixteenth-note fill with missing notes and leaves the clock in place', () => {
    const engine = locked();
    for (const time of [3, 3.125, 3.375, 3.5, 3.625, 3.875]) hit(engine, time + 0.008);
    const state = engine.snapshot(4.13);
    const fill = state.hits.filter((item) => item.time % 0.25 > 0.1);
    expect(fill.length).toBeGreaterThan(1);
    expect(fill.every((item) => item.subdivision === 'sixteenth')).toBe(true);
    expect(fill.every((item) => Math.abs(item.errorMs! - 8) < 0.0001)).toBe(true);
    expect(state.phaseOrigin).toBe(0);
  });

  it('selects triplets consistently across several attacks in Auto and Swing modes', () => {
    for (const mode of ['auto', 'swing'] as const) {
      const engine = locked(120, mode);
      for (let i = 0; i < 7; i += 1) hit(engine, 3 + i / 6 + 0.01);
      const state = engine.snapshot(4.26);
      expect(state.hits.length).toBeGreaterThan(2);
      expect(state.hits.every((item) => item.subdivision === 'triplet')).toBe(true);
      expect(state.hits.every((item) => Math.abs(item.errorMs! - 10) < 0.0001)).toBe(true);
    }
  });

  it('does not independently make every displaced note accurate by selecting its closest grid', () => {
    const engine = locked();
    for (const time of [3.01, 3.14, 3.26, 3.385, 3.515, 3.63]) hit(engine, time);
    const state = engine.snapshot(3.89);
    expect(state.hits.every((item) => item.subdivision === 'sixteenth')).toBe(true);
    const scored = state.hits.filter((item) => item.errorMs !== null);
    expect(scored.some((item) => item.errorMs! > 12)).toBe(true);
  });

  it('uses later fill evidence while continuous capture frames release individual marks in order', () => {
    const engine = locked();
    const attackTimes = [3.01, 3.135, 3.26, 3.385, 3.51, 3.635, 3.76];
    const seen = new Map<number, ReturnType<TimingEngine['snapshot']>['hits'][number]>();
    let next = 0;
    for (let frame = 2.52; frame < 4.1; frame += 0.02) {
      while (next < attackTimes.length && attackTimes[next] <= frame) hit(engine, attackTimes[next++]);
      for (const item of engine.snapshot(frame).hits) seen.set(item.id, item);
    }
    const lines = [...seen.values()];
    expect(lines).toHaveLength(attackTimes.length);
    const later = lines.filter((item) => item.time >= 3.26);
    expect(later.every((item) => item.subdivision === 'sixteenth' && !item.uncertain)).toBe(true);
    expect(lines.every((item, i) => i === 0 || item.displayedAt > lines[i - 1].displayedAt)).toBe(true);
    expect(hitOpacity(lines[0], lines[1].displayedAt)).toBeLessThan(hitOpacity(lines[1], lines[1].displayedAt));
  });

  it('marks flams and weak attacks uncertain without inventing a millisecond score', () => {
    const engine = locked();
    hit(engine, 3);
    hit(engine, 3.027);
    hit(engine, 3.5, 0.4);
    const state = engine.snapshot(3.75);
    expect(state.hits).toHaveLength(3);
    expect(state.hits.every((item) => item.uncertain && item.errorMs === null)).toBe(true);
    expect(state.hits[0].reason).toContain('Flam');
    expect(state.hits[2].reason).toContain('Weak');
  });

  it('preserves resolved line positions while new patterns arrive and fades in precisely one second', () => {
    const engine = locked();
    hit(engine, 3.012);
    const first = engine.snapshot(3.26).hits[0];
    expect(first.errorMs).toBeCloseTo(12);
    for (const time of [3.5, 3.6667, 3.8333]) hit(engine, time);
    expect(engine.snapshot(4).hits.find((item) => item.id === first.id)?.errorMs).toBe(first.errorMs);
    expect(hitOpacity(first, first.displayedAt)).toBe(1);
    expect(hitOpacity(first, first.displayedAt + 0.5)).toBeCloseTo(0.5);
    expect(hitOpacity(first, first.displayedAt + 1)).toBe(0);
    expect(engine.snapshot(first.displayedAt + 1).hits.some((item) => item.id === first.id)).toBe(false);
  });
});
