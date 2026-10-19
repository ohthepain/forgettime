import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { PracticeScreen } from "../components/PracticeScreen";
import { TrainingAnnotationEditor } from "../components/TrainingAnnotationEditor";
import { type createTrainingRepository, type TrainingSnapshot } from "../audio/training-dataset";
import { createTrainingSource, trainingExampleId } from "../audio/training-contract";
import { DEFAULT_DETECTOR_SETTINGS } from "../audio/detector-contract";
import type { RecordedTake } from "../audio/recorded-take";
import "../styles.css";
import "./annotation-tutorial.css";

const rate = 48000;
async function fixture() {
  const samples = new Float32Array(rate * 4);
  for (const time of [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75])
    for (let i = 0; i < 2400; i++)
      samples[Math.round(time * rate) + i] =
        0.5 * Math.sin((i * 2 * Math.PI * 1400) / rate) * Math.exp(-i / 300);
  const { source } = await createTrainingSource([samples], rate, {
    kind: "import",
    name: "Synthetic tutorial drum loop",
    beginningAvailable: true,
    endAvailable: true,
  });
  const bar = { startFrame: 0, endFrame: rate * 2 };
  let current: TrainingSnapshot | null = {
    token: crypto.randomUUID(),
    dataset: {
      manifest: {
        format: "forgettime-training",
        schemaVersion: 1,
        sources: [source],
        groups: [
          { id: "tutorial-only", sourceChecksums: [source.checksum], assignment: "unassigned" },
        ],
        examples: [
          {
            id: trainingExampleId(source.checksum, bar),
            sourceChecksum: source.checksum,
            bar,
            reference: { bpm: 120, beatOneFrame: 0, meter: [4, 4] },
            desiredFrames: [0.25, 0.75, 1, 1.75].map((t) => t * rate),
            uncertain: [],
            reviewed: true,
          },
        ],
      },
      audio: { [source.checksum]: samples },
    },
  };
  const listeners = new Set<() => void>();
  const worker = new Worker(new URL("./annotation-tutorial.worker.ts", import.meta.url), {
    type: "module",
  });
  let sequence = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  worker.onmessage = (event) => {
    const { id, error, result, manifest } = event.data;
    if (manifest) {
      current!.dataset.manifest = manifest;
      for (const listener of listeners) listener();
    }
    const call = pending.get(id);
    pending.delete(id);
    if (error) call?.reject(new Error(error));
    else call?.resolve(result);
  };
  const request = (method: string, args: unknown[]) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, method, args });
    });
  const repository = new Proxy(
    {},
    {
      get:
        (_target, key) =>
        (...args: unknown[]) =>
          request(String(key), args),
    },
  ) as ReturnType<typeof createTrainingRepository>;
  await request("init", [current]);
  const take: RecordedTake = {
    audio: { samples, sampleRate: rate, startFrame: 0 },
    source: "imported",
    continuity: 0,
    origin: 0,
    settings: { bpm: 120, mode: "straight", startSensitivity: 50 },
    onsets: [],
    results: [],
    endReason: "stopped",
  };
  return {
    repository,
    take,
    dispose: () => {
      worker.terminate();
      for (const call of pending.values()) call.reject(new Error("Tutorial restarted"));
      pending.clear();
    },
    peek: () => current!.dataset,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Outcome = "observed" | "user-confirmed" | "failed" | "skipped" | "unverified";
const button = (root: HTMLElement, text: string) =>
  Array.from(root.querySelectorAll<HTMLElement>("button")).find(
    (e) => e.textContent?.trim() === text || e.textContent?.trim().startsWith(text + " ·"),
  ) ?? null;
const field = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll("label"))
    .find((e) => e.textContent?.trim().startsWith(label))
    ?.querySelector<HTMLElement>("input") ?? null;
