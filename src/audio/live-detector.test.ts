import { expect, it } from 'vite-plus/test';
import { createLiveDetector } from './live-detector';
import { baselineParameters } from './training-optimizer';
import { OnsetDetector } from './onset-detector';
import { MelDetector } from './mel-detector';

for (const family of ['current', 'mel'] as const) {
  it(`uses the selected ${family} parameters with chunk-independent sample timestamps and safe watermark`, () => {
    const rate = 48000;
    const pcm = new Float32Array(rate);
    for (const t of [0.2, 0.5, 0.54, 0.8]) for (let i = 0; i < rate * 0.08; i++) pcm[Math.round(t * rate) + i] += 0.6 * Math.exp(-i / (rate * 0.012)) * Math.sin(i * 2.73);
    const profile = baselineParameters(family);
    const detector = createLiveDetector(profile);
    const hits = [];
    for (let offset = 0; offset < pcm.length; offset += 997) {
      hits.push(...detector.process(pcm.subarray(offset, offset + 997), offset / rate, rate));
      expect(detector.processedThrough!).toBeLessThanOrEqual((offset + Math.min(997, pcm.length - offset)) / rate);
      expect(hits.every(hit => hit.time <= detector.processedThrough!)).toBe(true);
      detector.drainDiagnostics();
    }
    const whole = createLiveDetector(profile).process(pcm, 0, rate);
    expect(hits.map(hit => ({ ...hit, time: Math.round(hit.time * rate) }))).toEqual(whole.map(hit => ({ ...hit, time: Math.round(hit.time * rate) })));
    expect(hits.length).toBeGreaterThan(0);
    const expected: number[] = [];
    if (profile.family === 'mel') {
      const { family: _, ...settings } = profile;
      const offline = new MelDetector(settings);
      for (let i = 0; i < pcm.length; i++) { const hit = offline.process(pcm[i], i, rate); if (hit) expected.push(hit.sourceFrame / rate); }
    } else {
      const { family: _, frequencyBalance, ...settings } = profile;
      expected.push(...new OnsetDetector({ version: 1, ...settings }, frequencyBalance).process(pcm, 0, rate).map(hit => hit.time));
    }
    expect(hits.map(hit => Math.round(hit.time * rate))).toEqual(expected.map(time => Math.round(time * rate)));
    expect(detector.analysis!.version.length).toBeLessThanOrEqual(100);
    detector.reset();
    expect(detector.process(pcm, 0, rate)).toEqual(whole);
  });
}
