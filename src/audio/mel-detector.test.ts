import { describe, expect, it } from "vite-plus/test";
import { MelDetector, DEFAULT_MEL_SETTINGS, type MelSettings, type MelOnset } from "./mel-detector";
function fixture(rate = 48000) {
  const pcm = new Float32Array(rate);
  for (const t of [0.2, 0.5, 0.54, 0.8]) {
    for (let i = 0; i < rate * 0.08; i++)
      pcm[Math.round(t * rate) + i] += 0.6 * Math.exp(-i / (rate * 0.012)) * Math.sin(i * 2.73);
  }
  return pcm;
}
function run(
  pcm: Float32Array,
  rate: number,
  settings: MelSettings = { ...DEFAULT_MEL_SETTINGS },
  chunks = [pcm.length],
) {
  const d = new MelDetector(settings),
    onsets: MelOnset[] = [];
  let frame = 0,
    packet = 0;
  while (frame < pcm.length) {
    const end = Math.min(pcm.length, frame + chunks[packet++ % chunks.length]);
    for (; frame < end; frame++) {
      const o = d.process(pcm[frame], frame, rate);
      if (o) onsets.push(o);
    }
  }
  return { d, onsets };
}
describe("causal experimental mel detector", () => {
  it("uses real sample clocks, fixed hop and chunk-invariant state with no synthetic leading/trailing samples", () => {
    const pcm = fixture(),
      a = run(pcm, 48000),
      b = run(pcm, 48000, { ...DEFAULT_MEL_SETTINGS }, [1, 7, 997, 13]);
    expect(b.onsets).toEqual(a.onsets);
    expect(b.d.state).toEqual(a.d.state);
    expect(a.onsets.length).toBeGreaterThan(0);
    expect(a.d.state.hopFrames).toBe(120);
    expect(a.d.state.receivedThroughFrame).toBe(pcm.length);
    expect(a.d.state.processedThroughFrame).toBeLessThan(pcm.length);
    for (const o of a.onsets) {
      expect(o.sourceFrame).toBeGreaterThanOrEqual(a.d.state.reliableFromFrame);
      expect(o.analyzedThroughFrame).toBeGreaterThan(o.sourceFrame);
    }
  });
  it("keeps an unfinished window or confirmation tail pending without fabricated flush", () => {
    const d = new MelDetector({ ...DEFAULT_MEL_SETTINGS, confirmation: 2 });
    for (let i = 0; i < 600; i++) expect(d.process(0, i, 48000)).toBeNull();
    expect(d.diagnostic.row).toBeNull();
    expect(d.state.pendingSamples).toBe(600);
    for (let i = 600; i < 1100; i++) d.process(0, i, 48000);
    expect(d.state.pendingSamples).toBe(76);
    const safe = d.state.processedThroughFrame;
    expect(safe).toBe(391);
    for (let i = 1100; i < 1144; i++) d.process(0, i, 48000);
    expect(d.state.processedThroughFrame).toBeGreaterThan(safe);
  });
  it("resets history on actual gaps and sample-rate changes but not ordinary packet boundaries", () => {
    const d = new MelDetector();
    for (let i = 0; i < 8000; i++) d.process(0, i, 48000);
    d.process(0, 9000, 48000);
    expect(d.state.segmentStartFrame).toBe(9000);
    expect(d.diagnostic.row).toBeNull();
    d.process(0, 9001, 44100);
    expect(d.state.sampleRate).toBe(44100);
    expect(d.state.segmentStartFrame).toBe(9001);
    expect(d.state.receivedThroughFrame).toBe(9002);
    d.reset();
    expect(d.state.sampleRate).toBe(0);
    expect(d.state.processedThroughFrame).toBe(0);
    expect(d.state.reliableFromFrame).toBe(0);
    expect(d.diagnostic.power).toHaveLength(0);
  });
  it("has analytically correct normalized DC power and flat impulse power", () => {
    const settings = { ...DEFAULT_MEL_SETTINGS, windowMs: 20 as const, bands: 24 as const },
      d = new MelDetector(settings);
    const n = 1024;
    for (let i = 0; i < n; i++) d.process(0.25, i, 48000);
    expect(d.diagnostic.power[0]).toBeCloseTo(0.0625, 12);
    const impulse = new MelDetector(settings);
    for (let i = 0; i < n; i++) impulse.process(i === 512 ? 1 : 0, i, 48000);
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * 512) / (n - 1));
    let sum = 0;
    for (let i = 0; i < n; i++) sum += 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    for (const p of impulse.diagnostic.power)
      expect(p).toBeCloseTo((hann * hann) / (sum * sum), 14);
  });
  it("produces no onsets on silence, exposes bounded snapshots and rejects invalid settings/rates/samples/degenerate filters", () => {
    const { d, onsets } = run(new Float32Array(48000), 48000);
    expect(onsets).toEqual([]);
    const snapshot = d.diagnostic;
    snapshot.power.fill(100);
    expect(d.diagnostic.power[0]).toBe(0);
    expect(() => new MelDetector({ ...DEFAULT_MEL_SETTINGS, threshold: NaN })).toThrow();
    expect(() => d.process(NaN, 48000, 48000)).toThrow();
    expect(() => d.process(0, 0.5, 48000)).toThrow();
    expect(() => d.process(0, 48000, 7999)).toThrow();
    expect(() =>
      new MelDetector({ ...DEFAULT_MEL_SETTINGS, bands: 96, windowMs: 10 }).process(0, 0, 8000),
    ).toThrow("filter");
  });
  it("discloses additional confirmation delay without shifting source-time markers by a global offset", () => {
    const pcm = fixture(),
      zero = run(pcm, 48000, { ...DEFAULT_MEL_SETTINGS, confirmation: 0 }),
      two = run(pcm, 48000, { ...DEFAULT_MEL_SETTINGS, confirmation: 2 });
    expect(zero.onsets.length).toBeGreaterThan(0);
    expect(two.onsets.length).toBeGreaterThan(0);
    for (const o of two.onsets)
      expect(o.analyzedThroughFrame - o.sourceFrame).toBe(511.5 + 240 + 1);
  });
});
