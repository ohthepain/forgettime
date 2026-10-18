const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export function waveformPath(
  samples: Float32Array,
  start: number,
  end: number,
  peak: number,
  gain = 1,
) {
  const columns = 512,
    low = new Float32Array(columns),
    high = new Float32Array(columns);
  for (let i = start; i < end; i++) {
    const x = Math.min(columns - 1, Math.floor(((i - start) / (end - start)) * columns)),
      sample = samples[i];
    low[x] = Math.min(low[x], sample);
    high[x] = Math.max(high[x], sample);
  }
  return Array.from(
    low,
    (sample, x) =>
      `M${x},${32 - clamp((sample / peak) * gain, -1, 1) * 28}V${32 - clamp((high[x] / peak) * gain, -1, 1) * 28}`,
  ).join("");
}
