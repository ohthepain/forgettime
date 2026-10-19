import { spectralFrequencyPosition } from "../audio/mel-spectrogram";
import { MelSpectrogram } from "./MelSpectrogram";
import { detailWaveformGrid } from "../audio/waveform-grid";
import { nextZeroCrossing } from "../audio/zero-crossing";
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
} from "react";
import type { DecodedImportAudio } from "../audio/audio-import";
import { AudioRegionPreview } from "../audio/audio-region-preview";
import { waveformPath } from "../audio/waveform-path";

export interface WaveformMarker {
  frame: number;
  kind: "desired" | "calculated";
  uncertain?: boolean;
  outcome?: "correct" | "missing" | "extra";
}
export interface WaveformView {
  start: number;
  end: number;
  gain: number;
}
export interface WaveformDisplayHandle {
  stop: () => void;
  select: (frame: number) => void;
  focusMarker: (frame: number) => void;
}
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Source-frame display and one-shot playback. Callers own musical reference and annotation edits. */
export function WaveformDisplay({
  audio,
  range,
  markers,
  grid,
  cursor,
  beatOne,
  selectedFrame,
  onSelect,
  onPlace,
  onNudge,
  onDelete,
  onSelectBar,
  isBarIncluded,
  uncertainRegions = [],
  disabled = false,
  contextKey,
  onViewChange,
  onPlaybackChange,
  scope = "import",
  ref,
}: {
  audio: DecodedImportAudio;
  range?: { start: number; end: number };
  markers: WaveformMarker[];
  grid?: { bpm: number; beatOneFrame: number };
  cursor?: { frame: number; change: (frame: number) => void };
  beatOne?: { frame: number; change: (frame: number) => void };
  selectedFrame: number | null;
  onSelect: (frame: number) => void;
  onPlace?: (frame: number) => void;
  onNudge?: (frame: number, delta: number) => void;
  onDelete?: (frame: number) => void;
  onSelectBar?: (index: number) => void;
  isBarIncluded?: (index: number) => boolean;
  uncertainRegions?: { start: number; end: number }[];
  disabled?: boolean;
  contextKey?: unknown;
  onViewChange?: (view: WaveformView) => void;
  onPlaybackChange?: (playing: boolean) => void;
  scope?: "import" | "annotation";
  ref?: Ref<WaveformDisplayHandle>;
}) {
  const [display, setDisplay] = useState<"waveform" | "mel">("waveform");
  const start = range?.start ?? 0,
    end = range?.end ?? audio.samples.length;
  const rate = audio.sampleRate;
  const overviewStart = onSelectBar ? 0 : start;
  const overviewEnd = onSelectBar ? audio.samples.length : end;
  const overviewTotal = Math.max(1, overviewEnd - overviewStart);
  const total = overviewTotal;
  const [view, setView] = useState({ start, end, gain: 1 });
  const [region, setRegion] = useState<{ start: number; end: number } | null>(null);
  const [hovered, setHovered] = useState<number | null>(null),
    [focused, setFocused] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false),
    [error, setError] = useState("");
  const plot = useRef<SVGSVGElement>(null),
    preview = useRef(new AudioRegionPreview()),
    generation = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  const root = useRef<HTMLDivElement>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [moving, setMoving] = useState<{ frame: number; next: number } | null>(null);
  const moveRef = useRef<{ frame: number; next: number } | null>(null);
  const points = useMemo(
    () =>
      [...new Set([start, ...markers.map((m) => m.frame)])]
        .filter((f) => f >= start && f < end)
        .sort((a, b) => a - b),
    [markers, start, end],
  );
  const slices = useMemo(() => {
    const desired = markers
      .filter((m) => m.kind === "desired")
      .map((m) => m.frame)
      .filter((f) => f >= start && f < end)
      .sort((a, b) => a - b);
    return desired.length ? desired : points;
  }, [markers, points, start, end]);
  const markerKey = markers.map((m) => `${m.kind}:${m.frame}:${!!m.uncertain}`).join(",");
  const stop = useCallback(() => {
    generation.current++;
    preview.current.stop();
    setPlaying(false);
    setPlayhead(null);
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      stop,
      select,
      focusMarker: (frame) =>
        (
          plot.current?.querySelector<SVGGElement>(
            `[data-frame="${frame}"][data-marker-kind="desired"]`,
          ) ?? plot.current?.querySelector<SVGGElement>(`[data-frame="${frame}"]`)
        )?.focus(),
    }),
    [stop, onSelect],
  );
  useEffect(() => {
    onViewChange?.(view);
  }, [view, onViewChange]);
  useEffect(() => {
    onPlaybackChange?.(playing);
  }, [playing, onPlaybackChange]);
  useEffect(() => {
    const outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setRegion(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useEffect(() => {
    if (!playing) { setPlayhead(null); return; }
    let request = 0;
    const tick = () => { setPlayhead(preview.current.currentFrame ?? null); request = requestAnimationFrame(tick); };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [playing]);
  const pointers = useRef(new Set<number>());
  const drag = useRef<{
    id: number;
    surface: "detail" | "overview";
    x: number;
    y: number;
    fraction: number;
    width: number;
    view: WaveformView;
    region: typeof region;
    moved: boolean;
    blocked: boolean;
    axis: "x" | "y" | null;
  } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    setView({ start, end, gain: 1 });
  }, [audio, start, end]);
  useEffect(() => {
    stop();
    setRegion(null);
    setHovered(null);
    setFocused(null);
    pointers.current.clear();
    drag.current = null;
    setError("");
    moveRef.current = null;
    setMoving(null);
  }, [audio, start, end, markerKey, contextKey, disabled, stop]);
  useEffect(() => {
    stop();
  }, [view, selectedFrame, stop]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) stop();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") stop();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", stop);
    window.addEventListener("keydown", escape);
    return () => {
      generation.current++;
      preview.current.stop();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("keydown", escape);
    };
  }, [stop]);
  const span = Math.max(1, view.end - view.start);
  const visible = (frame: number) => frame >= view.start && frame < view.end;
  function updateView(left: number, width: number, gain = view.gain) {
    width = Math.round(clamp(width, Math.min(32, total), total));
    left = Math.round(clamp(left, overviewStart, overviewEnd - width));
    const next = { start: left, end: left + width, gain };
    viewRef.current = next;
    setView(next);
  }
  function sliceAt(frame: number) {
    return {
      start: slices.filter(f => f >= view.start && f <= frame).at(-1) ?? view.start,
      end: slices.find(f => f > frame && f < view.end) ?? view.end,
    };
  }
  function begin(event: PointerEvent<SVGSVGElement>, surface: "detail" | "overview") {
    if (disabled || event.button !== 0 || pointers.current.has(event.pointerId)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    pointers.current.add(event.pointerId);
    if (pointers.current.size > 1) {
      if (drag.current) {
        drag.current.blocked = true;
        setRegion(drag.current.region);
      }
      suppressClick.current = true;
      return;
    }
    suppressClick.current = false;
    drag.current = {
      id: event.pointerId,
      surface,
      x: event.clientX,
      y: event.clientY,
      fraction: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      width: bounds.width,
      view: viewRef.current,
      region,
      moved: false,
      blocked: false,
      axis: null,
    };
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const g = drag.current;
    if (!g || g.blocked || !pointers.current.has(event.pointerId)) return;
    const dx = event.clientX - g.x,
      dy = event.clientY - g.y,
      width = g.view.end - g.view.start;
    if (!g.moved && Math.max(Math.abs(dx), Math.abs(dy)) >= 7) {
      g.moved = true;
      g.axis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x";
      suppressClick.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    if (!g.moved) return;
    if (g.axis === "y" && g.surface === "overview")
      updateView(g.view.start, width, clamp(g.view.gain * Math.exp(-dy / 100), 0.25, 64));
    else if (g.axis === "y") {
      const next = clamp(width * Math.exp(dy / 100), Math.min(32, total), total);
      updateView(g.view.start + g.fraction * (width - next), next, g.view.gain);
    } else if (g.surface === "overview")
      updateView(g.view.start + (dx / g.width) * total, width, g.view.gain);
    else {
      const a = sliceAt(g.view.start + g.fraction * width),
        b = sliceAt(g.view.start + clamp(g.fraction + dx / g.width, 0, 1) * width);
      stop();
      setRegion({ start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) });
      setHovered(null);
      setFocused(null);
    }
  }
  function finish(event: PointerEvent<SVGSVGElement>, cancelled = false) {
    if (!pointers.current.has(event.pointerId)) return;
    const g = drag.current;
    if (cancelled) {
      suppressClick.current = true;
      if (g) setRegion(g.region);
    }
    if (!cancelled && g && !g.blocked && !g.moved && g.surface === "overview") {
      const frame = overviewStart + g.fraction * overviewTotal;
      if (!visible(frame)) updateView(frame - span / 2, span);
    }
    pointers.current.delete(event.pointerId);
    if (pointers.current.size && g) g.blocked = true;
    else drag.current = null;
  }
  function hover(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType === "touch" || pointers.current.size) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const position = event.clientX - rect.left;
    if (hovered !== null) {
      const left = ((hovered - view.start) / span) * rect.width;
      const middle = event.clientY - rect.top;
      const reach = onNudge && middle >= rect.height / 2 - 14 && middle <= rect.height / 2 + 14 ? 32 : 5;
      if (position >= left - reach && position <= left + Math.max(24, reach)) return;
    }
    let closest: number | null = null,
      distance = 7;
    for (const frame of points.filter(visible)) {
      const d = Math.abs(((frame - view.start) / span) * rect.width - position);
      if (d < distance) {
        closest = frame;
        distance = d;
      }
    }
    setHovered(closest);
  }
  function select(frame: number) {
    stop();
    setRegion(null);
    onSelect(frame);
  }
  const active = region
    ? visible(region.start)
      ? region.start
      : null
    : ([hovered, focused, selectedFrame].find(
        (f) => f !== null && visible(f) && points.includes(f),
      ) ?? null);
  const deleteFrame = moving?.frame ?? [hovered, focused].find(
    frame => frame !== null && visible(frame) && markers.some(m => m.kind === "desired" && m.frame === frame),
  ) ?? null;
  const playbackEnd =
    active === null ? end : (region?.end ?? slices.find((f) => f > active) ?? end);
  async function playRange(first: number, last: number) {
    if (disabled || last <= first) return;
    stop();
    const token = ++generation.current;
    setPlaying(true);
    setError("");
    try {
      const started = await preview.current.play(audio, first / rate, last / rate, () => {
        if (token === generation.current) setPlaying(false);
      });
      if (!started && token === generation.current) setPlaying(false);
    } catch (e) {
      if (token === generation.current) {
        setPlaying(false);
        setError(e instanceof Error ? e.message : "Audio preview could not start.");
      }
    }
  }
  const play = () => active === null ? undefined : playRange(active, playbackEnd);
  useEffect(() => {
    const space = (event: globalThis.KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return;
      if (event.repeat || event.defaultPrevented || disabled || root.current?.closest('[hidden], [aria-hidden="true"]')) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], dialog, [role="dialog"]')) return;
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      void playRange(view.start, view.end);
    };
    document.addEventListener("keydown", space, true);
    return () => document.removeEventListener("keydown", space, true);
  }, [audio, view, playing, disabled]);
  function nudge(frame: number, direction: -1 | 1) {
    const next = nextZeroCrossing(audio.samples, frame, direction, start, end);
    if (next !== frame) onNudge?.(frame, next - frame);
  }
  function keys(event: KeyboardEvent<SVGSVGElement>, overview = false) {
    if (disabled) return;
    if (["+", "=", "-", "0"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "0") updateView(overviewStart, total, 1);
      else {
        const width = event.key === "-" ? span * 2 : span / 2;
        updateView(view.start + (span - clamp(width, Math.min(32, total), total)) / 2, width);
      }
    } else if (
      overview &&
      ["ArrowLeft", "ArrowRight", "Home", "End", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      event.preventDefault();
      if (event.key === "ArrowUp" || event.key === "ArrowDown")
        updateView(
          view.start,
          span,
          clamp(view.gain * (event.key === "ArrowUp" ? 2 : 0.5), 0.25, 64),
        );
      else
        updateView(
          event.key === "Home"
            ? overviewStart
            : event.key === "End"
              ? overviewEnd - span
              : view.start + (event.key === "ArrowLeft" ? -span / 4 : span / 4),
          span,
        );
    } else if (
      cursor &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
    ) {
      event.preventDefault();
      cursor.change(
        Math.round(
          clamp(
            event.key === "Home"
              ? start
              : event.key === "End"
                ? end - 1
                : cursor.frame +
                  (event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1) *
                    (event.shiftKey ? rate * 0.01 : 1),
            start,
            end - 1,
          ),
        ),
      );
    }
  }
  const peak = useMemo(() => {
    let value = 0.001;
    for (let i = overviewStart; i < overviewEnd; i++) value = Math.max(value, Math.abs(audio.samples[i]));
    return value;
  }, [audio, overviewStart, overviewEnd]);
  const overviewPath = useMemo(
    () => waveformPath(audio.samples, overviewStart, overviewEnd, peak),
    [audio, overviewStart, overviewEnd, peak],
  );
  const detailPath = useMemo(
    () => waveformPath(audio.samples, view.start, view.end, peak, view.gain),
    [audio, view, peak],
  );
  const x = (frame: number) => ((frame - view.start) / span) * 512,
    ox = (frame: number) => ((frame - overviewStart) / overviewTotal) * 512;
  const bars =
    grid && grid.bpm >= 30 && grid.bpm <= 300
      ? Array.from(
          { length: Math.max(0, Math.ceil(((onSelectBar ? audio.samples.length : end) - grid.beatOneFrame) / ((rate * 240) / grid.bpm))) },
          (_, i) => grid.beatOneFrame + (i * rate * 240) / grid.bpm,
        ).filter((f) => f >= (onSelectBar ? 0 : start))
      : [];
  const detailGrid = grid ? detailWaveformGrid(view.start, view.end, rate, grid.bpm, grid.beatOneFrame) : [];
  const barNumber = (frame: number) =>
    Math.round((frame - grid!.beatOneFrame) / ((rate * 240) / grid!.bpm)) + 1;
  const BarLabel = onSelectBar ? "button" : "span";
  const barLabel = (frame: number, position: number) => (
    <BarLabel
      type={onSelectBar ? "button" : undefined}
      disabled={onSelectBar ? disabled : undefined}
      aria-label={onSelectBar ? `Edit training bar ${barNumber(frame)}` : undefined}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); onSelectBar?.(barNumber(frame) - 1); }}
      className="waveform-bar-label"
      data-included={isBarIncluded?.(barNumber(frame) - 1) ?? false}
      aria-description={isBarIncluded?.(barNumber(frame) - 1) ? "Included in training" : "Not included in training"}
      key={frame}
      style={{
        left: `${position * 100}%`,
        transform: position > 0.9 ? "translateX(calc(-100% - 3px))" : "translateX(3px)",
      }}
    >
      {barNumber(frame)}.1.1
    </BarLabel>
  );
  const clip = useId();
  const instructions = useId();
  return (
    <div ref={root} className="waveform-display" data-preview-state={playing ? "playing" : "idle"}>
      {scope === "annotation" && <div className="waveform-display-modes" role="group" aria-label="Audio display">
        <button type="button" aria-pressed={display === "waveform"} onClick={() => setDisplay("waveform")}>Waveform</button>
        <button type="button" aria-pressed={display === "mel"} onClick={() => setDisplay("mel")}>Spectrum</button>
      </div>}
      <div className="waveform-detail" onPointerLeave={() => setHovered(null)}>
        <svg
          ref={plot}
          className="waveform-detail-plot"
          data-testid={scope === "annotation" ? "annotation-waveform" : "import-waveform"}
          viewBox="0 0 512 64"
          preserveAspectRatio="none"
          role={cursor ? "slider" : "img"}
          tabIndex={0}
          aria-describedby={instructions}
          aria-label={
            cursor
              ? "Beat one position"
              : `Training source ${display === "mel" ? "log-frequency spectrogram" : "waveform"}: green desired attacks, dashed blue calculated attacks, shaded uncertain regions`
          }
          aria-valuemin={cursor ? start / rate : undefined}
          aria-valuemax={cursor ? (end - 1) / rate : undefined}
          aria-valuenow={cursor ? cursor.frame / rate : undefined}
          aria-valuetext={cursor ? `${(cursor.frame / rate).toFixed(6)} seconds` : undefined}
          onPointerDown={(e) => begin(e, "detail")}
          onPointerEnter={hover}
          onPointerMove={(e) => {
            hover(e);
            move(e);
          }}
          onPointerUp={(e) => finish(e)}
          onPointerCancel={(e) => finish(e, true)}
          onLostPointerCapture={(e) => finish(e, true)}
          onKeyDown={(e) => keys(e)}
          onClick={(e) => {
            if (disabled || suppressClick.current) return;
            const rect = e.currentTarget.getBoundingClientRect();
            if (!rect.width) return;
            const frame = Math.round(clamp(view.start + ((e.clientX - rect.left) / rect.width) * span, view.start, view.end - 1));
            if (frame >= start && frame < end) onPlace?.(frame);
          }}
        >
          {display === "mel" && <>
            <MelSpectrogram audio={audio} start={view.start} end={view.end} />
            {onSelectBar && <rect x={x(Math.max(view.start, start))} width={Math.max(0, x(Math.min(view.end, end)) - x(Math.max(view.start, start)))} height="64" fill="#ffffff0c" pointerEvents="none" />}
            {[30, 60, 120, 240, 480, 960, 1920, 3840, 7680, 15360].filter(hz => hz <= Math.min(16000, rate / 2)).map(hz => <text key={hz} x="509" y={Math.max(5, Math.min(62, spectralFrequencyPosition(hz, rate) * 64))} textAnchor="end" fill="#fff" stroke="#101819" strokeWidth="0.5" paintOrder="stroke" fontSize="3.5" pointerEvents="none">{hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz} Hz`}</text>)}
          </>}
          {region && (
            <rect
              data-testid={
                scope === "annotation" ? "annotation-playback-selection" : "waveform-selection"
              }
              x={x(Math.max(view.start, region.start))}
              width={Math.max(
                0,
                x(Math.min(view.end, region.end)) - x(Math.max(view.start, region.start)),
              )}
              height="64"
              fill="#f4cf6838"
              pointerEvents="none"
            />
          )}
          {uncertainRegions.map((r, i) => (
            <rect
              key={i}
              x={x(Math.max(view.start, r.start))}
              width={Math.max(0, x(Math.min(view.end, r.end)) - x(Math.max(view.start, r.start)))}
              height="64"
              fill="#dca64e33"
              pointerEvents="none"
            />
          ))}
          {display === "waveform" && <path d={detailPath} className="waveform-trace" pointerEvents="none" />}
          {onSelectBar && display === "waveform" && <>
            <defs><clipPath id={`${clip}-current-detail`}><rect data-testid="current-bar-detail" x={x(Math.max(view.start, start))} width={Math.max(0, x(Math.min(view.end, end)) - x(Math.max(view.start, start)))} height="64" /></clipPath></defs>
            <path d={detailPath} className="waveform-current-bar-trace" clipPath={`url(#${clip}-current-detail)`} pointerEvents="none" />
          </>}
        {detailGrid.map(({ frame, label, bar }) => (
            <line
              key={frame}
              className={bar ? "waveform-bar-marker" : "waveform-beat-marker"}
              x1={x(frame)}
              x2={x(frame)}
              y1="0"
              y2="64"
              stroke={bar ? "#70c78a" : "#70c78a70"}
              pointerEvents="none"
            >
              <title>{label}</title>
            </line>
          ))}
          {markers
            .filter((m) => visible(m.frame))
            .map((m) => (
              <g
                key={`${m.kind}:${m.frame}`}
                data-frame={m.frame}
                data-marker-kind={m.kind}
                data-testid={
                  scope === "annotation" && m.kind === "desired"
                    ? `annotation-attack-${m.frame}`
                    : undefined
                }
                role="button"
                tabIndex={0}
                aria-label={
                  scope === "annotation" && m.kind === "desired"
                    ? `Select desired attack ${(m.frame / rate).toFixed(6)} seconds`
                    : `Select calculated attack ${(m.frame / rate).toFixed(6)} seconds`
                }
                onFocus={() => setFocused(m.frame)}
                onBlur={event => {
                  if (!(event.relatedTarget instanceof Element && event.relatedTarget.closest(".waveform-marker-play, .waveform-attack-adjust"))) setFocused(null);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!disabled && !suppressClick.current) select(m.frame);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (disabled) return;
                  if (e.key === " ") {
                    e.preventDefault();
                    if (playing) stop(); else void playRange(view.start, view.end);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    select(m.frame);
                  } else if (
                    onNudge &&
                    m.kind === "desired" &&
                    (e.key === "ArrowLeft" || e.key === "ArrowRight")
                  ) {
                    e.preventDefault();
                    nudge(m.frame, e.key === "ArrowLeft" ? -1 : 1);
                  }
                }}
              >
                <line
                  className="waveform-detection-marker"
                  x1={x(m.frame)}
                  x2={x(m.frame)}
                  y1="0"
                  y2="64"
                  stroke={
                    hovered === m.frame || focused === m.frame
                      ? "#fff1c9"
                      : selectedFrame === m.frame
                        ? "#ffe3a3"
                        : m.kind === "desired"
                          ? "#74cf9a"
                          : scope === "annotation"
                            ? "#80a8d5"
                            : "#f2a65a"
                  }
                  strokeDasharray={
                    scope === "annotation" && m.kind === "calculated" ? "2 3" : undefined
                  }
                  opacity={m.uncertain ? 0.35 : 1}
                  strokeWidth={active === m.frame ? 2 : 1}
                />
                <rect x={x(m.frame) - 6} width="12" height="64" fill="transparent" />
              </g>
            ))}
          {playhead !== null && visible(playhead) && <line data-testid="waveform-playhead" className="waveform-playhead" x1={x(playhead)} x2={x(playhead)} y1="0" y2="64" stroke="#fff1c9" strokeWidth="2" pointerEvents="none" />}
          {moving && <line x1={x(moving.next)} x2={x(moving.next)} y1="0" y2="64" stroke="#fff1c9" strokeWidth="2" pointerEvents="none" />}
          {beatOne && visible(beatOne.frame) && <g role="slider" tabIndex={0} aria-label="Beat one marker" aria-valuemin={0} aria-valuemax={(audio.samples.length - 1) / rate} aria-valuenow={beatOne.frame / rate}
            onFocus={() => setFocused(beatOne.frame)}
            onBlur={event => { if (!(event.relatedTarget instanceof Element && event.relatedTarget.closest(".waveform-marker-play"))) setFocused(null); }}
            onKeyDown={event => {
              event.stopPropagation();
              if (event.key === " " && !disabled) { event.preventDefault(); if (playing) stop(); else void playRange(view.start, view.end); return; }
              if (disabled || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
              event.preventDefault();
              const delta = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? Math.round(rate * .001) : 1);
              beatOne.change(Math.max(0, Math.min(audio.samples.length - 1, beatOne.frame + delta)));
            }}>
            <line x1={x(beatOne.frame)} x2={x(beatOne.frame)} y1="0" y2="64" stroke="#b7e3bb" strokeWidth="3" />
            <rect x={x(beatOne.frame) - 4} width="8" height="64" fill="transparent" />
          </g>}
          {cursor && (
            <line
              x1={x(cursor.frame)}
              x2={x(cursor.frame)}
              y1="0"
              y2="64"
              stroke="#b7e3bb"
              strokeWidth="2"
              pointerEvents="none"
            />
          )}
        </svg>
          {markers.filter(marker => marker.outcome && visible(marker.frame)).map(marker => <span
          key={`outcome:${marker.kind}:${marker.frame}`}
          className={`waveform-outcome-pill waveform-outcome-${marker.outcome}`}
          style={{ left: `clamp(12px, ${((marker.frame - view.start) / span) * 100}%, calc(100% - 12px))` }}
          role="img" aria-label={`${marker.outcome === "correct" ? "Correct detection" : marker.outcome === "missing" ? "Missing detection" : "Extra detection"} at ${(marker.frame / rate).toFixed(6)} seconds`}
          title={marker.outcome === "correct" ? "Correct detection" : marker.outcome === "missing" ? "Missing detection" : "Extra detection"}
        >{marker.outcome === "correct" ? "✓" : marker.outcome === "missing" ? "m" : "×"}</span>)}

        {detailGrid.map(({ frame, label, bar }) => bar
          ? barLabel(frame, (frame - view.start) / span)
          : <span key={frame} className="waveform-beat-label" style={{ left: `${((frame - view.start) / span) * 100}%` }}>{label}</span>)}
        {onNudge && deleteFrame !== null && <div className="waveform-attack-adjust" onFocus={() => setFocused(deleteFrame)} onBlur={event => { if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setFocused(null); }} style={{ left: `${((deleteFrame - view.start) / span) * 100}%` }} onPointerEnter={() => setHovered(deleteFrame)}>
          <button type="button" disabled={disabled} aria-label={`Nudge attack ${(deleteFrame / rate).toFixed(6)} seconds left to zero crossing`} onClick={() => nudge(deleteFrame, -1)}>‹</button>
          <button type="button" disabled={disabled} aria-label={`Drag attack ${(deleteFrame / rate).toFixed(6)} seconds`} className="waveform-attack-drag"
            onPointerDown={event => { if (disabled || event.button !== 0) return; event.stopPropagation(); event.currentTarget.setPointerCapture?.(event.pointerId); const next = { frame: deleteFrame, next: deleteFrame }; moveRef.current = next; setMoving(next); }}
            onPointerMove={event => { if (!moveRef.current) return; const rect = plot.current?.getBoundingClientRect(); if (!rect?.width) return; const next = { ...moveRef.current, next: Math.round(clamp(view.start + (event.clientX - rect.left) / rect.width * span, start, end - 1)) }; moveRef.current = next; setMoving(next); }}
            onPointerUp={event => { event.stopPropagation(); const next = moveRef.current; moveRef.current = null; setMoving(null); if (next && next.next !== next.frame) onNudge(next.frame, next.next - next.frame); }}
            onPointerCancel={() => { moveRef.current = null; setMoving(null); }}
            onLostPointerCapture={() => { moveRef.current = null; setMoving(null); }}
            onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); nudge(deleteFrame, event.key === "ArrowLeft" ? -1 : 1); } }}>⋮</button>
          <button type="button" disabled={disabled} aria-label={`Nudge attack ${(deleteFrame / rate).toFixed(6)} seconds right to zero crossing`} onClick={() => nudge(deleteFrame, 1)}>›</button>
        </div>}
        {onDelete && deleteFrame !== null && (
          <button
            type="button"
            className="waveform-marker-play waveform-marker-delete"
            disabled={disabled}
            style={{ left: `${((deleteFrame - view.start) / span) * 100}%` }}
            aria-label={`Delete desired attack ${(deleteFrame / rate).toFixed(6)} seconds`}
            onPointerDown={event => event.stopPropagation()}
            onPointerEnter={() => setHovered(deleteFrame)}
            onFocus={() => setFocused(deleteFrame)}
            onBlur={() => setFocused(null)}
            onClick={() => { stop(); onDelete(deleteFrame); setHovered(null); setFocused(null); }}
          >
            <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2L7 6L11 2L12 3L8 7L12 11L11 12L7 8L3 12L2 11L6 7L2 3Z" /></svg>
          </button>
        )}
        {active !== null && (
          <button
            type="button"
            className="waveform-marker-play"
            data-testid={scope === "annotation" ? "annotation-marker-play" : "import-marker-play"}
            disabled={disabled}
            style={{ left: `${((active - view.start) / span) * 100}%` }}
            aria-label={
              playing
                ? "Stop audio preview"
                : `Play from ${(active / rate).toFixed(6)} seconds to ${(playbackEnd / rate).toFixed(6)} seconds`
            }
            onPointerDown={(e) => e.stopPropagation()}
            onPointerEnter={() => setHovered(active)}
            onFocus={() => setFocused(active)}
            onBlur={() => setFocused(null)}
            onClick={() => (playing ? stop() : void play())}
          >
            <svg viewBox="0 0 14 14" aria-hidden="true">
              {playing ? <rect x="3" y="3" width="8" height="8" /> : <path d="M4 2L12 7L4 12Z" />}
            </svg>
          </button>
        )}
      </div>
      <div className="waveform-overview-container">
        <svg
          className="waveform-overview"
          viewBox="0 0 512 64"
          preserveAspectRatio="none"
          role="slider"
          tabIndex={0}
          aria-describedby={instructions}
          aria-label={
            scope === "annotation" ? "Visible annotation passage" : "Visible audio passage"
          }
          aria-valuemin={overviewStart / rate}
          aria-valuemax={(overviewEnd - span) / rate}
          aria-valuenow={view.start / rate}
          aria-valuetext={`${(view.start / rate).toFixed(4)}–${(view.end / rate).toFixed(4)} seconds`}
          onPointerDown={(e) => begin(e, "overview")}
          onPointerMove={move}
          onPointerUp={(e) => finish(e)}
          onPointerCancel={(e) => finish(e, true)}
          onLostPointerCapture={(e) => finish(e, true)}
          onKeyDown={(e) => keys(e, true)}
        >
          <defs>
            <clipPath id={clip}>
              <rect data-testid="current-bar-overview" x={ox(onSelectBar ? start : view.start)} width={((onSelectBar ? end - start : span) / overviewTotal) * 512} height="64" />
            </clipPath>
          </defs>
          {playhead !== null && <line data-testid="waveform-overview-playhead" x1={ox(playhead)} x2={ox(playhead)} y1="0" y2="64" stroke="#fff1c9" strokeWidth="2" pointerEvents="none" />}
          {beatOne && <line data-testid="annotation-beat-one-marker" x1={ox(beatOne.frame)} x2={ox(beatOne.frame)} y1="0" y2="64" stroke="#b7e3bb" strokeWidth="3" pointerEvents="none" />}
          <path d={overviewPath} className="waveform-trace" />
          {uncertainRegions.map((r, i) => (
            <rect
              key={i}
              x={ox(r.start)}
              width={((r.end - r.start) / overviewTotal) * 512}
              height="64"
              fill="#dca64e33"
              pointerEvents="none"
            />
          ))}
          {bars.map((frame) => (
            <line
              key={frame}
              x1={ox(frame)}
              x2={ox(frame)}
              y1="0"
              y2="64"
              stroke="#70c78a"
              pointerEvents="none"
            />
          ))}
          <path
            d={overviewPath}
            className={onSelectBar ? "waveform-current-bar-trace" : "waveform-overview-selected-trace"}
            clipPath={`url(#${clip})`}
          />
          <rect
            data-testid="waveform-overview-viewport"
            x={ox(view.start)}
            width={(span / overviewTotal) * 512}
            height="64"
            fill="#f4cf682e"
            stroke="#f4cf68"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {bars.map((frame) => barLabel(frame, (frame - overviewStart) / overviewTotal))}
      </div>
      <p className="waveform-view-readout">
        {(view.start / rate).toFixed(4)}–{(view.end / rate).toFixed(4)} s · waveform height{" "}
        {view.gain.toFixed(2)}×.
      </p>
      <p id={instructions} className="sr-only">
        Drag vertically on the detail waveform to zoom time. Drag horizontally to select audio. Drag
        the overview to navigate, or vertically to change waveform height. Keyboard: plus and minus
        zoom time; zero resets the view. Overview left and right navigate; up and down change
        waveform height; Home and End go to the edges. Escape stops playback.
      </p>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </div>
  );
}
