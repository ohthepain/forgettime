import { useEffect, useMemo, useRef, useState } from "react";
import type { RecordedTake } from "../audio/recorded-take";
import type { DetectorSettings } from "../audio/detector-contract";
import { useImportDetections } from "../audio/use-import-detections";
import { TrainingAnnotation, type AnnotationRepository } from "../audio/training-annotation";
import { createIndexedDbTrainingStore, createTrainingRepository } from "../audio/training-dataset";
import { AudioRegionPreview } from "../audio/audio-region-preview";
import { waveformPath } from "../audio/waveform-path";

const steps = ["Correct attacks", "Mark uncertainty", "Review & save"];
export function TrainingAnnotationEditor({
  take,
  initialIndex,
  settings,
  balance,
  onClose,
  repository: supplied,
  closeRequest = 0,
}: {
  take: RecordedTake;
  initialIndex: number;
  settings: DetectorSettings;
  balance: number;
  onClose: () => void;
  repository?: AnnotationRepository;
  closeRequest?: number;
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
    [step, setStep] = useState(0),
    [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<number | null>(null),
    [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1),
    [offset, setOffset] = useState(0),
    [gain, setGain] = useState(1);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [exit, setExit] = useState<(() => void) | null>(null),
    [afterSave, setAfterSave] = useState<(() => void) | null>(null);
  const [reset, setReset] = useState(false),
    [auditioning, setAuditioning] = useState(false);
  const plot = useRef<SVGSVGElement>(null),
    markerFocus = useRef<number | null>(null);
  const lastCloseRequest = useRef(closeRequest);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const output = useRef(new AudioRegionPreview()),
    generation = useRef(0);
  const frames = calculated.hits.map((hit) => Math.round(hit.time * audio.sampleRate));
  const latestFrames = useRef(frames);
  latestFrames.current = frames;
  function stopOutput() {
    output.current.stop();
    setAuditioning(false);
  }
  useEffect(() => {
    if (calculated.pending || session) return;
    let alive = true;
    TrainingAnnotation.open(take, initialIndex, latestFrames.current, repository)
      .then((next) => {
        if (alive) setSession(next);
      })
      .catch((e) => {
        if (alive) setError(String(e.message));
      });
    return () => {
      alive = false;
    };
  }, [take, initialIndex, repository, calculated.pending, session]);
  useEffect(() => {
    stopOutput();
  }, [revision, zoom, offset, gain, step, settings, balance, session, selected, reset, exit]);
  useEffect(() => {
    const stop = () => {
      output.current.stop();
      setAuditioning(false);
    };
    const hidden = () => {
      if (document.hidden) stop();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") stop();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", stop);
    window.addEventListener("keydown", escape);
    return () => {
      generation.current++;
      output.current.stop();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => {
    if (!session?.dirty) return;
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
    plot.current?.querySelector<SVGGElement>(`[data-frame="${markerFocus.current}"]`)?.focus();
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
    if (session?.dirty) setExit(() => action);
    else action();
  }
  async function navigate(index: number) {
    const token = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await TrainingAnnotation.open(
        { ...take, settings: { ...take.settings, bpm: session?.draft.bpm ?? take.settings.bpm } },
        index,
        latestFrames.current,
        repository,
      );
      if (token !== generation.current) return;
      setSession(next);
      setSelected(null);
      setPage(0);
      setZoom(1);
      setOffset(0);
      setStep(0);
      setAdding(false);
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
  if (!session)
    return (
      <section className="training-editor" aria-label="Training annotation">
        <p role="status">Preparing full-source audio and calculated attacks…</p>
        {error && <p role="alert">{error}</p>}
        <button onClick={onClose}>Close annotation</button>
      </section>
    );
  const example = session.example(),
    coverage = session.coverage,
    rate = audio.sampleRate;
  const start = coverage.startFrame,
    end = coverage.endFrame;
  const span = Math.max(1, Math.ceil((end - start) / zoom)),
    low = Math.min(end - span, start + Math.round(offset * (end - start - span))),
    high = Math.min(end, low + span);
  const x = (frame: number) => ((frame - low) / (high - low)) * 512;
  const visible = (frame: number) => frame >= low && frame < high;
  const uncertain = (frame: number) =>
    example.uncertain.some((r) => frame >= r.startFrame && frame < r.endFrame);
  const shown = example.desiredFrames,
    activePage = Math.min(page, Math.max(0, Math.ceil(shown.length / 20) - 1));
  const selectedVisible = selected !== null && shown.includes(selected);
  const maxIndex = Math.max(
    0,
    Math.ceil((audio.samples.length - session.beatOneFrame) / ((rate * 240) / session.draft.bpm)) -
      1,
  );
  const path = waveformPath(audio.samples, low, high, 1, gain);
  async function audition() {
    setError("");
    try {
      setAuditioning(
        await output.current.play(
          audio,
          (selectedVisible ? selected! : low) / rate,
          high / rate,
          () => setAuditioning(false),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
      setAuditioning(false);
    }
  }
  return (
    <section className="training-editor" aria-label="Training annotation" aria-busy={busy}>
      <div className="training-heading">
        <h2>Recorded bar · training</h2>
        <button disabled={busy} onClick={() => guarded(onClose)}>
          Close annotation
        </button>
      </div>
      <p>
        Microphone off · original audio and analysis preserved. Close annotation before replacing
        the recording.
      </p>
      <fieldset disabled={busy || Boolean(exit) || reset}>
        <nav aria-label="Annotation steps">
          {steps.map((name, i) => (
            <button
              key={name}
              aria-current={step === i ? "step" : undefined}
              onClick={() => {
                setStep(i);
                setAdding(false);
              }}
            >
              {i + 1}. {name}
            </button>
          ))}
        </nav>
        <div className="training-tools">
          <button
            disabled={session.index === 0}
            onClick={() => guarded(() => void navigate(session.index - 1))}
          >
            Previous training bar
          </button>
          <span>
            Bar {session.index + 1} / {maxIndex + 1}
          </span>
          <button
            disabled={session.index >= maxIndex}
            onClick={() => guarded(() => void navigate(session.index + 1))}
          >
            Next training bar
          </button>
          <label>
            Training tempo{" "}
            <input
              key={`${session.index}:${session.draft.bpm}`}
              type="number"
              min="30"
              max="300"
              step="any"
              defaultValue={session.draft.bpm}
              onBlur={(e) => {
                edit(() => {
                  session.setTempo(Number(e.target.value));
                  setZoom(1);
                  setOffset(0);
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
        <p>
          Beat one stays at {(session.beatOneFrame / rate).toFixed(6)} s. Tempo recuts the bar;
          attack times stay fixed.{" "}
          {!coverage.complete &&
            "Partial bar — inspect and edit here; adding to training requires complete audio."}
        </p>
        <div className="training-tools">
          <button
            disabled={!session.canUndo}
            onClick={() =>
              edit(() => {
                session.undo();
                setSelected(null);
              })
            }
          >
            Undo
          </button>
          <button disabled={calculated.pending} onClick={() => setReset(true)}>
            Reset desired attacks from detections…
          </button>
          {step === 0 && (
            <button aria-pressed={adding} onClick={() => setAdding(!adding)}>
              {adding ? "Finish adding attacks" : "Add missing attacks"}
            </button>
          )}
        </div>
        <p>
          {step === 0
            ? adding
              ? "Tap the waveform to add a desired attack. Select a marker to move or remove it."
              : "Select desired attacks to correct them. Use Add missing attacks to place new ones."
            : step === 1
              ? "Mark passages where the correct attacks are uncertain. Attacks inside these regions are excluded from accuracy scoring."
              : "Review all desired attacks and uncertainty regions before saving."}
        </p>
        <svg
          ref={plot}
          className="training-waveform"
          viewBox="0 0 512 64"
          preserveAspectRatio="none"
          role="img"
          aria-label="Training source waveform: green desired attacks, dashed blue calculated attacks, shaded uncertain regions"
          onPointerDown={(e) => {
            pointerStart.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerCancel={() => {
            pointerStart.current = { x: Infinity, y: Infinity };
          }}
          onClick={(e) => {
            if (
              busy ||
              exit ||
              reset ||
              !adding ||
              step !== 0 ||
              (pointerStart.current &&
                Math.hypot(e.clientX - pointerStart.current.x, e.clientY - pointerStart.current.y) >
                  5)
            )
              return;
            pointerStart.current = null;
            const rect = e.currentTarget.getBoundingClientRect(),
              frame = Math.max(
                low,
                Math.min(
                  high - 1,
                  Math.round(low + ((e.clientX - rect.left) / rect.width) * (high - low)),
                ),
              );
            edit(() => session.setAttack(null, frame));
            setSelected(frame);
          }}
        >
          <path d={path} stroke="#74868c" strokeWidth="1" />
          {example.uncertain.map((r, i) => (
            <rect
              key={i}
              x={x(Math.max(low, r.startFrame))}
              y="0"
              width={Math.max(0, x(Math.min(high, r.endFrame)) - x(Math.max(low, r.startFrame)))}
              height="64"
              fill="#dca64e"
              opacity=".2"
            />
          ))}
          {frames.filter(visible).map((frame, i) => (
            <line
              key={`c${i}`}
              x1={x(frame)}
              x2={x(frame)}
              y1="8"
              y2="64"
              stroke="#80a8d5"
              strokeDasharray="2 3"
            />
          ))}
          {shown.filter(visible).map((frame) => (
            <g
              key={frame}
              data-frame={frame}
              role="button"
              tabIndex={0}
              aria-label={`Select desired attack ${(frame / rate).toFixed(6)} seconds`}
              onClick={(e) => {
                e.stopPropagation();
                stopOutput();
                setSelected(frame);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelected(frame);
                }
                if (
                  !busy &&
                  !exit &&
                  !reset &&
                  step === 0 &&
                  (e.key === "ArrowLeft" || e.key === "ArrowRight")
                ) {
                  e.preventDefault();
                  const next =
                    frame +
                    (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? Math.round(rate * 0.001) : 1);
                  edit(() => {
                    session.setAttack(frame, next);
                    markerFocus.current = next;
                    setSelected(next);
                  });
                }
              }}
            >
              <rect x={x(frame) - 6} width="12" height="64" fill="transparent" />
              <line
                x1={x(frame)}
                x2={x(frame)}
                y1="0"
                y2="64"
                stroke={selected === frame ? "#fff" : "#74cf9a"}
                opacity={uncertain(frame) ? 0.35 : 1}
                strokeWidth="2"
              />
            </g>
          ))}
        </svg>
        <p>
          Source view {(low / rate).toFixed(4)}–{(high / rate).toFixed(4)} s · {shown.length}{" "}
          desired ·{" "}
          {calculated.pending
            ? "calculating…"
            : `${frames.filter((f) => f >= start && f < end).length} calculated (review detector)`}
        </p>
        <div className="training-tools">
          <label>
            Time zoom{" "}
            <input
              type="range"
              min="1"
              max="32"
              step="1"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
          <label>
            Navigate audio{" "}
            <input
              type="range"
              min="0"
              max="1"
              step=".01"
              value={offset}
              onChange={(e) => setOffset(Number(e.target.value))}
            />
          </label>
          <label>
            Waveform height{" "}
            <input
              type="range"
              min="1"
              max="16"
              step=".5"
              value={gain}
              onChange={(e) => setGain(Number(e.target.value))}
            />
          </label>
          <button
            onClick={() => {
              setZoom(1);
              setOffset(0);
              setGain(1);
            }}
          >
            Reset zoom
          </button>
        </div>
        <div className="training-tools">
          <button
            disabled={!auditioning && selectedVisible && !visible(selected!)}
            onClick={() => (auditioning ? stopOutput() : void audition())}
          >
            {auditioning ? "Stop audition" : "Audition source"}
          </button>
          <span>Selected attack (or view start) to visible end.</span>
        </div>
        {step === 0 && (
          <>
            <ol className="training-attacks" aria-label="Desired attacks">
              {shown.slice(activePage * 20, activePage * 20 + 20).map((frame) => (
                <li key={frame}>
                  <button
                    aria-pressed={selected === frame}
                    onClick={() => {
                      stopOutput();
                      setSelected(frame);
                    }}
                  >
                    {(frame / rate).toFixed(6)} s{uncertain(frame) ? " · uncertain" : ""}
                  </button>
                </li>
              ))}
            </ol>
            {shown.length > 20 && (
              <div className="training-tools">
                <button disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>
                  Earlier attacks
                </button>
                <span>Page {activePage + 1}</span>
                <button
                  disabled={(activePage + 1) * 20 >= shown.length}
                  onClick={() => setPage(activePage + 1)}
                >
                  Later attacks
                </button>
              </div>
            )}
            <div className="training-tools">
              <label>
                Desired attack source seconds{" "}
                <input
                  key={`${selected}:${revision}`}
                  type="number"
                  step={1 / rate}
                  min={start / rate}
                  max={(end - 1) / rate}
                  defaultValue={selectedVisible ? selected! / rate : ""}
                  onBlur={(e) => {
                    if (e.target.value === "") return;
                    const next = Math.round(Number(e.target.value) * rate);
                    edit(() => {
                      session.setAttack(selectedVisible ? selected : null, next);
                      setSelected(next);
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
              </label>
              {selectedVisible && (
                <>
                  <button
                    onClick={() =>
                      edit(() => {
                        session.setAttack(selected, selected! - 1);
                        setSelected(selected! - 1);
                      })
                    }
                  >
                    Earlier one sample
                  </button>
                  <button
                    onClick={() =>
                      edit(() => {
                        session.setAttack(selected, selected! + 1);
                        setSelected(selected! + 1);
                      })
                    }
                  >
                    Later one sample
                  </button>
                  <button
                    onClick={() =>
                      edit(() => {
                        session.setAttack(selected, null);
                        setSelected(null);
                      })
                    }
                  >
                    Remove desired attack
                  </button>
                </>
              )}
            </div>
            <p>
              Enter source seconds to add or move precisely. Focus a waveform marker and use ←/→ for
              one sample, Shift for 1 ms. Keyboard and touch controls do not pan or add implicitly.
            </p>
          </>
        )}
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
          <div className="training-summary">
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
              By choosing {session.overwrite ? "Overwrite" : "Add"}, you confirm you reviewed all
              attacks, including outside uncertain regions. New recordings remain unassigned until
              evaluation grouping is chosen.
            </p>
            <button disabled={!coverage.complete} onClick={() => void save()}>
              {session.overwrite ? "Overwrite training example" : "Add to training set"}
            </button>
            {afterSave && (
              <button onClick={() => setAfterSave(null)}>Cancel pending navigation</button>
            )}
          </div>
        )}
        {step < 2 && (
          <button
            onClick={() => {
              setStep(step + 1);
              setAdding(false);
            }}
          >
            Continue to {steps[step + 1]}
          </button>
        )}
      </fieldset>
      {reset && (
        <div role="dialog" aria-label="Reset desired attacks">
          <p>
            Replace desired attacks in this bar with current calculated hits? Your uncertainty
            regions remain. Undo is available.
          </p>
          <button
            disabled={calculated.pending || busy}
            onClick={() => {
              edit(() => session.reset(frames));
              setSelected(null);
              setReset(false);
            }}
          >
            Reset desired attacks
          </button>
          <button onClick={() => setReset(false)}>Keep desired attacks</button>
        </div>
      )}
      {exit && (
        <div role="dialog" aria-label="Unsaved training annotations">
          <p>Save this draft, discard it, or stay here?</p>
          <button
            onClick={() => {
              setAfterSave(() => exit);
              setExit(null);
              setStep(2);
              setAdding(false);
            }}
          >
            Save…
          </button>
          <button
            onClick={() => {
              const action = exit;
              setExit(null);
              action();
            }}
          >
            Discard
          </button>
          <button onClick={() => setExit(null)}>Stay</button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error} Your draft is retained.</p>}
    </section>
  );
}
