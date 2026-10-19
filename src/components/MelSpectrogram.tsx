import { useEffect, useState } from 'react';
import type { DecodedImportAudio } from '../audio/audio-import';

/** SVG image under the shared marker and interaction layers. */
export function MelSpectrogram({ audio, start, end }: { audio: DecodedImportAudio; start: number; end: number }) {
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setImage(''); setError('');
    let worker: Worker;
    try { worker = new Worker(new URL('../audio/mel-spectrogram.worker.ts', import.meta.url), { type: 'module' }); }
    catch { setError('Mel display unavailable'); return; }
    let active = true;
    worker.onmessage = event => {
      if (!active) return;
      try {
        if (event.data.error) throw new Error(event.data.error);
        const { pixels, width, height } = event.data;
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Mel display unavailable');
        context.putImageData(new ImageData(pixels, width, height), 0, 0);
        setImage(canvas.toDataURL());
      } catch { setError('Mel display unavailable'); }
      worker.terminate();
    };
    worker.onerror = () => { if (active) setError('Mel display unavailable'); worker.terminate(); };
    // Real adjacent source context keeps view edges from manufacturing transients.
    const sourceStart = Math.max(0, Math.floor(start) - 8192);
    const samples = audio.samples.slice(sourceStart, Math.min(audio.samples.length, Math.ceil(end) + 8192));
    worker.postMessage({ samples, sampleRate: audio.sampleRate, sourceStart, start, end }, [samples.buffer]);
    return () => { active = false; worker.terminate(); };
  }, [audio, start, end]);
  return image
    ? <image data-testid="mel-spectrogram" href={image} x="0" y="0" width="512" height="64" preserveAspectRatio="none" pointerEvents="none" />
    : <text x="8" y="58" fill="#ddd" fontSize="5" pointerEvents="none">{error || 'Calculating mel spectrum…'}</text>;
}
