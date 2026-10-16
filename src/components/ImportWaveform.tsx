import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AudioRegionPreview } from "../audio/audio-region-preview";
import type { DecodedImportAudio } from "../audio/audio-import";
import type { DetectorSettings } from "../audio/detector-contract";
import { useImportDetections } from "../audio/use-import-detections";

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
function waveformPath(samples: Float32Array, start: number, end: number, peak: number, gain = 1) {
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
export function ImportWaveform({
  audio,
  beatOne,
  place,
  settings,
}: {
  audio: DecodedImportAudio;
  beatOne: number;
  place: (time: number) => void;
  settings: DetectorSettings;
}) {
  const duration = audio.samples.length / audio.sampleRate,
    maximum = (audio.samples.length - 1) / audio.sampleRate;
  const [view, setView] = useState({ start: 0, span: duration, gain: 1 });
  const [selected, setSelected] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focusedMarker, setFocusedMarker] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const preview = useRef(new AudioRegionPreview());
  const previewGeneration = useRef(0);
  const stopPreview = useCallback(() => {
    previewGeneration.current++;
    preview.current.stop();
    setPreviewing(null);
  }, []);
  useEffect(() => {
    stopPreview(); setPreviewError(null); setHovered(null); setFocusedMarker(null);
    return stopPreview;
  }, [audio, settings, view.start, view.span, stopPreview]);
  useEffect(() => {
    const visibility = () => { if (document.hidden) stopPreview() };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') stopPreview() };
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('keydown', escape);
    window.addEventListener('pagehide', stopPreview);
    return () => { document.removeEventListener('visibilitychange', visibility); document.removeEventListener('keydown', escape); window.removeEventListener('pagehide', stopPreview) };
  }, [stopPreview]);
  async function playMarker(time: number) {
    stopPreview();
    const token = ++previewGeneration.current;
    setSelected(time); setPreviewError(null); setPreviewing(time);
    try {
      const started = await preview.current.play(audio, time, Math.min(duration, view.start + view.span), () => {
        if (token === previewGeneration.current) setPreviewing(null);
      });
      if (!started && token === previewGeneration.current) setPreviewing(null);
    } catch (error) {
      if (token !== previewGeneration.current) return;
      setPreviewing(null);
      setPreviewError(error instanceof Error ? error.message : 'Audio preview could not start.');
    }
  }
  const pointers = useRef(new Set<number>());
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<{
    surface: "main" | "overview";
    blocked: boolean;
    x: number;
    y: number;
    fraction: number;
    width: number;
    view: typeof view;
    hitTime: number | null;
    moved: boolean;
    axis: "vertical" | "horizontal" | null;
  } | null>(null);
  const updateView = (next: typeof view) => {
    viewRef.current = next;
    setView(next);
  };
  function beginGesture(event: ReactPointerEvent<SVGSVGElement>, surface: "main" | "overview") {
    if (event.button !== 0 || pointers.current.has(event.pointerId)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.add(event.pointerId);
    if (pointers.current.size > 1) {
      if (drag.current) drag.current.blocked = true;
      return;
    }
    const fraction = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const onset = (event.target as Element).getAttribute("data-onset");
    drag.current = {
      surface,
      blocked: false,
      x: event.clientX,
      y: event.clientY,
      fraction,
      width: bounds.width,
      view: viewRef.current,
      hitTime: onset === null ? null : Number(onset),
      moved: false,
      axis: null,
    };
  }
  function moveGesture(event: ReactPointerEvent<SVGSVGElement>) {
    const start = drag.current;
    if (!pointers.current.has(event.pointerId) || !start || start.blocked) return;
    const dx = event.clientX - start.x,
      dy = event.clientY - start.y;
    if (!start.moved && Math.max(Math.abs(dx), Math.abs(dy)) >= 7) {
      start.moved = true;
      start.axis = Math.abs(dy) >= Math.abs(dx) ? "vertical" : "horizontal";
    }
    if (!start.moved) return;
    if (start.axis === "vertical") {
      const span = clamp(start.view.span * Math.exp(dy / 100), Math.min(duration, 32 / audio.sampleRate), duration);
      const fraction =
        start.surface === "main"
          ? start.fraction
          : clamp((start.fraction * duration - start.view.start) / start.view.span, 0, 1);
      updateView({
        ...start.view,
        span,
        start: clamp(start.view.start + fraction * (start.view.span - span), 0, duration - span),
      });
    } else if (start.surface === "main")
      updateView({ ...start.view, gain: clamp(start.view.gain * Math.exp(dx / 100), 0.25, 64) });
    else
      updateView({
        ...start.view,
        start: clamp(start.view.start + (dx / start.width) * duration, 0, duration - start.view.span),
      });
  }
  function finishPointer(id: number, cancelled = false) {
    if (!pointers.current.has(id)) return;
    const start = drag.current;
    if (!cancelled && pointers.current.size === 1 && start && !start.blocked && !start.moved) {
      if (start.surface === "main") {
        if (start.hitTime !== null) setSelected(start.hitTime);
        else place(start.view.start + start.fraction * start.view.span);
      } else {
        const time = start.fraction * duration;
        if (time < start.view.start || time > start.view.start + start.view.span)
          updateView({ ...start.view, start: clamp(time - start.view.span / 2, 0, duration - start.view.span) });
      }
    }
    pointers.current.delete(id);
    // A multi-pointer gesture stays blocked until every pointer is released.
    if (pointers.current.size && start) start.blocked = true;
    else drag.current = null;
  }
  useEffect(() => {
    setView({ start: 0, span: duration, gain: 1 });
    setSelected(null);
    setPage(0);
    pointers.current.clear();
    drag.current = null;
  }, [audio, duration]);
  const { hits, pending } = useImportDetections(audio, settings);
  const peak = useMemo(() => {
    let peak = 0.001;
    for (const sample of audio.samples) peak = Math.max(peak, Math.abs(sample));
    return peak;
  }, [audio]);
  const overview = useMemo(() => waveformPath(audio.samples, 0, audio.samples.length, peak), [audio, peak]);
  const path = useMemo(
    () =>
      waveformPath(
        audio.samples,
        Math.floor(view.start * audio.sampleRate),
        Math.min(audio.samples.length, Math.ceil((view.start + view.span) * audio.sampleRate)),
        peak,
        view.gain,
      ),
    [audio, peak, view],
  );
  const x = (time: number) => ((time - view.start) / view.span) * 512;
  const visible = hits.filter((hit) => hit.time >= view.start && hit.time <= view.start + view.span);
  const activeMarker = visible.find(hit => hit.time === (hovered ?? focusedMarker ?? selected));
  function hoverMarker(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerType === 'touch' || pointers.current.size) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const position = event.clientX - bounds.left;
    const previous = visible.find(hit => hit.time === hovered);
    // Keep the full column above the square button interactive, not just the
    // narrow line. This lets the pointer reach the button without deselection.
    if (previous) {
      const left = (previous.time - view.start) / view.span * bounds.width;
      if (position >= left - 5 && position <= left + 24) return;
    }
    const closest = visible.reduce<typeof visible[number] | null>((best, hit) => {
      const distance = Math.abs((hit.time - view.start) / view.span * bounds.width - position);
      const bestDistance = best ? Math.abs((best.time - view.start) / view.span * bounds.width - position) : Infinity;
      return distance <= 6 && distance < bestDistance ? hit : best;
    }, null);
    setHovered(closest?.time ?? null);
  }
  const pages = Math.max(1, Math.ceil(visible.length / 40)),
    currentPage = Math.min(page, pages - 1);
  return (
    <div className="import-waveform">
      <div className="import-detail" onPointerLeave={() => setHovered(null)}>
      <svg
        className="import-detail-plot"
        viewBox="0 0 512 64"
        preserveAspectRatio="none"
        role="slider"
        tabIndex={0}
        aria-label="Beat one position"
        aria-valuemin={0}
        aria-valuemax={maximum}
        aria-valuenow={beatOne}
        aria-valuetext={`${beatOne.toFixed(6)} seconds`}
        onPointerDown={(event) => beginGesture(event, "main")}
        onPointerEnter={hoverMarker}
        onPointerMove={(event) => { hoverMarker(event); moveGesture(event) }}
        onPointerUp={(event) => finishPointer(event.pointerId)}
        onPointerCancel={(event) => finishPointer(event.pointerId, true)}
        onLostPointerCapture={(event) => finishPointer(event.pointerId, true)}
        onKeyDown={(event) => {
          if (["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const step = event.shiftKey ? 0.01 : 1 / audio.sampleRate;
            place(
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? maximum
                  : beatOne + (event.key === "ArrowLeft" || event.key === "ArrowDown" ? -step : step),
            );
          }
        }}
      >
        <path d={path} className="waveform-trace" />
        {visible.map((hit) => (
          <g key={hit.time}>
            <line
              x1={x(hit.time)}
              x2={x(hit.time)}
              y1={0}
              y2={64}
              className="import-detection-marker"
              stroke={hovered === hit.time || focusedMarker === hit.time ? "#fff1c9" : selected === hit.time ? "#ffe3a3" : "#f2a65a"}
              strokeWidth={activeMarker?.time === hit.time ? 2 : 1}
            />
            <line
              data-onset={hit.time}
              x1={x(hit.time)}
              x2={x(hit.time)}
              y1={0}
              y2={64}
              stroke="transparent"
              strokeWidth={10}
            >
              <title>Attack at {hit.time.toFixed(6)} source seconds</title>
            </line>
          </g>
        ))}
        <line x1={x(beatOne)} x2={x(beatOne)} y1={0} y2={64} stroke="#b7e3bb" strokeWidth={2} />
      </svg>
      {activeMarker && <button type="button" className="import-marker-play"
        style={{ left: `${(activeMarker.time - view.start) / view.span * 100}%` }}
        aria-label={previewing === activeMarker.time ? 'Stop audio preview' : `Play from ${activeMarker.time.toFixed(6)} seconds to ${Math.min(duration, view.start + view.span).toFixed(6)} seconds`}
        onPointerEnter={() => setHovered(activeMarker.time)}
        onFocus={() => setFocusedMarker(activeMarker.time)} onBlur={() => setFocusedMarker(null)}
        onPointerDown={event => event.stopPropagation()}
        onClick={() => { if (previewing === activeMarker.time) stopPreview(); else void playMarker(activeMarker.time) }}>
        <svg viewBox="0 0 14 14" aria-hidden="true">{previewing === activeMarker.time ? <rect x="3" y="3" width="8" height="8" /> : <path d="M4 2L12 7L4 12Z" />}</svg>
      </button>}
      </div>
      <svg
        className="import-overview"
        viewBox="0 0 512 64"
        preserveAspectRatio="none"
        role="slider"
        tabIndex={0}
        aria-label="Visible audio passage"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, duration - view.span)}
        aria-valuenow={view.start}
        aria-valuetext={`${view.start.toFixed(3)} to ${(view.start + view.span).toFixed(3)} seconds`}
        onPointerDown={(event) => beginGesture(event, "overview")}
        onPointerMove={moveGesture}
        onPointerUp={(event) => finishPointer(event.pointerId)}
        onPointerCancel={(event) => finishPointer(event.pointerId, true)}
        onLostPointerCapture={(event) => finishPointer(event.pointerId, true)}
        onKeyDown={(event) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            setView((v) => ({
              ...v,
              start: clamp(
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? duration
                    : v.start + ((event.key === "ArrowLeft" ? -1 : 1) * v.span) / 4,
                0,
                duration - v.span,
              ),
            }));
          }
        }}
      >
        <path d={overview} className="waveform-trace" />
        <rect
          x={(view.start / duration) * 512}
          y={0}
          width={(view.span / duration) * 512}
          height={64}
          fill="#b7e3bb22"
          stroke="#b7e3bb"
        />
      </svg>
      <div className="import-view-controls">
        <button
          onClick={() =>
            setView((v) => {
              const span = Math.max(Math.min(duration, 32 / audio.sampleRate), v.span / 2);
              return { ...v, span, start: clamp(v.start + (v.span - span) / 2, 0, duration - span) };
            })
          }
        >
          Zoom time in
        </button>
        <button
          onClick={() =>
            setView((v) => {
              const span = Math.min(duration, v.span * 2);
              return { ...v, span, start: clamp(v.start - (span - v.span) / 2, 0, duration - span) };
            })
          }
        >
          Zoom time out
        </button>
        <button onClick={() => setView((v) => ({ ...v, gain: Math.min(64, v.gain * 2) }))}>Enlarge waveform</button>
        <button onClick={() => setView((v) => ({ ...v, gain: Math.max(0.25, v.gain / 2) }))}>Reduce waveform</button>
        <button onClick={() => setView({ start: 0, span: duration, gain: 1 })}>Reset zoom</button>
      </div>

      <p>
        {view.start.toFixed(3)}–{(view.start + view.span).toFixed(3)} s · waveform height {view.gain.toFixed(2)}×.{" "}
      </p>
      {previewing !== null && <div className="import-preview-status"><span>Previewing from {previewing.toFixed(3)} s · microphone off</span><button onClick={stopPreview}>Stop preview</button></div>}
      {previewError && <p role="alert" className="error-message">{previewError}</p>}
      <p role="status">
        {pending
          ? "Updating detections…"
          : `${hits.length} detected attacks · ${visible.length} in view. Preview analyzes the full file from its beginning.`}
      </p>
      {visible.length > 0 && (
        <details>
          <summary>Inspect detection markers</summary>
          <div className="candidate-list">
            {visible.slice(currentPage * 40, currentPage * 40 + 40).map((hit) => (
              <button key={hit.time} aria-pressed={selected === hit.time} onClick={() => setSelected(hit.time)}>
                Attack at {hit.time.toFixed(6)} s
              </button>
            ))}
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
      {selected !== null && hits.some((hit) => hit.time === selected) && (
        <p>Selected attack: {selected.toFixed(6)} source seconds.</p>
      )}
    </div>
  );
}
