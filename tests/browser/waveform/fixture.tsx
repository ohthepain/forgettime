import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WaveformDisplay, type WaveformMarker } from '../../../src/components/WaveformDisplay';
import '../../../src/styles.css';

// Synthetic source-clock fixture: no microphone, persistence or detector accuracy claims.
const sampleRate = 8000;
const barFrames = sampleRate * 2;
const audio = { sampleRate, channels: 1, samples: Float32Array.from({ length: barFrames * 2 }, (_, i) =>
  Math.sin(i * 2 * Math.PI * 440 / sampleRate) * Math.exp(-(i % 4000) / 800) * .7) };
const markers: WaveformMarker[] = [0, 1].flatMap(bar => [
  { frame: bar * barFrames + 2000, kind: 'desired', outcome: 'correct' },
  { frame: bar * barFrames + 6000, kind: 'desired', outcome: 'missing' },
  { frame: bar * barFrames + 10000, kind: 'calculated', outcome: 'extra' },
]);
function Fixture() {
  const [bar, setBar] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  return <main style={{ maxWidth: 720, margin: '24px auto', padding: 16 }}>
    <output aria-label="Selected bar">Bar {bar + 1}</output>
    <output aria-label="Selected attack">{selected === null ? 'No attack selected' : `Selected frame ${selected}`}</output>
    <WaveformDisplay audio={audio} range={{ start: bar * barFrames, end: (bar + 1) * barFrames }}
      markers={markers} grid={{ bpm: 120, beatOneFrame: 0 }} selectedFrame={selected}
      onSelect={setSelected} onSelectBar={index => { setBar(index); setSelected(null); }} scope="annotation" />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
