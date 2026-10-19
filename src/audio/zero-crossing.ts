/** Return the next source-frame zero crossing, bounded by the editable passage. */
export function nextZeroCrossing(samples: Float32Array, frame: number, direction: -1 | 1, start = 0, end = samples.length): number {
  for (let i = frame + direction; i >= Math.max(0, start) && i < Math.min(samples.length, end); i += direction) {
    if (i === 0) { if (samples[0] === 0) return 0; else continue; }
    if ((samples[i] === 0 && samples[i - 1] !== 0) || samples[i] * samples[i - 1] < 0) return i;
  }
  return frame;
}
