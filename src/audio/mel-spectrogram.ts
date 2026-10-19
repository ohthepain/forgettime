export const spectralFrequencyPosition = (frequency: number, sampleRate: number) =>
  1 - Math.log2(frequency / 30) / Math.log2(Math.min(16000, sampleRate / 2) / 30);

/** Display-only centered STFT: never feeds attack detection or scoring. */
export function melSpectrogram(samples: Float32Array, sampleRate: number, sourceStart: number, start: number, end: number, width = 512, bands = 64) {
  const n = Math.max(128, Math.min(8192, 2 ** Math.round(Math.log2(sampleRate * 0.02))));
  const real = new Float64Array(n), imaginary = new Float64Array(n);
  const window = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  const cosine = Float64Array.from({ length: n / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / n));
  const sine = Float64Array.from({ length: n / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / n));
  const high = Math.min(16000, sampleRate / 2);
  const edges = Array.from({ length: bands + 2 }, (_, i) => 30 * (high / 30) ** ((i - 1) / (bands - 1)));
  const filters = Array.from({ length: bands }, (_, b) => {
    const weights: [number, number][] = [];
    for (let bin = Math.max(1, Math.ceil(edges[b] * n / sampleRate)); bin <= Math.min(n / 2, Math.floor(edges[b + 2] * n / sampleRate)); bin++) {
      const hz = bin * sampleRate / n;
      const weight = hz <= edges[b + 1] ? (hz - edges[b]) / (edges[b + 1] - edges[b]) : (edges[b + 2] - hz) / (edges[b + 2] - edges[b + 1]);
      if (weight > 0) weights.push([bin, weight]);
    }
    // Narrow bass bands can fall between FFT bins. Interpolate the measured
    // spectrum instead of leaving those frequency rows blank.
    if (!weights.length) {
      const center = edges[b + 1] * n / sampleRate;
      const bin = Math.min(n / 2 - 1, Math.floor(center));
      weights.push([bin, 1 - (center - bin)], [bin + 1, center - bin]);
    }
    return weights;
  });
  const pixels = new Uint8ClampedArray(width * bands * 4);
  for (let column = 0; column < width; column++) {
    const center = Math.floor(start + (column + 0.5) / width * (end - start));
    for (let i = 0; i < n; i++) real[i] = (samples[center - Math.floor(n / 2) + i - sourceStart] ?? 0) * window[i];
    imaginary.fill(0);
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const t = real[i]; real[i] = real[j]; real[j] = t; }
    }
    for (let length = 2; length <= n; length *= 2) for (let base = 0; base < n; base += length) for (let j = 0; j < length / 2; j++) {
      const at = j * n / length, u = base + j, v = u + length / 2;
      const tr = real[v] * cosine[at] - imaginary[v] * sine[at], ti = real[v] * sine[at] + imaginary[v] * cosine[at];
      real[v] = real[u] - tr; imaginary[v] = imaginary[u] - ti;
      real[u] += tr; imaginary[u] += ti;
    }
    for (let band = 0; band < bands; band++) {
      let power = 0, weight = 0;
      for (const [bin, w] of filters[band]) { power += (real[bin] ** 2 + imaginary[bin] ** 2) * w; weight += w; }
      const db = 10 * Math.log10(Math.max(1e-12, power / Math.max(1, weight) / (n * n)));
      const level = Math.max(0, Math.min(1, (db + 90) / 75));
      const at = ((bands - band - 1) * width + column) * 4;
      // Fixed power scale: dark blue → purple → orange → pale yellow.
      const stops = [[10, 16, 30], [59, 28, 104], [166, 48, 111], [239, 126, 59], [255, 243, 161]];
      const index = Math.min(3, Math.floor(level * 4)), mix = level * 4 - index;
      for (let c = 0; c < 3; c++) pixels[at + c] = Math.round(stops[index][c] * (1 - mix) + stops[index + 1][c] * mix);
      pixels[at + 3] = 255;
    }
  }
  return { pixels, width, height: bands };
}
