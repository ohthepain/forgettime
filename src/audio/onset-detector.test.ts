import { describe, expect, it } from 'vitest';
import { OnsetDetector, type DetectedOnset } from './onset-detector';
import { TimingEngine } from './engine';
import { accentFollowUpFixture, levelRecoveryFixture } from './fixtures/level-recovery';

const rate = 48_000;
/** Deterministic synthetic impulses/noise. These are not acoustic drum recordings. */
function fixture(duration: number, attacks: { time: number; amplitude: number; decay?: number }[]) {
  const samples = new Float32Array(Math.round(duration * rate));
  let seed = 17;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 0x1_0000_0000) * 2 - 1;
  };
  for (const attack of attacks) {
    const decay = attack.decay ?? 0.025;
    const start = Math.round(attack.time * rate);
    for (let i = start; i < Math.min(samples.length, start + decay * rate * 10); i += 1) {
      const elapsed = (i - start) / rate;
      samples[i] += attack.amplitude * Math.exp(-elapsed / decay) * (0.6 * noise() + 0.4 * Math.cos(2 * Math.PI * 120 * elapsed));
    }
  }
  return samples;
}
function detect(samples: Float32Array, blockSize = 128, origin = 0) {
  const detector = new OnsetDetector();
  const onsets = [];
  for (let i = 0; i < samples.length; i += blockSize) {
    onsets.push(...detector.process(samples.subarray(i, i + blockSize), origin + i / rate, rate));
  }
  return onsets;
}

/** Synthetic pass-by rumble/hiss with a slow level change, not a real car recording. */
function ambience(duration: number, frequency: number, amplitude = 0.04, alreadyPresent = false) {
  const samples = new Float32Array(Math.round(duration * rate));
  let seed = 97;
  for (let i = 0; i < samples.length; i++) {
    const time = i / rate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2 ** 31 - 1;
    const envelope = alreadyPresent ? 1 : Math.sin(Math.PI * time / duration) ** 2;
    samples[i] = amplitude * envelope * (0.8 * Math.sin(2 * Math.PI * frequency * time) + 0.2 * noise);
  }
  return samples;
}

