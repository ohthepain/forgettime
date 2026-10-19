/** Removable, explicitly enabled dev recorder. No browser storage or file writes. */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReproJournal, safeName, safePath, safeValue, targetIdentity } from "./repro-journal";
const ignored = (event: Event) =>
  event
    .composedPath()
    .some(
      (node) =>
        node instanceof Element &&
        !!node.closest(
          "#dev-repro-steps,#splice-training-guide,#dev-edit-mode,.tutorial-panel,.tutorial-reopen",
        ),
    );
const waveform = (element: Element) =>
  element.closest(".waveform-detail,.waveform-overview,.waveform-plot,.waveform-marker-play");
const namedControl = (element: Element) =>
  element.closest<HTMLElement>(
    'button,a,input,select,textarea,[role="button"],[role="tab"],[role="slider"],summary',
  );
const setup = () => [
  document.querySelector('[data-testid="training-page"]:not([hidden])')?.getBoundingClientRect()
    .height
    ? "Training page visible."
    : "Practice or another app page visible.",
  [...document.querySelectorAll('[data-testid="import-audio-setup"]')].some(
    (el) => el.getBoundingClientRect().height,
  )
    ? "Import setup visible at recording start."
    : "No visible import setup at recording start.",
  [...document.querySelectorAll('[data-testid="training-annotation-editor"]')].some(
    (el) => el.getBoundingClientRect().height,
  )
    ? "Annotation editor visible at recording start."
    : "No visible annotation editor at recording start.",
];
function Recorder() {
  const journal = useRef(new ReproJournal());
  const [generation, setGeneration] = useState(0);
  const [recording, setRecording] = useState(false),
    [finished, setFinished] = useState(false),
    [count, setCount] = useState(0);
  const [expected, setExpected] = useState(
    "The training waveform remains visible after importing audio.",
  );
  const [actual, setActual] = useState("The training waveform disappears after import.");
  const [notes, setNotes] = useState(""),
    [copyStatus, setCopyStatus] = useState("");
  const [position, setPosition] = useState({ x: 12, y: Math.max(12, innerHeight - 150) });
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const stopCapture = useRef<() => void>(() => {});
  function start() {
    stopCapture.current();
    journal.current.reset(location.pathname, setup());
    setCount(0);
    setFinished(false);
    setCopyStatus("");
    setNotes("");
    setGeneration((n) => n + 1);
    setRecording(true);
  }
  useEffect(() => {
    if (!recording) return;
    let alive = true,
      path = safePath(),
      lastSubmit: { target: Element; time: number } | null = null;
    let pending: {
      element: HTMLInputElement | HTMLTextAreaElement;
      name: string;
      value: string;
      target: string;
      path: string;
    } | null = null;
    let pointer: { area: Element; x: number; y: number; path: string } | null = null;
    let lastDrag: { area: Element; time: number } | null = null,
      lastHover: Element | null = null;
    let scrollTimer: ReturnType<typeof setTimeout> | undefined,
      scrollArmed = 0;
    let scrollStart: { element: Element | null; x: number; y: number; path: string } | null = null;
    function add(action: string, target?: string, at = safePath()) {
      if (!alive) return;
      journal.current.add(action, at, target);
      setCount(journal.current.entries.length);
    }
    function flush() {
      if (!pending) return;
      const edit = pending;
      pending = null;
      const value = edit.element.isConnected ? safeValue(edit.element) : edit.value;
      add(`Edit “${edit.name}” to ${value}`, edit.target, edit.path);
    }
    function route() {
      const next = safePath();
      if (next === path) return;
      flush();
      add(`Navigate from ${path} to ${next}`, undefined, next);
      path = next;
    }
    function changes(event: Event) {
      if (!event.isTrusted || ignored(event)) return;
      const element = event.target;
      if (
        !(
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        )
      )
        return;
      if (
        element instanceof HTMLSelectElement ||
        (element instanceof HTMLInputElement &&
          ["checkbox", "radio", "file"].includes(element.type))
      ) {
        if (event.type !== "change") return;
        flush();
        finishScroll();
        if (!(element instanceof HTMLInputElement && element.type === "radio" && !element.checked))
          add(`Set “${safeName(element)}” to ${safeValue(element)}`, targetIdentity(element));
        return;
      }
      if (pending && pending.element !== element) flush();
      pending = {
        element,
        name: safeName(element),
        value: safeValue(element),
        target: targetIdentity(element),
        path: safePath(),
      };
      if (event.type === "change") queueMicrotask(flush);
    }
    function click(event: MouseEvent) {
      if (!event.isTrusted || ignored(event) || !(event.target instanceof Element)) return;
      flush();
      finishScroll();
      const area = waveform(event.target);
      if (lastDrag && area === lastDrag.area && performance.now() - lastDrag.time < 300) return;
      const element = namedControl(event.target);
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
      )
        return;
      if (element) {
        add(`Choose “${safeName(element)}”`, targetIdentity(element));
        lastSubmit = { target: element, time: performance.now() };
      } else if (area) {
        const b = area.getBoundingClientRect();
        add(
          `Click “${safeName(area)}” at ${Math.round(((event.clientX - b.left) / Math.max(1, b.width)) * 100)}% across, ${Math.round(((event.clientY - b.top) / Math.max(1, b.height)) * 100)}% down`,
          targetIdentity(area),
        );
      }
      queueMicrotask(route);
    }
    function submit(event: SubmitEvent) {
      if (!event.isTrusted || ignored(event)) return;
      flush();
      if (
        lastSubmit &&
        lastSubmit.target === event.submitter &&
        performance.now() - lastSubmit.time < 300
      )
        return;
      const element = event.submitter ?? event.target;
      if (element instanceof Element)
        add(`Submit using “${safeName(element)}”`, targetIdentity(element));
    }
    function blur(event: FocusEvent) {
      if (event.isTrusted && !ignored(event)) queueMicrotask(flush);
    }
    function key(event: KeyboardEvent) {
      if (!event.isTrusted || ignored(event)) return;
      if (event.key === "Enter") queueMicrotask(flush);
      if (["PageDown", "PageUp", "Home", "End", " "].includes(event.key))
        scrollArmed = performance.now();
      const area = event.target instanceof Element ? waveform(event.target) : null;
      if (
        area &&
        !(event.target instanceof HTMLInputElement) &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-", "0", "Escape", " "].includes(
          event.key,
        )
      ) {
        flush();
        add(
          `Press ${event.shiftKey ? "Shift+" : ""}${event.key === " " ? "Space" : event.key} on “${safeName(area)}”`,
          targetIdentity(area),
        );
      } else if (event.key === "Escape") {
        flush();
        add("Press Escape");
      }
    }
    function down(event: PointerEvent) {
      if (!event.isTrusted || ignored(event) || !(event.target instanceof Element)) return;
      const area = waveform(event.target);
      if (area) {
        flush();
        finishScroll();
        pointer = { area, x: event.clientX, y: event.clientY, path: safePath() };
      }
    }
    function up(event: PointerEvent) {
      if (!pointer || !event.isTrusted || ignored(event)) {
        pointer = null;
        return;
      }
      const p = pointer;
      pointer = null;
      if (Math.hypot(event.clientX - p.x, event.clientY - p.y) < 8) return;
      const b = p.area.getBoundingClientRect(),
        point = (x: number, y: number) =>
          `${Math.round(((x - b.left) / Math.max(1, b.width)) * 100)}% across/${Math.round(((y - b.top) / Math.max(1, b.height)) * 100)}% down`;
      add(
        `Drag “${safeName(p.area)}” from ${point(p.x, p.y)} to ${point(event.clientX, event.clientY)}`,
        targetIdentity(p.area),
        p.path,
      );
      lastDrag = { area: p.area, time: performance.now() };
    }
    function hover(event: PointerEvent) {
      if (!event.isTrusted || ignored(event) || !(event.target instanceof Element)) return;
      const element = event.target.closest('[role="button"],.waveform-marker-play');
      if (!element || !waveform(element) || lastHover === element) return;
      flush();
      add(`Hover “${safeName(element)}”`, targetIdentity(element));
      lastHover = element;
    }
    function cancelPointer() {
      pointer = null;
    }
    function out(event: PointerEvent) {
      if (
        lastHover &&
        (!(event.relatedTarget instanceof Node) || !lastHover.contains(event.relatedTarget))
      )
        lastHover = null;
    }
    function wheel(event: WheelEvent) {
      if (event.isTrusted && !ignored(event)) {
        scrollArmed = performance.now();
        if (!scrollStart) {
          const el =
            event.target instanceof Element ? event.target.closest(".training-example-list") : null;
          scrollStart = {
            element: el,
            x: el?.scrollLeft ?? scrollX,
            y: el?.scrollTop ?? scrollY,
            path: safePath(),
          };
        }
      }
    }
    function finishScroll() {
      if (!scrollStart) return;
      const s = scrollStart;
      scrollStart = null;
      const x = s.element?.scrollLeft ?? scrollX,
        y = s.element?.scrollTop ?? scrollY;
      if (Math.hypot(x - s.x, y - s.y) > 50)
        add(
          `Scroll ${s.element ? "recording list" : "page"} from (${Math.round(s.x)}, ${Math.round(s.y)}) to (${Math.round(x)}, ${Math.round(y)})`,
          undefined,
          s.path,
        );
    }
    function scroll(event: Event) {
      if (ignored(event) || performance.now() - scrollArmed > 1200) return;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(finishScroll, 250);
    }
    document.addEventListener("input", changes, true);
    document.addEventListener("change", changes, true);
    document.addEventListener("click", click, true);
    document.addEventListener("submit", submit, true);
    document.addEventListener("focusout", blur, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", cancelPointer, true);
    document.addEventListener("pointerover", hover, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("wheel", wheel, { passive: true, capture: true });
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("popstate", route);
    window.addEventListener("forgettime-route-changed", route);
    function dispose() {
      if (!alive) return;
      flush();
      finishScroll();
      route();
      alive = false;
      clearTimeout(scrollTimer);
      document.removeEventListener("input", changes, true);
      document.removeEventListener("change", changes, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("submit", submit, true);
      document.removeEventListener("focusout", blur, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", cancelPointer, true);
      document.removeEventListener("pointerover", hover, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("wheel", wheel, true);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("popstate", route);
      window.removeEventListener("forgettime-route-changed", route);
    }
    stopCapture.current = dispose;
    return dispose;
  }, [recording, generation]);
  useEffect(() => {
    const resize = () => {
      const b = panel.current?.getBoundingClientRect();
      setPosition((old) => ({
        x: Math.max(8, Math.min(innerWidth - (b?.width ?? 390) - 8, old.x)),
        y: Math.max(8, Math.min(innerHeight - (b?.height ?? 140) - 8, old.y)),
      }));
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const report = journal.current.report(expected, actual, notes);
  return (
    <aside
      ref={panel}
      aria-label="Repro steps recorder"
      className="recorder"
      style={{
        left: position.x,
        top: position.y,
        maxHeight: `calc(100dvh - ${position.y + 12}px)`,
      }}
    >
      <header
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          const b = panel.current!.getBoundingClientRect();
          drag.current = {
            id: event.pointerId,
            dx: event.clientX - b.left,
            dy: event.clientY - b.top,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          if (!d || d.id !== event.pointerId) return;
          const b = panel.current!.getBoundingClientRect();
          setPosition({
            x: Math.max(8, Math.min(innerWidth - b.width - 8, event.clientX - d.dx)),
            y: Math.max(8, Math.min(innerHeight - b.height - 8, event.clientY - d.dy)),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <strong>
          ↕ Repro {recording ? `● Recording · ${count} actions` : finished ? "· Report" : ""}
        </strong>
      </header>
      <div className="buttons">
        <button disabled={recording} onClick={start}>
          Start recording
        </button>
        <button disabled={!recording && !finished} onClick={start}>
          Restart
        </button>
        <button
          disabled={!recording}
          onClick={() => {
            stopCapture.current();
            setRecording(false);
            setFinished(true);
            setPosition({ x: 12, y: 12 });
          }}
        >
          Bug reproduced
        </button>
      </div>
      <small>Memory only. Reload clears steps. Start/Restart clears the previous collection.</small>
      {finished && (
        <>
          <label>
            Expected behavior
            <textarea
              value={expected}
              onChange={(event) => {
                setExpected(event.target.value);
                setCopyStatus("");
              }}
            />
          </label>
          <label>
            Actual behavior
            <textarea
              value={actual}
              onChange={(event) => {
                setActual(event.target.value);
                setCopyStatus("");
              }}
            />
          </label>
          <label>
            Notes / missing setup
            <textarea
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
                setCopyStatus("");
              }}
            />
          </label>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(report);
                setCopyStatus("Copied");
              } catch {
                setCopyStatus("Copy unavailable. Select and copy the report below.");
              }
            }}
          >
            Copy repro steps
          </button>
          <p role="status">{copyStatus}</p>
          <label>
            Selectable repro report
            <textarea
              className="report"
              readOnly
              value={report}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
        </>
      )}
    </aside>
  );
}
if (import.meta.env.DEV && !document.getElementById("dev-repro-steps")) {
  const host = document.createElement("div");
  host.id = "dev-repro-steps";
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" }),
    style = document.createElement("style");
  style.textContent =
    ":host{position:fixed;inset:0;pointer-events:none;z-index:2147483647;color:#edf4f5;font:13px system-ui}.recorder{position:fixed;pointer-events:auto;width:min(390px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;background:#242131;border:1px solid #d98fb8;border-radius:10px;padding:12px;box-shadow:0 6px 24px #0008;box-sizing:border-box}header{cursor:move;touch-action:none;padding-bottom:8px;color:#f5c1df}.buttons{display:flex;gap:5px;flex-wrap:wrap}button{font:inherit;padding:7px;border-radius:6px;border:1px solid #976b89;color:#fff;background:#47334a;cursor:pointer}button:disabled{opacity:.45;cursor:default}button:focus-visible,textarea:focus-visible{outline:3px solid #ffcb72}small{display:block;font-size:11px;margin-top:7px;color:#c6b9c5}label{display:block;margin:10px 0}textarea{box-sizing:border-box;width:100%;min-height:64px;background:#15131c;color:#edf4f5;border:1px solid #9b829b;border-radius:5px;padding:7px;font:inherit}.report{min-height:180px;font:11px monospace}";
  const mount = document.createElement("div");
  shadow.append(style, mount);
  const root = createRoot(mount);
  root.render(<Recorder />);
  import.meta.hot?.dispose(() => {
    root.unmount();
    host.remove();
  });
}
