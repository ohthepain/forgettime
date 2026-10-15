import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeWav } from '../../scripts/lib/wav';
import { OnsetDetector, type DetectedOnset } from './onset-detector';

describe('user-confirmed WAV attack regression', () => {
  const { samples, sampleRate } = decodeWav(readFileSync(new URL('../../test-data/audio/beat 1 simple 120.wav', import.meta.url)));

  // Silence lets the existing startup gate finish. Vary sample alignment across
  // a complete detector window to catch trough-dependent retriggers. The source
  // remains unmodified; this test does not claim first-sample acquisition works.
  it.each([4410, 4423, 4436, 4449, 4462, 4475, 4488, 4501, 4514, 4527])(
    'keeps all eight quiet/loud groups without kick retriggers after %i lead-in frames', lead => {
      const pcm = new Float32Array(lead + samples.length);
      pcm.set(samples, lead);
      const detector = new OnsetDetector();
      const hits: DetectedOnset[] = [];
      for (let offset = 0; offset < pcm.length; offset += 997) {
        hits.push(...detector.process(pcm.subarray(offset, offset + 997), offset / sampleRate, sampleRate));
        detector.drainDiagnostics();
      }
      expect(hits).toHaveLength(8);
      hits.forEach((hit, i) => {
        // This is event association with the user's MIDI grid, not a claim of
        // measured acoustic onset accuracy. Backbeats precede that grid here.
        expect(Math.abs(hit.time - lead / sampleRate - i * 0.25)).toBeLessThan(0.02);
      });
    },
  );
});