describe('captured-audio transient detection (synthetic fixtures)', () => {
  it.each([44_100, 48_000])('recovers slowly after accents, retains ghost notes and eventually accepts quieter playing at %i Hz', sampleRate => {
    const { samples, expectedTimes } = levelRecoveryFixture(sampleRate);
    const original = samples.slice();
    const detector = new OnsetDetector();
    const onsets: DetectedOnset[] = [];
    for (let i = 0; i < samples.length; i += 997) {
      onsets.push(...detector.process(samples.subarray(i, i + 997), i / sampleRate, sampleRate));
    }
    expect(onsets).toHaveLength(expectedTimes.length);
    expectedTimes.forEach((time, i) => expect(Math.abs(onsets[i].time - time)).toBeLessThan(0.004));
    expect(onsets[2].strength).toBeLessThan(onsets[1].strength / 5);
    // Recovery affects detection only: no gain or compression is applied to samples.
    expect(samples).toEqual(original);
  });

  it.each([44_100, 48_000])('finds distinct softer attacks 40 ms after accents at %i Hz', sampleRate => {
    const { samples, expectedTimes } = accentFollowUpFixture(sampleRate);
    const onsets = new OnsetDetector().process(samples, 0, sampleRate);
    expect(onsets).toHaveLength(expectedTimes.length);
    expectedTimes.forEach((time, i) => expect(Math.abs(onsets[i].time - time)).toBeLessThan(0.004));
    expect(onsets[1].strength).toBeLessThan(onsets[0].strength / 5);
  });

  it('ignores faint post-playing transients through the full-bar timeout without hiding the beat early', () => {
    const { samples } = levelRecoveryFixture(rate);
    const detector = new OnsetDetector();
    const engine = new TimingEngine({ bpm: 120 });
    engine.start(0);
    let lastHit = 0;
    let phase: number | null = null;
    let pausedAt = 0;
    for (let i = 0; i < samples.length; i += 997) {
      for (const onset of detector.process(samples.subarray(i, i + 997), i / rate, rate)) {
        engine.addOnset(onset);
        lastHit = onset.time;
      }
      const time = detector.processedThrough ?? 0;
      const state = engine.snapshot(time);
      if (state.status === 'playing') {
        phase ??= state.phaseOrigin;
        expect(state.phaseOrigin).toBe(phase);
        expect(state.beat).not.toBeNull();
      }
      if (state.status === 'paused') { pausedAt = time; break; }
    }
    expect(lastHit).toBeCloseTo(1.1, 2);
    expect(pausedAt - lastHit).toBeGreaterThanOrEqual(2);
    expect(pausedAt - lastHit).toBeLessThan(2.024);
  });

  it.each([25, 40, 60, 90, 160, 350])('ignores slowly passing %i Hz rumble instead of starting a performance', frequency => {
    expect(detect(ambience(4, frequency))).toEqual([]);
  });

  it('does not manufacture an opening hit from background sound already present at activation', () => {
    expect(detect(ambience(2, 45, 0.08, true))).toEqual([]);
  });

  it.each([25, 40, 60, 90, 160, 350])('does not reopen detection on ongoing %i Hz room noise after an accent', frequency => {
    const samples = ambience(3, frequency, 0.08, true);
    const accent = fixture(3, [{ time: 0.1, amplitude: 0.8, decay: 0.008 }]);
    for (let i = 0; i < samples.length; i++) samples[i] += accent[i];
    const onsets = detect(samples);
    expect(onsets).toHaveLength(1);
    expect(onsets[0].time).toBeCloseTo(0.1, 2);
  });

  it('rejects very low-level transients while retaining intentional quiet attacks', () => {
    expect(detect(fixture(2, [0.2, 0.6, 1.1, 1.5].map(time => ({ time, amplitude: 0.008 }))))).toEqual([]);
    const times = [0.2, 0.6, 1.1, 1.5];
    const onsets = detect(fixture(2, times.map(time => ({ time, amplitude: 0.04 }))));
    expect(onsets).toHaveLength(times.length);
    times.forEach((time, i) => expect(Math.abs(onsets[i].time - time)).toBeLessThan(0.004));
  });

  it('detects hits including a quieter note over ongoing rumble without retriggering on the rumble', () => {
    const times = [0.3, 0.8, 1.3, 1.425, 1.55, 1.8];
    const samples = ambience(3, 45, 0.012, true);
    const drums = fixture(3, times.map((time, i) => ({ time, amplitude: i === 3 ? 0.08 : 0.7 })));
    for (let i = 0; i < samples.length; i++) samples[i] += drums[i];
    const onsets = detect(samples);
    expect(onsets).toHaveLength(times.length);
    times.forEach((time, i) => expect(Math.abs(onsets[i].time - time)).toBeLessThan(0.004));
  });

  it('lets the full-bar timeout expire while non-percussive ambient noise continues', () => {
    const engine = new TimingEngine({ bpm: 120 });
    const detector = new OnsetDetector();
    engine.start(0);
    const times = [0.3, 0.8, 1.3, 1.8, 2.3, 2.8];
    const samples = ambience(6, 45, 0.012, true);
    const drums = fixture(6, times.map(time => ({ time, amplitude: 0.7 })));
    for (let i = 0; i < samples.length; i++) samples[i] += drums[i];
    let phase: number | null = null;
    let lastHit = 0;
    let pausedAt = 0;
    for (let i = 0; i < samples.length; i += 128) {
      for (const onset of detector.process(samples.subarray(i, i + 128), i / rate, rate)) {
        lastHit = onset.time;
        engine.addOnset(onset);
      }
      const time = detector.processedThrough ?? i / rate;
      const snapshot = engine.snapshot(time);
      if (snapshot.status === 'playing') phase ??= snapshot.phaseOrigin;
      if (snapshot.status === 'paused') { pausedAt = time; break; }
    }
    expect(phase).toBeCloseTo(0.3, 2);
    expect(lastHit).toBeCloseTo(2.8, 2);
    expect(pausedAt - lastHit).toBeGreaterThanOrEqual(2);
    expect(pausedAt - lastHit).toBeLessThan(2.004);
  });

  it('detects a steady groove including quieter ghost notes using sample timestamps', () => {
    const times = [0.1, 0.35, 0.6, 0.725, 0.85, 1.1];
    const samples = fixture(1.5, times.map((time, i) => ({ time, amplitude: i === 3 ? 0.08 : 0.7 })));
    const onsets = detect(samples);
    expect(onsets).toHaveLength(times.length);
    times.forEach((time, i) => expect(Math.abs(onsets[i].time - time)).toBeLessThan(0.004));
  });

  it('does not mistake a synthetic decaying cymbal tail for continuing hits', () => {
    const onsets = detect(fixture(4, [{ time: 0.1, amplitude: 0.8, decay: 0.6 }]));
    expect(onsets).toHaveLength(1);
    expect(onsets[0].time).toBeCloseTo(0.1, 2);
  });

  it('is independent of callback batching and timestamp origin', () => {
    const samples = fixture(2, [0.123, 0.371, 0.902, 1.03, 1.6].map((time) => ({ time, amplitude: 0.5 })));
    const small = detect(samples, 128);
    const irregular = detect(samples, 997, 12345);
    expect(small).toHaveLength(5);
    expect(irregular).toHaveLength(small.length);
    small.forEach((onset, i) => expect(irregular[i].time - 12345).toBeCloseTo(onset.time, 7));
  });

  it('can preserve two audible attacks in a flam for the interpretation layer to mark uncertain', () => {
    const onsets = detect(fixture(0.5, [
      { time: 0.1, amplitude: 0.6, decay: 0.004 },
      { time: 0.129, amplitude: 0.8, decay: 0.01 },
    ]));
    expect(onsets).toHaveLength(2);
    expect(onsets[1].time - onsets[0].time).toBeLessThan(0.045);
  });

  it('handles silence, malformed samples and discontinuities without manufactured attacks', () => {
    const detector = new OnsetDetector();
    expect(detector.process(new Float32Array(4800), 0, rate)).toEqual([]);
    expect(detector.process(new Float32Array(128).fill(Number.NaN), 0.1, rate)).toEqual([]);
    expect(detector.process(new Float32Array(4800), 10, rate)).toEqual([]);
    expect(() => detector.process(new Float32Array(1), 0, 0)).toThrow(RangeError);
  });

  it('keeps a pre-timeout attack in the same performance when its analysis window is incomplete', () => {
    const detector = new OnsetDetector();
    const engine = new TimingEngine({ bpm: 120 });
    engine.start(0);
    const attacks = [0.101, 0.601, 1.101, 1.601, 2.101, 2.601, 4.6005];
    const samples = fixture(4.7, attacks.map(time => ({ time, amplitude: 0.8, decay: 0.008 })));
    let firstOrigin: number | null = null;
    const statuses: string[] = [];
    // Non-aligned buffers intentionally end just after the timeout but before
    // the detector's partial analysis window can report the prior attack.
    const block = 97;
    for (let offset = 0; offset < samples.length; offset += block) {
      const onsets = detector.process(samples.subarray(offset, offset + block), offset / rate, rate);
      onsets.forEach(onset => engine.addOnset(onset));
      const state = engine.snapshot(detector.processedThrough ?? offset / rate);
      if (state.status === 'playing') firstOrigin ??= state.phaseOrigin;
      if (offset / rate >= 2.7) statuses.push(state.status);
    }
    expect(firstOrigin).toBeCloseTo(0.101, 2);
    expect(statuses.every(status => status === 'playing')).toBe(true);
    expect(engine.snapshot(detector.processedThrough!).phaseOrigin).toBe(firstOrigin);
  });
});
