import { melSpectrogram } from './mel-spectrogram';
self.onmessage = (event: MessageEvent<{ samples: Float32Array; sampleRate: number; sourceStart: number; start: number; end: number }>) => {
  try {
    const { samples, sampleRate, sourceStart, start, end } = event.data;
    const result = melSpectrogram(samples, sampleRate, sourceStart, start, end);
    self.postMessage(result, { transfer: [result.pixels.buffer] });
  } catch { self.postMessage({ error: 'Mel display unavailable' }); }
};
