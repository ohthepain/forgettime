import { useEffect, useMemo, useRef, useState } from "react";
import type { RecordedTake } from "../audio/recorded-take";
import type { DetectorSettings } from "../audio/detector-contract";
import { useImportDetections } from "../audio/use-import-detections";
import { TrainingAnnotation, type AnnotationRepository } from "../audio/training-annotation";
import { createIndexedDbTrainingStore, createTrainingRepository } from "../audio/training-dataset";
import { WaveformDisplay, type WaveformDisplayHandle, type WaveformView } from "./WaveformDisplay";

const steps = [{ name: "Mark uncertainty", index: 1 }, { name: "Save", index: 2 }];
export function TrainingAnnotationEditor({
  take,
  initialIndex,
  settings,
  balance,
  onClose,
  repository: supplied,
  closeRequest = 0,
  onStay,
}: {
  take: RecordedTake;
  initialIndex: number;
  settings: DetectorSettings;
  balance: number;
  onClose: () => void;
  repository?: AnnotationRepository;
  closeRequest?: number;
  onStay?: () => void;
}) {
  const repository = useMemo(
    () =>
      supplied ??
      createTrainingRepository({
        read: async () => createIndexedDbTrainingStore().read(),
        compareAndSwap: async (expected, next) =>
          createIndexedDbTrainingStore().compareAndSwap(expected, next),
      }),
    [supplied],
  );
  const audio = useMemo(
    () => ({ samples: take.audio.samples, sampleRate: take.audio.sampleRate, channels: 1 }),
    [take],
  );
  const calculated = useImportDetections(audio, settings, balance);
  const [session, setSession] = useState<TrainingAnnotation | null>(null);
  const [revision, render] = useState(0),
    [step, setStep] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const waveform = useRef<WaveformDisplayHandle>(null);
  const [view, setView] = useState<WaveformView | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [exit, setExit] = useState<(() => void) | null>(null),
    [afterSave, setAfterSave] = useState<(() => void) | null>(null);
  const [auditioning, setAuditioning] = useState(false);
  const markerFocus = useRef<number | null>(null);
  const lastCloseRequest = useRef(closeRequest);
  const exitDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!exit) return;
    const dialog = exitDialog.current!;
    const trigger = document.activeElement;
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>("[data-stay]")?.focus();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
    };
  }, [exit]);
  const generation = useRef(0);
  const frames = calculated.hits.map((hit) => Math.round(hit.time * audio.sampleRate));
  const latestFrames = useRef(frames);
  latestFrames.current = frames;
  function stopOutput() {
    waveform.current?.stop();
  }
  useEffect(() => {
    if (calculated.pending || session) return;
    let alive = true;
    TrainingAnnotation.open(take, initialIndex, latestFrames.current, repository)
      .then((next) => {
        if (alive) { setSession(next); if (next.restoredDraft) setNotice("Restored your saved draft. Review before overwriting training annotations."); }
      })
      .catch((e) => {
        if (alive) setError(String(e.message));
      });
    return () => {
      alive = false;
    };
  }, [take, initialIndex, repository, calculated.pending, session]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (!session?.dirty || !session.coverage.complete) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [session, revision]);
  useEffect(() => {
    if (lastCloseRequest.current === closeRequest) return;
    lastCloseRequest.current = closeRequest;
    guarded(onClose);
  }, [closeRequest]);
  useEffect(() => {
    if (markerFocus.current === null) return;
    waveform.current?.focusMarker(markerFocus.current);
    markerFocus.current = null;
  }, [revision]);
  function edit(action: () => void) {
    try {
      action();
      setError("");
      setNotice("");
      render((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function guarded(action: () => void) {
    stopOutput();
    if (session?.dirty && session.coverage.complete) setExit(() => action);
    else action();
  }
  async function navigate(index: number) {
    const token = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await TrainingAnnotation.open(
        { ...take, origin: session ? (session.beatOneFrame + take.audio.startFrame) / take.audio.sampleRate : take.origin, settings: { ...take.settings, bpm: session?.draft.bpm ?? take.settings.bpm } },
        index,
        latestFrames.current,
        repository,
      );
      if (token !== generation.current) return;
      setSession(next);
      setSelected(null);
      setView(null);
      setStep(0);
      setNotice("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  async function save() {
    if (!session) return;
    stopOutput();
    setBusy(true);
    setError("");
    try {
      await session.save();
      setNotice("Training example saved on this device.");
      render((n) => n + 1);
      const next = afterSave;
      setAfterSave(null);
      next?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exclude() {
    if (!session) return;
    stopOutput();
    setBusy(true);
    setError("");
    try {
      await session.exclude();
      setNotice("Bar excluded from the training set.");
      render(n => n + 1);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  if (!session)
    return (
      <section
        className="training-editor"
        data-testid="training-annotation-editor"
        data-state="loading"
        aria-label="Training annotation"
      >
        <p role="status">Preparing full-source audio and calculated attacks…</p>
        {error && <p role="alert">{error}</p>}
        <button data-testid="annotation-close" onClick={onClose}>Close annotation</button>
      </section>
    );
  const example = session.example(),
    coverage = session.coverage,
    rate = audio.sampleRate;
  const start = coverage.startFrame,
    end = coverage.endFrame;
  const low = Math.max(start, Math.min(view?.start ?? start, end - 1));
  const high = Math.min(end, Math.max(low + 1, view?.end ?? end));
  const uncertain = (frame: number) =>
    example.uncertain.some((r) => frame >= r.startFrame && frame < r.endFrame);
  const shown = example.desiredFrames;
  const maxIndex = Math.max(
    0,
    Math.ceil((audio.samples.length - session.beatOneFrame) / ((rate * 240) / session.draft.bpm)) -
      1,
  );
  return (
    <section
      className="training-editor"
      data-testid="training-annotation-editor"
      data-state="ready"
      data-example-id={example.id}
      data-save-state={notice === "Training example saved on this device." ? "saved" : "unsaved"}
      data-preview-state={auditioning ? "playing" : "idle"}
      aria-label="Training annotation"
      aria-busy={busy}
    >
      <div className="training-heading">
        <h2>Recorded bar · training</h2>
        <button data-testid="annotation-close" disabled={busy} onClick={() => guarded(onClose)}>
          Close annotation
        </button>
      </div>
      <p>
        Microphone off · original audio and analysis preserved. Close annotation before replacing
        the recording.
      </p>
      <fieldset disabled={busy || Boolean(exit)}>
        <nav aria-label="Annotation tools">
          {steps.map(({ name, index: i }) => (
            <button
              key={name}
              disabled={i === 2 && !coverage.complete}
              data-testid={`annotation-tool-${i}`}
              aria-current={step === i ? "step" : undefined}
              onClick={() => {
                setStep(i);
                          if (i === 2 && coverage.complete) void save();
              }}
            >
              {name}
            </button>
          ))}
          {session.savedExampleId && <button data-testid="annotation-exclude" onClick={() => void exclude()}>Exclude training bar</button>}
        </nav>
        <div className="training-tools" data-testid="annotation-bar-navigation">
          <button
            aria-label="Previous training bar"
            disabled={session.index === 0}
            onClick={() => guarded(() => void navigate(session.index - 1))}
          >
            {"<"}
          </button>
          <span>
            Bar {session.index + 1} / {maxIndex + 1}
          </span>
          <button
            aria-label="Next training bar"
            disabled={session.index >= maxIndex}
            onClick={() => guarded(() => void navigate(session.index + 1))}
          >
            {">"}
          </button>
          <label>
            Tempo{" "}
            <input
              key={`${session.index}:${session.draft.bpm}`}
              data-testid="annotation-tempo"
              type="number"
              min="30"
              max="300"
              step="any"
              defaultValue={session.draft.bpm}
              onBlur={(e) => {
                edit(() => {
                  session.setTempo(Number(e.target.value));
                  setView(null);
                  setSelected(null);
                });
                e.currentTarget.value = String(session.draft.bpm);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />{" "}
            BPM
          </label>
        </div>
        <label>Beat one (seconds){" "}
          <input data-testid="annotation-beat-one" type="number" min={0} max={(audio.samples.length - 1) / rate} step={1 / rate}
            key={`beat-one:${session.index}:${session.beatOneFrame}`} defaultValue={session.beatOneFrame / rate}
            onBlur={event => {
              edit(() => { session.setBeatOne(Math.round(Number(event.target.value) * rate)); setView(null); setSelected(null); });
              event.currentTarget.value = String(session.beatOneFrame / rate);
            }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        </label>
        {!coverage.complete && <p>Partial bar — complete audio is required to save.</p>}
        <WaveformDisplay
          key={`${session.index}:${session.draft.bpm}`}
          ref={waveform}
          scope="annotation"
          audio={audio}
          range={{ start, end }}
          grid={{ bpm: session.draft.bpm, beatOneFrame: session.beatOneFrame }}
          beatOne={{ frame: session.beatOneFrame, change: frame => edit(() => { session.setBeatOne(frame); setView(null); }) }}
          markers={[
            ...frames
              .filter((f) => f >= start && f < end)
              .map((frame) => ({ frame, kind: "calculated" as const })),
            ...shown.map((frame) => ({
              frame,
              kind: "desired" as const,
              uncertain: uncertain(frame),
            })),
          ]}
          isBarIncluded={index => session.isBarIncluded(index)}
          onSelectBar={index => { if (index !== session.index) guarded(() => void navigate(index)); }}
          selectedFrame={selected}
          onSelect={setSelected}
          onPlace={frame => {
            edit(() => session.setAttack(null, frame));
            setSelected(frame);
          }}
          onDelete={frame => edit(() => { session.setAttack(frame, null); if (selected === frame) setSelected(null); })}
          onNudge={(frame, delta) => edit(() => {
            const next = frame + delta;
            session.setAttack(frame, next);
            markerFocus.current = next;
            setSelected(next);
          })}
          disabled={busy || Boolean(exit)}
          contextKey={`${revision}:${step}:${JSON.stringify(settings)}:${balance}`}
          onViewChange={setView}
          onPlaybackChange={setAuditioning}
          uncertainRegions={example.uncertain.map((r) => ({
            start: r.startFrame,
            end: r.endFrame,
          }))}
        />
        <p>
          Source view {((view?.start ?? start) / rate).toFixed(4)}–{((view?.end ?? end) / rate).toFixed(4)} s · {shown.length}{" "}
          desired ·{" "}
          {calculated.pending
            ? "calculating…"
            : `${frames.filter((f) => f >= start && f < end).length} calculated (review detector)`}
        </p>
        {step === 1 && (
          <>
            <form
              className="training-tools"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                edit(() =>
                  session.setRegion(null, {
                    startFrame: Math.round(Number(data.get("start")) * rate),
                    endFrame: Math.round(Number(data.get("end")) * rate),
                  }),
                );
              }}
            >
              <label>
                Uncertain start seconds{" "}
                <input
                  name="start"
                  type="number"
                  step="any"
                  required
                  min={start / rate}
                  max={end / rate}
                  defaultValue={low / rate}
                />
              </label>
              <label>
                Uncertain end seconds{" "}
                <input
                  name="end"
                  type="number"
                  step="any"
                  required
                  min={start / rate}
                  max={end / rate}
                  defaultValue={high / rate}
                />
              </label>
              <button>Add uncertainty region</button>
            </form>
            {session.draft.uncertain.map((region, i) => (
              <div key={`${i}:${revision}`} className="training-tools">
                <label>
                  Region {i + 1} start seconds{" "}
                  <input
                    type="number"
                    step="any"
                    defaultValue={region.startFrame / rate}
                    onBlur={(e) =>
                      edit(() =>
                        session.setRegion(i, {
                          ...region,
                          startFrame: Math.round(Number(e.target.value) * rate),
                        }),
                      )
                    }
                  />
                </label>
                <label>
                  Region {i + 1} end seconds{" "}
                  <input
                    type="number"
                    step="any"
                    defaultValue={region.endFrame / rate}
                    onBlur={(e) =>
                      edit(() =>
                        session.setRegion(i, {
                          ...region,
                          endFrame: Math.round(Number(e.target.value) * rate),
                        }),
                      )
                    }
                  />
                </label>
                <button onClick={() => edit(() => session.setRegion(i, null))}>
                  Remove region {i + 1}
                </button>
              </div>
            ))}
          </>
        )}
        {step === 2 && (
          <div data-testid="annotation-save-review" className="training-summary">
            <p>
              {shown.length} desired attacks · {example.uncertain.length} uncertainty regions ·{" "}
              {session.draft.bpm} BPM · source frames {example.bar.startFrame}–
              {example.bar.endFrame}.
            </p>
            <p>
              Desired source times:{" "}
              {shown.map((f) => (f / rate).toFixed(6)).join(", ") ||
                "No attacks (reviewed silence)"}
            </p>
            <p>
              Uncertain source ranges:{" "}
              {example.uncertain
                .map(
                  (r) => `${(r.startFrame / rate).toFixed(6)}–${(r.endFrame / rate).toFixed(6)} s`,
                )
                .join(", ") || "None"}
            </p>
            <p>
              {session.overwrite
                ? "Overwrite replaces the current desired attacks and uncertainty regions without keeping a previous revision."
                : "Add stores this source and bar as a training example. Identical source audio is stored once."}
            </p>
            <p>
              Saving confirms you reviewed all
              attacks, including outside uncertain regions. New recordings remain unassigned until
              evaluation grouping is chosen.
            </p>
            <button data-testid="annotation-commit" disabled={!coverage.complete} onClick={() => void save()}>
              {session.overwrite ? "Overwrite training example" : "Add to training set"}
            </button>
            {afterSave && (
              <button onClick={() => setAfterSave(null)}>Cancel pending navigation</button>
            )}
          </div>
        )}
      </fieldset>
      {exit && (
        <dialog
          ref={exitDialog}
          className="training-exit-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Unsaved training annotations"
          onCancel={(event) => {
            event.preventDefault();
            setExit(null);
            onStay?.();
          }}
        >
          <p>Save this draft, discard it, or stay here?</p>
          <button
            onClick={() => {
              try { session.saveDraft(); const action = exit; setExit(null); action(); }
              catch (e) { setError(`Could not save draft: ${(e as Error).message}`); }
            }}
          >
            Save draft
          </button>
          <button
            onClick={() => {
              const action = exit;
              session.discardDraft();
              setExit(null);
              action();
            }}
          >
            Discard
          </button>
          <button data-stay onClick={() => { setExit(null); onStay?.(); }}>
            Stay
          </button>
        </dialog>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error} Your draft is retained.</p>}
    </section>
  );
}
