import { useMemo, useRef, useState } from "react";
import type { DecodedImportAudio } from "../audio/audio-import";
import type { DetectorSettings } from "../audio/detector-contract";
import { useImportDetections } from "../audio/use-import-detections";
import { WaveformDisplay, type WaveformDisplayHandle, type WaveformView } from "./WaveformDisplay";

export function ImportWaveform({
  audio,
  beatOne,
  bpm = 100,
  place,
  settings,
  frequencyBalance = 100,
}: {
  audio: DecodedImportAudio;
  beatOne: number;
  bpm?: number;
  place: (time: number) => void;
  settings: DetectorSettings;
  frequencyBalance?: number;
}) {
  const waveform = useRef<WaveformDisplayHandle>(null);
  const { hits, pending } = useImportDetections(audio, settings, frequencyBalance);
  const [selected, setSelected] = useState<number | null>(null),
    [page, setPage] = useState(0);
  const [view, setView] = useState<WaveformView>({ start: 0, end: audio.samples.length, gain: 1 });
  const markers = useMemo(
    () =>
      hits.map((hit) => ({
        frame: Math.round(hit.time * audio.sampleRate),
        kind: "calculated" as const,
      })),
    [hits, audio.sampleRate],
  );
  const visible = hits.filter(
    (hit) => hit.time * audio.sampleRate >= view.start && hit.time * audio.sampleRate < view.end,
  );
  const pages = Math.max(1, Math.ceil(visible.length / 40)),
    currentPage = Math.min(page, pages - 1);
  return (
    <div className="import-waveform">
      <WaveformDisplay
        ref={waveform}
        audio={audio}
        markers={markers}
        selectedFrame={selected}
        onSelect={setSelected}
        grid={{ bpm, beatOneFrame: Math.round(beatOne * audio.sampleRate) }}
        cursor={{
          frame: Math.round(beatOne * audio.sampleRate),
          change: (frame) => place(frame / audio.sampleRate),
        }}
        onPlace={(frame) => place(frame / audio.sampleRate)}
        onViewChange={setView}
        contextKey={`${JSON.stringify(settings)}:${frequencyBalance}`}
      />
      <p role="status">
        {pending
          ? "Updating detections…"
          : `${hits.length} detected attacks · ${visible.length} in view. Preview analyzes the full file from its beginning.`}
      </p>
      {visible.length > 0 && (
        <details>
          <summary>Inspect detection markers</summary>
          <div className="candidate-list">
            {visible.slice(currentPage * 40, currentPage * 40 + 40).map((hit) => {
              const frame = Math.round(hit.time * audio.sampleRate);
              return (
                <button
                  key={frame}
                  aria-pressed={selected === frame}
                  onClick={() => waveform.current?.select(frame)}
                >
                  Attack at {hit.time.toFixed(6)} s
                </button>
              );
            })}
          </div>
          {pages > 1 && (
            <div>
              <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                Previous markers
              </button>
              <span>
                {currentPage + 1} / {pages}
              </span>
              <button disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>
                Next markers
              </button>
            </div>
          )}
        </details>
      )}
      {selected !== null && markers.some((m) => m.frame === selected) && (
        <p>Selected attack: {(selected / audio.sampleRate).toFixed(6)} source seconds.</p>
      )}
    </div>
  );
}
