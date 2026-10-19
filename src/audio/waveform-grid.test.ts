import { expect, it } from 'vite-plus/test';
import { detailWaveformGrid } from './waveform-grid';

it('adds half notes, quarters and eighths as fewer bars fit in the viewport', () => {
  const grid = (end: number) => detailWaveformGrid(0, end, 8000, 120, 0);
  expect(grid(64000).map(marker => marker.label)).toEqual(['1.1.1', '2.1.1', '3.1.1', '4.1.1']);
  expect(grid(32000).map(marker => marker.label)).toEqual(['1.1.1', '1.3.1', '2.1.1', '2.3.1']);
  expect(grid(16000).map(marker => marker.label)).toEqual(['1.1.1', '1.2.1', '1.3.1', '1.4.1']);
  expect(grid(8000).map(marker => marker.label)).toEqual(['1.1.1', '1.1.2', '1.2.1', '1.2.2']);
  expect(grid(4000).map(marker => marker.label)).toEqual(['1.1.1', '1.1.2', '1.1.3', '1.1.4']);
});
it('keeps subdivisions anchored to beat one while panning and at fractional frame tempos', () => {
  const rate = 44100, bpm = 91, origin = 137;
  const step = rate * 60 / bpm / 2;
  const markers = detailWaveformGrid(origin + step * 2.3, origin + step * 6.5, rate, bpm, origin);
  expect(markers).toHaveLength(4);
  expect(markers[0].frame).toBeCloseTo(origin + step * 3);
  expect(markers[0].label).toBe('1.2.2');
  expect(markers.every(marker => marker.frame >= origin + step * 2.3 && marker.frame < origin + step * 6.5)).toBe(true);
});
it('handles unavailable grid and sample-scale zoom without unbounded markers', () => {
  expect(detailWaveformGrid(0, 100, 8000, 0, 0)).toEqual([]);
  expect(detailWaveformGrid(0, 100, 8000, 120, 200)).toEqual([]);
  expect(detailWaveformGrid(0, 1, 8000, 120, 0).length).toBeLessThanOrEqual(1);
});
