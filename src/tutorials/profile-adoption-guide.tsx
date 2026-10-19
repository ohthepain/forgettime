/** Dev-only guide over the real app. Observes user actions; never performs them. */
import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import "./annotation-tutorial.css";

type Outcome = "observed" | "user-confirmed" | "failed" | "skipped" | "unverified";
type Step = {
  id: string;
  title: string;
  action: string;
  expected: string;
  target: string;
  ready?: () => boolean;
  entry?: boolean;
  details?: string;
  missing?: string;
};
function visible(element: Element) {
  const b = element.getBoundingClientRect();
  return b.width > 0 && b.height > 0 && !element.closest("[hidden]");
}
function identified(id: string): HTMLElement | null {
  const matches = [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)].filter(
    visible,
  );
  return matches.length === 1 ? matches[0] : null;
}
function text(value: string) {
  return value
    .split(/(`[^`]+`)/)
    .map((part, i) => (part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part));
}
function Guide() {
  const steps: Step[] = [
    { id: "training", title: "Open Training", action: "Choose `Training`.", expected: "The Data page opens.", target: "training-nav", ready: () => !!identified("training-page") },
    { id: "optimization", title: "Open Optimization", action: "Choose `Optimization`.", expected: "Your optimizer controls and saved runs are available.", target: "training-optimization-tab", ready: () => !!identified("parameter-optimizer") },
    { id: "runs", title: "Find your run", action: "Open `Saved runs`.", expected: "Your saved optimization runs are listed.", target: "optimizer-saved-runs-toggle", ready: () => !!identified("optimizer-saved-runs")?.hasAttribute("open"), missing: "No saved runs? Finish an optimization run first." },
    { id: "select", title: "Select a completed run", action: "Choose the completed run you want to use.", expected: "Its baseline, best score and parameters appear.", target: "optimizer-run-list", ready: () => identified("parameter-optimizer")?.dataset.runStatus === "completed" },
    { id: "review", title: "Review the result", action: "Compare the baseline and best candidate, then confirm below.", expected: "You understand the score and evidence for this profile.", target: "optimizer-results", details: "These are optimized detector parameters. Training-only scores are preliminary; withheld-recording results are stronger evidence. Outdated runs must be evaluated against the current dataset before use." },
    { id: "freeze", title: "Freeze the candidate", action: "Choose `Freeze best candidate`.", expected: "The best candidate is locked for evaluation.", target: "optimizer-freeze-candidate", ready: () => identified("parameter-optimizer")?.dataset.frozen === "true", details: "This saves the selected candidate in the run record; it does not apply the detector profile yet." },
    { id: "evaluate", title: "Evaluate withheld recordings", action: "Choose `Evaluate frozen candidate on withheld recordings`.", expected: "The frozen candidate's withheld result appears.", target: "optimizer-evaluate-withheld", ready: () => identified("parameter-optimizer")?.dataset.withheld === "true", details: "This starts one explicit evaluation, not another parameter search. If no eligible withheld audio exists, the result can be unavailable. Skip if you intend to proceed with training-only evidence." },
    { id: "apply", title: "Use the evaluated profile", action: "Choose `Use evaluated profile`.", expected: "The app confirms profile selection.", target: "optimizer-use-profile", ready: () => !!identified("parameter-optimizer")?.dataset.profileSelected, details: "If disabled, the run may be incomplete, outdated, or lack eligible scoring coverage. Both profiles apply to dataset comparisons and your next microphone session. Current-detector profiles also apply to Practice review." },
    { id: "data", title: "Open Data", action: "Choose `Data`.", expected: "Your training files are listed.", target: "training-dataset-tab", ready: () => !!identified("training-files-list") },
    { id: "file", title: "Open a training file", action: "Choose an included sample.", expected: "Desired and calculated attacks appear.", target: "training-files-list", ready: () => !!identified("training-comparison") },
    { id: "profile", title: "Compare with your profile", action: "Choose `Selected optimized profile` in `Comparison profile`.", expected: "Calculated hits are recomputed with your profile.", target: "training-comparison-profile", ready: () => (identified("training-comparison-profile") as HTMLSelectElement | null)?.value === "Selected optimized profile" && identified("training-comparison")?.dataset.state === "ready" },
    { id: "inspect", title: "Inspect the detections", action: "Audition the waveform and compare calculated hits with desired hits. Confirm below when finished.", expected: "You can judge missing and extra hits on this sample.", target: "training-comparison", details: "This applies the profile to saved audio comparisons. It does not deploy a trained model to the microphone. Restarting this guide preserves your selected profile and real app data." },
  ];
  const [index, setIndex] = useState(-1),
    [open, setOpen] = useState(true);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [missing, setMissing] = useState(false),
    [already, setAlready] = useState(false);
  const [highlight, setHighlight] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [position, setPosition] = useState({ x: Math.max(12, innerWidth - 344), y: 16 });
  const [report, setReport] = useState("");
  const panel = useRef<HTMLElement>(null),
    moved = useRef(false);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const step = steps[index],
    summary = index === steps.length;
  useEffect(() => {
    if (index >= 0 && index < steps.length) return;
    setPosition(old => ({ ...old, y: 16 }));
  }, [index, open]);
  function target() {
    return step ? identified(step.target) : null;
  }
  function verdict(outcome: Outcome, advance = true) {
    if (!step) return;
    setOutcomes((old) => ({ ...old, [step.id]: outcome }));
    if (advance) setIndex((n) => Math.min(steps.length, n + 1));
  }
  useEffect(() => {
    if (!open || !step) {
      setHighlight(null);
      return;
    }
    let alive = true,
      armed = false,
      committed = false,
      composing = false;
    let frame = 0,
      measured = false;
    setAlready(step.ready?.() ?? false);
    function measure() {
      if (!alive) return;
      const el = target(),
        b = el?.getBoundingClientRect();
      setMissing(!el || !b);
      if (!b) {
        setHighlight(null);
        return;
      }
      setHighlight({ x: b.left - 4, y: b.top - 4, width: b.width + 8, height: b.height + 8 });
      if (!measured) {
        measured = true;
        const p = panel.current?.getBoundingClientRect(),
          width = Math.min(320, innerWidth - 24);
        // Reserve the target's entire workspace, including marker hover/play controls.
        const area = el?.closest(".waveform-display")?.getBoundingClientRect() ?? b;
        if (
          !moved.current &&
          p &&
          area.left < p.right + 24 &&
          area.right > p.left - 24 &&
          area.top < p.bottom + 64 &&
          area.bottom > p.top - 64
        ) {
          setPosition({
            x: area.left > width + 36 ? 12 : Math.max(12, innerWidth - width - 12),
            y: Math.max(12, innerHeight - Math.min(p.height, innerHeight * 0.5) - 12),
          });
        }
        // Only one scroll per step; hover/focus never relocates the panel.
        if (
          area.top < 70 ||
          area.bottom > innerHeight - 80 ||
          (p &&
            area.left < p.right &&
            area.right > p.left &&
            area.top < p.bottom &&
            area.bottom > p.top)
        )
          window.scrollBy({ top: area.top - 80, behavior: "smooth" });
      }
    }
    function check() {
      if (!alive) return;
      if (armed && step.ready?.() && (!step.entry || committed)) {
        alive = false;
        setOutcomes((old) => ({ ...old, [step.id]: "observed" }));
        setIndex((n) => Math.min(steps.length, n + 1));
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }
    function interaction(event: Event) {
      if (!event.isTrusted || panel.current?.contains(event.target as Node)) return;
      const el = target();
      if (!el || !(event.target instanceof Node) || !el.contains(event.target)) return;
      if (event.type === "compositionstart") {
        composing = true;
        return;
      }
      if (event.type === "compositionend") {
        composing = false;
        return;
      }
      if (composing || (event as InputEvent).isComposing) return;
      if (step.entry) {
        if (event.type === "input") {
          committed = false;
          armed = false;
          return;
        }
        if (
          event.type !== "focusout" &&
          !(event.type === "keydown" && (event as KeyboardEvent).key === "Enter")
        )
          return;
        committed = step.ready?.() ?? false;
        armed = committed;
      } else if (
        event.type === "click" ||
        (event.type === "keydown" && ["Enter", " "].includes((event as KeyboardEvent).key))
      )
        armed = true;
      queueMicrotask(check);
    }
    const events = ["click", "keydown", "input", "focusout", "compositionstart", "compositionend"];
    for (const event of events) document.addEventListener(event, interaction, true);
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    resizeObserver.observe(document.body);
    const onResize = () => {
      const p = panel.current?.getBoundingClientRect();
      setPosition((old) => ({
        x: Math.max(8, Math.min(innerWidth - (p?.width ?? 320) - 8, old.x)),
        y: Math.max(8, Math.min(innerHeight - (p?.height ?? 300) - 8, old.y)),
      }));
      measure();
    };
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", onResize);
    measure();
    return () => {
      alive = false;
      observer.disconnect();
      resizeObserver.disconnect();
      cancelAnimationFrame(frame);
      for (const event of events) document.removeEventListener(event, interaction, true);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", onResize);
    };
  }, [index, open]);
  function restart() {
    setPosition({ x: Math.max(12, innerWidth - 344), y: 16 });
    setIndex(-1);
    setOutcomes({});
    setReport("");
    setHighlight(null);
    moved.current = false;
  }
  function reportText() {
    return JSON.stringify(
      {
        tutorial: "Apply an optimized detector profile",
      question: "Can I select an evaluated optimizer profile and compare its detections on saved audio?",
        scope: "Real local Forgettime app; existing saved optimizer runs and training data",
        steps: steps.map((s) => ({
          id: s.id,
          title: s.title,
          expected: s.expected,
          outcome: outcomes[s.id] ?? "unverified",
        })),
        limitations: [
          "The user selects and applies the profile; the guide never adopts it automatically.",
          "Restart preserves all real imports, saved examples and preferences.",
          "No acoustic accuracy or physical-device validation is implied.",
        ],
      },
      null,
      2,
    );
  }
  if (!open)
    return (
      <button className="tutorial-reopen" onClick={() => setOpen(true)}>
        Reopen profile guide
      </button>
    );
  return (
    <>
      {highlight && (
        <>
          <div
            className="tutorial-highlight"
            style={{
              left: highlight.x,
              top: highlight.y,
              width: highlight.width,
              height: highlight.height,
            }}
          />
          <svg
            className="tutorial-arrow"
            viewBox="0 0 48 56"
            aria-hidden="true"
            style={{
              left: Math.max(4, Math.min(innerWidth - 52, highlight.x + highlight.width / 2 - 24)),
              top: highlight.y >= 64 ? highlight.y - 60 : highlight.y + highlight.height + 8,
              rotate: highlight.y >= 64 ? undefined : "180deg",
            }}
          >
            <path
              d="M15 3 H33 V28 H44 L24 51 L4 28 H15 Z"
              fill="#ffbf38"
              stroke="#f95a9b"
              strokeWidth="4"
              strokeLinejoin="round"
            />
          </svg>
        </>
      )}
      <aside
        ref={panel}
        className="tutorial-panel splice-guide"
        aria-label="Profile adoption walkthrough"
        style={{
          left: position.x,
          top: position.y,
          width: Math.min(320, innerWidth - 24),
          maxHeight: `min(${innerWidth < 600 ? "48dvh" : "100dvh"}, calc(100dvh - ${position.y + 12}px))`,
          bottom: "auto",
        }}
      >
        <div
          className="tutorial-controls tutorial-drag-handle"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest("button") || event.button !== 0) return;
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
            moved.current = true;
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
            {index < 0
              ? "Tutorial"
              : summary
                ? "Walkthrough report"
                : `Step ${index + 1} / ${steps.length}`}
          </strong>
          <button aria-label="Close guide" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>
        {index >= 0 && <progress aria-label="Verified walkthrough progress" max={steps.length} value={Object.values(outcomes).filter(value => value === "observed" || value === "user-confirmed").length} />}
        {index < 0 ? (
          <>
            <h2>Tutorial: Use an optimized profile</h2>
            <p>Steps:</p>
            <ul>
              {steps.map((s) => (
                <li key={s.id}>{s.title}</li>
              ))}
            </ul>
            <details>
              <summary>Notes:</summary>
              <p>
                Requires a completed optimizer run for the current dataset. Freezing and evaluation update its real run record. Profile selection is a real app change. The selected profile applies when you next start the microphone. Restart preserves all app data.
              </p>
            </details>
            <div className="tutorial-controls">
              <button onClick={() => setIndex(0)}>Go</button>
              <button onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </>
        ) : summary ? (
          <>
            <h2>Your walkthrough results</h2>
            <ul>
              {steps.map((s) => (
                <li key={s.id}>
                  {s.title}: <strong>{outcomes[s.id] ?? "unverified"}</strong>
                </li>
              ))}
            </ul>
            <button
              onClick={async () => {
                const value = reportText();
                setReport(value);
                try {
                  await navigator.clipboard.writeText(value);
                } catch {
                  /* Selectable fallback below. */
                }
              }}
            >
              Copy report
            </button>
            {report && (
              <label>
                Selectable report
                <textarea
                  readOnly
                  value={report}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
            )}
          </>
        ) : (
          <>
            <h2 aria-live="polite">{step.title}</h2>
            <p>{text(step.action)}</p>
            <p>
              <strong>Expected:</strong> {step.expected}
            </p>
            {step.details && (
              <details>
                <summary>Tips</summary>
                <p>{text(step.details)}</p>
              </details>
            )}
            {already && <p>This result is already present. Repeat the action or confirm below.</p>}
            {missing && (
              <p role="status">
                {step.missing || "Return to the matching app screen, or use Back or Next."}
              </p>
            )}
            <details>
              <summary>Step result</summary>
              <p>{outcomes[step.id] ?? "unverified"}</p>
            </details>
            <div className="tutorial-controls">
              <button
                onClick={() => {
                  const el = target();
                  el?.scrollIntoView({ block: "center", behavior: "smooth" });
                  el?.focus({ preventScroll: true });
                }}
              >
                Show target
              </button>
              <button onClick={() => verdict("user-confirmed")}>Confirm & continue</button>
              <button onClick={() => verdict("failed", false)}>Not working</button>
            </div>
          </>
        )}
        {index >= 0 && (
          <div className="tutorial-controls">
            <button disabled={index === 0} onClick={() => setIndex((n) => Math.max(0, n - 1))}>
              Back
            </button>
            <button
              disabled={summary}
              onClick={() => setIndex((n) => Math.min(steps.length, n + 1))}
            >
              Next
            </button>
            <button disabled={summary} onClick={() => verdict("skipped")}>
              Skip
            </button>
            <button onClick={restart}>Restart</button>
          </div>
        )}
      </aside>
    </>
  );
}
if (import.meta.env.DEV && !document.getElementById("profile-adoption-guide")) {
  const host = document.createElement("div");
  host.id = "profile-adoption-guide";
  document.body.append(host);
  const root = createRoot(host);
  root.render(<Guide />);
  import.meta.hot?.dispose(() => {
    root.unmount();
    host.remove();
  });
}