// A missing or duplicate identity is unavailable, never an arbitrary first match.
const control = (root: HTMLElement, id: string) => {
  const matches = root.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`);
  return matches.length === 1 ? matches[0] : null;
};
const labels = (root: HTMLElement) =>
  Array.from(root.querySelectorAll(".training-attacks button")).map((e) =>
    e.textContent?.trim().replace(" · uncertain", ""),
  );
const ready = (root: HTMLElement) => Boolean(root.querySelector(".training-editor input"));
const newExample = (f: Fixture) => f.peek().manifest.examples.find((e) => e.bar.endFrame === rate);
interface Step {
  id: string;
  title: string;
  action: string;
  expected: string;
  target?: (root: HTMLElement) => HTMLElement | null;
  check?: (root: HTMLElement, f: Fixture) => boolean;
  entry?: boolean;
  interaction?: (event: Event, root: HTMLElement) => boolean;
}
const annotationSteps: Step[] = [
  {
    id: "intro",
    title: "Correct a Recorded bar",
    action:
      "Correct a missing attack at 1.25 s and an extra attack at 1.00 s using temporary sample data. Choose Confirm & continue.",
    expected: "Your recordings, saved bars and real training set remain untouched.",
  },
  {
    id: "open",
    title: "Open the editor",
    action:
      "Choose Open annotation editor. Green markers are desired attacks; dashed blue markers are actual calculated detections.",
    expected: "Correct attacks opens with the deliberately flawed tutorial labels.",
    target: (r) => button(r, "Open annotation editor"),
    check: (r) => ready(r) && labels(r).includes("1.000000 s"),
  },
  {
    id: "select-extra",
    title: "Inspect the extra attack",
    action:
      "Select 1.000000 s in the desired-attack list. Use the marker’s play button to listen.",
    expected:
      "The precise source-seconds field shows 1.0 and Remove desired attack becomes available.",
    target: (r) => button(r, "1.000000 s"),
    check: (r) =>
      Boolean(button(r, "Remove desired attack")) &&
      (field(r, "Desired attack source seconds") as HTMLInputElement)?.value === "1",
  },
  {
    id: "remove-extra",
    title: "Remove the undesired hit",
    action: "Choose Remove desired attack.",
    expected:
      "The desired marker at 1.00 s disappears. Calculated detections and original audio are unchanged.",
    target: (r) => button(r, "Remove desired attack"),
    check: (r) =>
      Boolean(r.querySelector(".training-attacks")) && !labels(r).includes("1.000000 s"),
  },
  {
    id: "add-missing",
    title: "Add the missing attack",
    action:
      "Enter 1.25 in Desired attack source seconds, then press Tab or Enter. The explicit Add missing attacks mode also permits waveform taps.",
    expected: "A desired marker appears at exactly 1.250000 source seconds.",
    target: (r) => field(r, "Desired attack source seconds"),
    check: (r) => labels(r).includes("1.250000 s"),
  },
  {
    id: "undo",
    title: "Try Undo",
    action: "Choose Undo once.",
    expected:
      "The just-added 1.25 s marker disappears. The earlier removal of the extra attack remains in place.",
    target: (r) => button(r, "Undo"),
    check: (r) =>
      Boolean(r.querySelector(".training-attacks")) && !labels(r).includes("1.250000 s"),
  },
  {
    id: "readd",
    title: "Restore the desired attack",
    action: "Enter 1.25 in the source-seconds field and press Tab or Enter again.",
    expected: "The four desired source times are now 0.25, 0.75, 1.25 and 1.75 seconds.",
    target: (r) => field(r, "Desired attack source seconds"),
    check: (r) => labels(r).includes("1.250000 s") && !labels(r).includes("1.000000 s"),
  },
  {
    id: "tempo",
    title: "Change the training tempo",
    action:
      "Set Training tempo to 240, then Tab or Enter. This changes the training interpretation only.",
    expected:
      "The selected bar becomes 0–1 s. Beat one stays at 0; the visible attacks stay at 0.25 and 0.75 s. Later markers are retained outside this shorter view.",
    target: (r) => field(r, "Training tempo"),
    check: (r) =>
      (field(r, "Training tempo") as HTMLInputElement)?.value === "240" &&
      labels(r).includes("0.250000 s") &&
      labels(r).includes("0.750000 s") &&
      labels(r).length === 2,
  },
  {
    id: "uncertainty-stage",
    title: "Mark uncertainty",
    action: "Choose Mark uncertainty.",
    expected: "Source-time fields for uncertainty start and end become available.",
    target: (r) => button(r, "Mark uncertainty"),
    check: (r) => Boolean(field(r, "Uncertain start seconds")),
  },
  {
    id: "uncertainty-range",
    title: "Exclude an ambiguous passage",
    action:
      "Enter 0.7 for Uncertain start seconds and 0.8 for Uncertain end seconds, then choose Add uncertainty region. This is an editing demonstration, not an acoustic judgment.",
    expected:
      "A shaded region covers 0.70–0.80 s; its desired attack is subdued. Labels are retained, not deleted.",
    target: (r) => field(r, "Uncertain start seconds"),
    check: (r) =>
      (field(r, "Region 1 start seconds") as HTMLInputElement)?.value === "0.7" &&
      (field(r, "Region 1 end seconds") as HTMLInputElement)?.value === "0.8",
  },
  {
    id: "review",
    title: "Review before saving",
    action: "Choose Save. Read the desired times and uncertainty range.",
    expected:
      "Add to training set is offered because the new bar boundaries identify a different example. There is no review checkbox.",
    target: (r) => button(r, "Save"),
    check: (r) => Boolean(button(r, "Add to training set")),
  },
  {
    id: "save-new",
    title: "Save the shorter bar",
    action: "Choose Add to training set. That action confirms your review.",
    expected:
      "The temporary dataset contains two examples sharing one audio source; the original two-second example remains unchanged. Overwrite replaces Add for the new bar.",
    target: (r) => button(r, "Add to training set"),
    check: (r, f) =>
      Boolean(newExample(f)?.reviewed) &&
      f.peek().manifest.examples.length === 2 &&
      Boolean(button(r, "Overwrite training example")),
  },
  {
    id: "overwrite",
    title: "Adjust and overwrite",
    action:
      "Return to Correct attacks, select 0.250000 s, choose Later one sample, then return to Save and choose Overwrite training example.",
    expected:
      "The shorter example now contains frame 12001 (about 0.250021 s). The dataset still has two examples, with no saved annotation revision history.",
    target: (r) =>
      r.querySelector(".training-attacks")
        ? labels(r).includes("0.250021 s")
          ? button(r, "Save")
          : (field(r, "Desired attack source seconds") as HTMLInputElement)?.value === "0.25"
            ? button(r, "Later one sample")
            : button(r, "0.250000 s")
        : r.textContent?.includes("0.250021")
          ? button(r, "Overwrite training example")
          : button(r, "Correct attacks"),
    check: (_r, f) =>
      Boolean(newExample(f)?.desiredFrames.includes(12001)) &&
      f.peek().manifest.examples.length === 2,
  },
  {
    id: "guard",
    title: "Check unsaved-draft protection",
    action:
      "Return to Correct attacks, select 0.750000 s and remove it. Then choose Close annotation.",
    expected: "Save…, Discard and Stay appear. The draft is not silently lost.",
    target: (r) =>
      !r.querySelector(".training-attacks")
        ? button(r, "Correct attacks")
        : labels(r).includes("0.750000 s")
          ? (field(r, "Desired attack source seconds") as HTMLInputElement)?.value === "0.75"
            ? button(r, "Remove desired attack")
            : button(r, "0.750000 s")
          : button(r, "Close annotation"),
    check: (r) => Boolean(r.querySelector('[aria-label="Unsaved training annotations"]')),
  },
  {
    id: "stay",
    title: "Keep exploring",
    action:
      "Choose Stay. You can explore zoom, audition, keyboard nudges and uncertainty endpoints afterward.",
    expected:
      "The dialog closes and your edited draft remains open. No real dataset has been changed.",
    target: (r) => button(r, "Stay"),
    check: (r) =>
      ready(r) &&
      !r.querySelector('[aria-label="Unsaved training annotations"]') &&
      !labels(r).includes("0.750000 s"),
  },
  {
    id: "finish",
    title: "Your verdict",
    action:
      "Review the per-step results next. Not working records a failure; Next leaves a step unverified. Back revisits instructions without undoing editor actions.",
    expected:
      "The report separates observed behavior from your confirmations. Completing this guide does not accept or close an issue.",
  },
];
function tutorialText(text: string) {
  const names = /(Import tempo \(BPM\)|Beat one \(seconds\)|Import audio|Confirm tempo and beat one|Annotate training attacks|Confirm & continue|Add uncertainty region|Uncertain start seconds|Uncertain end seconds|Desired attack source seconds|Training tempo|Return|Add|Overwrite|Go|Cancel|\b\d+(?:\.\d+)?\b|["“][^"”]+["”])/g;
  return text.split(names).map((part, i) => i % 2 ? <code className="tutorial-term" key={i}>{part}</code> : part);
}
const annotationQuestion =
  "Can I correct source-time attacks, mark uncertainty and safely Add/Overwrite a Recorded bar?";
function Guide({
  root,
  data,
  restart,
  steps: plannedSteps = annotationSteps,
  question = annotationQuestion,
  sample = false,
  tutorialName = "Correct attack annotations",
}: {
  root: HTMLElement | null;
  data: Fixture | null;
  restart: () => void;
  steps?: Step[];
  question?: string;
  sample?: boolean;
  tutorialName?: string;
}) {
  const steps = useMemo(() => sample ? plannedSteps.map(s =>
    s.id === "sample-tempo" ? { ...s, entry: true,
      action: "Enter your sample's tempo between 30 and 300 in Import tempo (BPM).",
      expected: "Press Return or leave the field when finished.",
      check: (r: HTMLElement) => {
        const input = control(r, "import-tempo") as HTMLInputElement | null;
        return Boolean(input && input.value !== "" && input.validity.valid);
      } } : s.id === "sample-beat-one" ? { ...s, entry: true,
      action: "Enter the first downbeat's source time in Beat one (seconds).",
      expected: "Press Return or leave the field when finished.",
      check: (r: HTMLElement) => {
        const input = control(r, "import-beat-one") as HTMLInputElement | null;
        return Boolean(input && input.value !== "" && input.validity.valid);
      } } : s) : plannedSteps, [sample, plannedSteps]);
  const [index, setIndex] = useState(0),
    [open, setOpen] = useState(true),
    [started, setStarted] = useState(false),
    [outcomes, setOutcomes] = useState<Record<string, Outcome>>({}),
    [already, setAlready] = useState(false),
    [missing, setMissing] = useState(false),
    [geometry, setGeometry] = useState<{
      x: number;
      y: number;
      width: number;
      height: number;
      panelX: number;
      panelY: number;
      panelWidth: number;
      docked: boolean; stepIndex: number;
    } | null>(null),
    [report, setReport] = useState(""),
    [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const panel = useRef<HTMLElement>(null),
    step = steps[index],
    summary = index === steps.length;
  const target = () => root && step?.target?.(root);
  useEffect(() => {
    if (!started || !open || !root || (!data && !sample) || !step) return;
    let previous = step.check?.(root, data!) ?? false,
      frame = 0,
      alive = true,
      userActed = false, entryChanged = false, composing = false, scrolled = false;
    setAlready(previous);
    const measure = () => {
      const t = target(),
        r = t?.getBoundingClientRect(),
        visible = Boolean(r && r.width && r.height);
      setMissing(Boolean(step.target && !visible));
      if (!visible || !r) {
        setGeometry(null);
        return;
      }
      const width = Math.min(320, innerWidth - 24),
        workspace = root.getBoundingClientRect(),
        right = workspace.right + 24 + width < innerWidth - 12,
        left = workspace.left - width - 24 > 12,
        docked = innerWidth < 1280 || (!right && !left),
        panelX = docked ? 12 : right ? workspace.right + 24 : workspace.left - width - 24,
        panelY = docked
          ? Math.max(
              12,
              innerHeight - Math.min(panel.current?.offsetHeight ?? 300, innerHeight * 0.44) - 12,
            )
          : 16;
      if (!scrolled) {
        scrolled = true;
        const panelRect = panel.current?.getBoundingClientRect();
        const obscured = panelRect && r.left < panelRect.right && r.right > panelRect.left && r.top < panelRect.bottom && r.bottom > panelRect.top;
        if (r.top < 72 || r.bottom > innerHeight - 72 || obscured) {
          window.scrollBy({ top: r.top - Math.max(80, innerHeight * .22), behavior: "smooth" });
          if (obscured && r.left > width + 24) setPosition({ x: 12, y: 16 });
        }
      }
      setGeometry({
        x: r.left - 4,
        y: r.top - 4,
        width: r.width + 8,
        height: r.height + 8,
        panelX,
        panelY,
        panelWidth: width,
        docked, stepIndex: index,
      });
    };
    const check = () => {
      if (!alive) return;
      const current = step.check?.(root, data!) ?? false;
      if (userActed && current && (step.entry ? entryChanged && !composing : !previous)) {
        alive = false;
        setOutcomes((old) => ({ ...old, [step.id]: "observed" }));
        setIndex((old) => Math.min(steps.length, old + 1));
      }
      previous = current;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    // Arm only this step, before the editor handles a real user interaction.
    // Rendering, detector results and repository notifications cannot arm it.
    const onInteraction = (event: Event) => {
      if (!event.isTrusted || (step.interaction && !step.interaction(event, root))) return;
      if (event.type === "compositionstart") { composing = true; return; }
      if (event.type === "compositionend") composing = false;
      if ((event as InputEvent).isComposing || composing) return;
      userActed = true;
      const isTarget = event.target === target();
      if (isTarget && step.entry) {
        const input = event as InputEvent;
        // Pasted/replaced values are complete. Typed numbers can be prefixes of
        // longer valid numbers, so Return or leaving the field commits them.
        if (event.type === "input") entryChanged = input.inputType === "insertFromPaste" || input.data === null;
        else if (event.type === "focusout" || event.type === "change" || event.type === "compositionend" || (event.type === "keydown" && (event as KeyboardEvent).key === "Enter")) entryChanged = true;
      }
      queueMicrotask(check);
    };
    const interactions = ["pointerdown", "pointermove", "pointerover", "focusin", "keydown", "input", "click", "compositionstart", "compositionend", "change", "focusout"];
    const observer = new MutationObserver(check);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    resize.observe(root);
    if (panel.current) resize.observe(panel.current);
    for (const event of interactions) root.addEventListener(event, onInteraction, true);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const unsubscribe = data?.subscribe(check);
    measure();
    return () => {
      alive = false;
      observer.disconnect();
      resize.disconnect();
      unsubscribe?.();
      cancelAnimationFrame(frame);
      for (const event of interactions) root.removeEventListener(event, onInteraction, true);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [root, data, index, open, started, steps]);
  const verdict = (outcome: Outcome, advance = true) => {
    if (step) setOutcomes((old) => ({ ...old, [step.id]: outcome }));
    if (advance) setIndex((i) => Math.min(steps.length, i + 1));
  };
  const buildReport = () =>
    JSON.stringify(
      {
        question,
        scope: sample ? "Actual practice/import screen with user-selected local audio. Normal app recovery and preferences apply. No automatic training save, export or microphone activation. Restart resets only guide progress, not app data." :
          "Actual production TrainingAnnotationEditor and repository logic; synthetic audio, deliberately flawed initial labels, isolated memory backend. No microphone, real IndexedDB, native device or acoustic accuracy evidence.",
        context: {
          sampleRate: sample ? "user-selected audio" : rate,
          initialTempo: sample ? "user-selected" : 120,
          beatOneSeconds: sample ? "user-selected" : 0,
          route: sample ? "/annotation-tutorial?sample=1" : "/annotation-tutorial",
          tutorial: sample ? "load-sample-v1" : "recorded-annotation-v1",
        },
        steps: steps.map((s) => ({
          id: s.id,
          title: s.title,
          action: s.action,
          expected: s.expected,
          outcome: outcomes[s.id] ?? "unverified",
        })),
        limitations: sample ? ["User-selected audio and native file picker require user participation.", "Restart preserves imported audio and preferences; choose Import audio again to repeat.", "Guide completion is not issue acceptance or acoustic validation."] : [
          "Capture-to-review entry is not exercised here.",
          "Persistence is intentionally temporary; real storage and acoustic judgment remain separate.",
          "Tutorial completion is not issue acceptance.",
        ],
      },
      null,
      2,
    );
  if (!open)
    return createPortal(
      <button className="tutorial-reopen" onClick={() => setOpen(true)}>
        Reopen annotation guide
      </button>, document.body
    );
  const r = started && geometry?.stepIndex === index ? geometry : null,
    onscreen =
      r && r.y + r.height > 0 && r.y < innerHeight && r.x + r.width > 0 && r.x < innerWidth;
  return createPortal(
    <>
      {r && onscreen && (
        <>
          <div
            className="tutorial-highlight"
            style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
          />
          <svg className="tutorial-arrow" aria-hidden="true" viewBox="0 0 48 56"
            style={{ left: Math.min(innerWidth - 52, Math.max(4, r.x + r.width / 2 - 24)), top: r.y >= 64 ? r.y - 60 : r.y + r.height + 8,
              rotate: r.y >= 64 ? undefined : "180deg" }}>
            <path d="M15 3 H33 V28 H44 L24 51 L4 28 H15 Z" fill="#ffbf38" stroke="#f95a9b" strokeWidth="4" strokeLinejoin="round" />
          </svg>
        </>
      )}
      <aside
        className={`tutorial-panel ${r?.docked ? "is-docked" : ""}`}
        ref={panel}
        aria-label="Annotation walkthrough"
        style={position ? { left: position.x, top: position.y, bottom: "auto", width: Math.min(320, innerWidth - 24) } : r ? { left: r.panelX, top: r.docked ? "auto" : 16, bottom: r.docked ? 12 : "auto", width: r.panelWidth } : undefined}
      >
        <div className="tutorial-controls tutorial-drag-handle"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest("button") || event.button !== 0) return;
            const rect = panel.current!.getBoundingClientRect();
            drag.current = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const active = drag.current;
            if (!active || active.id !== event.pointerId) return;
            const rect = panel.current!.getBoundingClientRect();
            setPosition({ x: Math.max(8, Math.min(innerWidth - rect.width - 8, event.clientX - active.dx)),
              y: Math.max(8, Math.min(innerHeight - rect.height - 8, event.clientY - active.dy)) });
          }}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}>
          <strong>{!started ? "Tutorial" : summary ? "Walkthrough report" : `Step ${index + 1} / ${steps.length}`}</strong>
          <button aria-label="Close guide" onClick={() => { setOpen(false); setGeometry(null) }}>×</button>
        </div>
        {started && <progress
          max={steps.length}
          value={
            Object.values(outcomes).filter((o) => o === "observed" || o === "user-confirmed").length
          }
          aria-label="Verified walkthrough progress"
        />}
        {!started ? (
          <>
            <h2>Tutorial: {sample ? "Load a sample" : tutorialName}</h2>
            <p>Steps:</p>
            <ul>{steps.map(s => <li key={s.id}>{s.title}</li>)}</ul>
            <details><summary>Notes:</summary>
              <p>{sample ? "Import replaces your latest working take. Saved bars and training examples stay unchanged. Restart resets only this guide." : "This guide uses synthetic audio and temporary training data. Restart clears only that data."}</p>
            </details>
            <div className="tutorial-controls">
              <button onClick={() => setStarted(true)}>Go</button>
              <button onClick={() => { setOpen(false); setGeometry(null); }}>Cancel</button>
            </div>
          </>
        ) : summary ? (
          <>
            <h2>Your walkthrough results</h2>
            <p>{question}</p>
            <ul>
              {steps.map((s) => (
                <li key={s.id}>
                  {s.title}: <strong>{outcomes[s.id] ?? "unverified"}</strong>
                </li>
              ))}
            </ul>
            <p>These are tutorial results, not acceptance of the annotation issue.</p>
            <button
              onClick={async () => {
                const text = buildReport();
                setReport(text);
                try {
                  await navigator.clipboard.writeText(text);
                } catch {
                  /* Selectable report below. */
                }
              }}
            >
              Copy report
            </button>
            {report && (
              <label>
                Selectable report
                <textarea readOnly value={report} onFocus={(e) => e.target.select()} />
              </label>
            )}
          </>
        ) : (
          <>
            <h2 aria-live="polite">{step.title}</h2>
            <p>{tutorialText(step.action)}</p>
            <p>
              <strong>Expected:</strong> {tutorialText(step.expected)}
            </p>
            <details><summary>Step result</summary><p>{outcomes[step.id] ?? "unverified"}</p></details>
            {already && (
              <p>
                {step.entry ? "Keep the current value with Return, or enter a new one." : "This step is already complete. Confirm it, continue with Next, or restart."}
              </p>
            )}
            {missing && (
              <p role="status">
                The control is hidden. Open the editor or return to the required stage. You can also use Back or Next.
              </p>
            )}
            {step.target && (
              <button
                onClick={() => {
                  const t = target();
                  t?.scrollIntoView({ block: "center", behavior: "smooth" });
                  t?.focus({ preventScroll: true });
                }}
              >
                Show target
              </button>
            )}
            <div className="tutorial-controls">
              <button onClick={() => verdict("user-confirmed")}>Confirm & continue</button>
              <button onClick={() => verdict("failed", false)}>Not working</button>
            </div>
          </>
        )}
        {started && <div className="tutorial-controls">
          <button disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
            Back
          </button>
          <button disabled={summary} onClick={() => setIndex((i) => Math.min(steps.length, i + 1))}>
            Next
          </button>
          <button disabled={summary} onClick={() => verdict("skipped")}>
            Skip
          </button>
          <button
            onClick={() => {
              setStarted(false);
              setIndex(0);
              setOutcomes({});
              setReport("");
              setGeometry(null);
              restart();
            }}
          >
            Restart
          </button>
        </div>}
      </aside>
    </>, document.body
  );
}
function Tutorial({ playback = false }: { playback?: boolean }) {
  const [data, setData] = useState<Fixture | null>(null),
    [editor, setEditor] = useState(false),
    [epoch, setEpoch] = useState(0),
    [root, setRoot] = useState<HTMLElement | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      owned: Fixture | null = null;
    setData(null);
    fixture()
      .then((next) => {
        owned = next;
        if (alive) setData(next);
        else next.dispose();
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      owned?.dispose();
    };
  }, [epoch]);
  return (
    <main className="app-shell annotation-tutorial">
      <h1>{playback ? "Annotation playback and selection" : "Recorded bar annotation"}</h1>
      <p className="tutorial-scope">
        Actual editor · synthetic audio · temporary memory-only dataset · microphone not connected
      </p>
      <p>
        {playback ? "Try marker playback and region selection on a temporary sample." : "Practice correcting one missing and one extra attack."} Your recordings and training data stay unchanged.
      </p>
      <section ref={setRoot} className="tutorial-workspace">
        {error && <p role="alert">{error}</p>}
        {!editor ? (
          <button data-testid="tutorial-open-annotation" disabled={!data} onClick={() => setEditor(true)}>
            Open annotation editor
          </button>
        ) : (
          data && (
            <TrainingAnnotationEditor
              key={epoch}
              take={data.take}
              initialIndex={0}
              settings={DEFAULT_DETECTOR_SETTINGS}
              balance={100}
              repository={data.repository}
              onClose={() => setEditor(false)}
            />
          )
        )}
      </section>
      <Guide
        key={epoch}
        root={root}
        data={data}
        steps={playback ? playbackSteps : annotationSteps}
        tutorialName={playback ? "Annotation playback and selection" : "Correct attack annotations"}
        question={playback ? "Can I preview an attack, select a region and stop playback without changing annotations?" : annotationQuestion}
        restart={() => {
          setEditor(false);
          setEpoch((n) => n + 1);
        }}
      />
    </main>
  );
}
const previewPlaying = (r: HTMLElement) => control(r, "training-annotation-editor")?.dataset.previewState === "playing";
const playbackSteps: Step[] = [
  { id: "playback-open", title: "Open annotation", action: "Choose Open annotation editor.", expected: "The temporary sample opens with desired and calculated attacks.", target: r => control(r, "tutorial-open-annotation"), check: r => control(r, "training-annotation-editor")?.dataset.state === "ready" },
  { id: "playback-reveal", title: "Reveal a play button", action: "Hover over the first green attack marker, or select it with the keyboard.", expected: "A square play button appears below the marker.", target: r => control(r, "annotation-attack-12000"), check: r => Boolean(control(r, "annotation-marker-play")) },
  { id: "playback-marker", title: "Play one attack", action: "Choose the square play button.", expected: "Playback runs from this attack to the next desired attack.", target: r => control(r, "annotation-marker-play"), check: previewPlaying },
  { id: "playback-select", title: "Select a region", action: "Drag sideways across several attacks in the detail waveform.", expected: "The selected region is shaded. Attack markers stay unchanged.", target: r => control(r, "annotation-waveform"), check: r => Boolean(control(r, "annotation-playback-selection")) },
  { id: "playback-region", title: "Play the selection", action: "Choose the square play button at the start of the selection.", expected: "Only the selected region plays.", target: r => control(r, "annotation-marker-play"), check: r => Boolean(control(r, "annotation-playback-selection")) && previewPlaying(r) },
  { id: "playback-stop", interaction: (e, r) => (e.type === "keydown" && (e as KeyboardEvent).key === "Escape") || (e.type === "click" && (e.target as Element).closest('[data-testid="annotation-marker-play"]') === control(r, "annotation-marker-play") && control(r, "annotation-marker-play")?.getAttribute("aria-label") === "Stop audio preview"), title: "Stop playback", action: "Choose the square Stop button, or press Escape while audio is playing.", expected: "Playback stops and the selection remains. If playback already ended, confirm to continue.", target: r => control(r, "annotation-marker-play"), check: r => !previewPlaying(r) && Boolean(control(r, "annotation-playback-selection")) },
  { id: "playback-finish", title: "Playback controls checked", action: "Close guide to explore, or confirm to view your results.", expected: "You can also drag up or down to zoom time and use the overview to navigate." },
];
const sampleSteps: Step[] = [
  { id: "sample-file", title: "Choose your audio file", action: "Choose Import audio and select a WAV or M4A. Include its matching .forget file if you have one.", expected: "The audio preview opens. If a .forget pair loads the bar directly, choose Confirm & continue.", target: r => control(r, "import-audio"), check: r => Boolean(control(r, "import-audio-setup")) },
  { id: "sample-tempo", title: "Set the sample tempo", action: "Enter the sample’s BPM in Import tempo.", expected: "Check the grid, then confirm. If metadata loaded the bar, confirm to continue.", target: r => control(r, "import-tempo") ?? control(r, "import-audio-only") ?? control(r, "open-training-annotation") },
  { id: "sample-beat-one", title: "Place beat one", action: "Place beat one on the first downbeat using the seconds field or a waveform tap.", expected: "The grid starts on the downbeat. Choose Confirm & continue.", target: r => control(r, "import-beat-one") ?? control(r, "open-training-annotation") },
  { id: "sample-confirm", title: "Load the recorded bar", action: "Choose Confirm tempo and beat one. If the bar is already loaded from its metadata, use Confirm & continue.", expected: "Recorded bar is available with Annotate training attacks. Microphone remains off.", target: r => control(r, "confirm-audio-import") ?? control(r, "open-training-annotation"), check: r => Boolean(control(r, "open-training-annotation")) && !control(r, "import-audio-setup") },
  { id: "sample-annotate", title: "Open your sample for correction", action: "Choose Annotate training attacks.", expected: "Your sample opens with editable attack markers.", target: r => control(r, "open-training-annotation"), check: r => control(r, "training-annotation-editor")?.dataset.state === "ready" },
  { id: "sample-finish", title: "Your sample is ready", action: "Close guide to edit your sample, or confirm to view the walkthrough report.", expected: "Use Add or Overwrite when you are ready to save a training example." },
];
function SampleTutorial() {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [epoch, setEpoch] = useState(0);
  return <><div ref={setRoot}><PracticeScreen /><section id="training-import-panel" /></div>
    <Guide key={epoch} root={root} data={null} sample steps={sampleSteps}
      question="Can I import my own sample, set its musical reference and open it for annotation?"
      restart={() => setEpoch(n => n + 1)} />
  </>;
}
if (import.meta.env.DEV) {
  const tutorialRoot = createRoot(document.getElementById("root")!);
  tutorialRoot.render(new URLSearchParams(location.search).has("sample") ? <SampleTutorial /> : <Tutorial playback={new URLSearchParams(location.search).has("playback")} />);
  import.meta.hot?.dispose(() => tutorialRoot.unmount());
}
