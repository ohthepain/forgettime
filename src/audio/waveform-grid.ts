export interface DetailGridMarker {
  frame: number;
  label: string;
  bar: boolean;
}

/** Four beats per bar. Sub-beat positions count from one at the displayed resolution. */
export function detailWaveformGrid(start: number, end: number, sampleRate: number, bpm: number, beatOneFrame: number): DetailGridMarker[] {
  if (![start, end, sampleRate, bpm, beatOneFrame].every(Number.isFinite) || end <= start || sampleRate <= 0 || bpm < 30 || bpm > 300 || end <= beatOneFrame) return [];
  const barFrames = sampleRate * 240 / bpm;
  let divisions = 1;
  const count = (step: number) => Math.max(0, Math.ceil((end - beatOneFrame) / step - 1e-9) - Math.max(0, Math.ceil((start - beatOneFrame) / step - 1e-9)));
  // Bars → half notes → quarters → eighths, etc. Never add sub-sample lines.
  while (count(barFrames / divisions) < 4 && divisions < 1024 && barFrames / (divisions * 2) >= 1) divisions *= 2;
  const step = barFrames / divisions;
  const first = Math.max(0, Math.ceil((start - beatOneFrame) / step - 1e-9));
  const last = Math.ceil((end - beatOneFrame) / step - 1e-9);
  return Array.from({ length: Math.max(0, last - first) }, (_, i) => {
    const position = first + i;
    const withinBar = position % divisions;
    const beat = Math.floor(withinBar * 4 / divisions);
    const subBeat = divisions <= 4 ? 0 : withinBar % (divisions / 4);
    return { frame: beatOneFrame + position * step, label: `${Math.floor(position / divisions) + 1}.${beat + 1}.${subBeat + 1}`, bar: withinBar === 0 };
  });
}
