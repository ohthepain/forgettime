import { expect, it } from 'vite-plus/test';
import { melSpectrogram, spectralFrequencyPosition } from './mel-spectrogram';

it('renders silence dark and puts higher frequencies nearer the top', () => {
  const rate = 48000;
  const silence = melSpectrogram(new Float32Array(rate), rate, 0, 5000, 10000, 8, 64);
  expect([...silence.pixels.slice(0, 4)]).toEqual([10, 16, 30, 255]);
  expect(silence.pixels).toHaveLength(8 * 64 * 4);
  const peakRow = (frequency: number) => {
    const samples = Float32Array.from({ length: rate }, (_, i) => 0.8 * Math.sin(i * 2 * Math.PI * frequency / rate));
    const image = melSpectrogram(samples, rate, 0, 5000, 10000, 8, 64);
    let best = 0, brightness = 0;
    for (let row = 0; row < 64; row++) {
      const at = (row * 8 + 4) * 4;
      const value = image.pixels[at] + image.pixels[at + 1];
      if (value > brightness) { best = row; brightness = value; }
    }
    expect(brightness).toBeGreaterThan(26);
    return best;
  };
  expect(peakRow(8000)).toBeLessThan(peakRow(100));
});
it('keeps source-time alignment and power colors unchanged when supplying cropped real context', () => {
  const samples = Float32Array.from({ length: 24000 }, (_, i) => Math.sin(i * 0.3) * Math.exp(-Math.abs(i - 12000) / 400));
  const full = melSpectrogram(samples, 48000, 0, 10000, 14000, 32);
  const cropped = melSpectrogram(samples.slice(8000, 16000), 48000, 8000, 10000, 14000, 32);
  expect(cropped.pixels).toEqual(full.pixels);
  const silence = melSpectrogram(new Float32Array(10), 8000, 0, 0, 10, 8);
  expect(silence.pixels.every(Number.isFinite)).toBe(true);
});

it('gives every octave equal vertical space, including bass octaves', () => {
  const steps = [60, 120, 240, 480, 960, 1920, 3840, 7680].map(hz => spectralFrequencyPosition(hz, 48000));
  const octave = spectralFrequencyPosition(30, 48000) - steps[0];
  for (let i = 1; i < steps.length; i++) expect(steps[i - 1] - steps[i]).toBeCloseTo(octave, 12);
  expect(spectralFrequencyPosition(30, 48000)).toBe(1);
  expect(spectralFrequencyPosition(16000, 48000)).toBe(0);
});
