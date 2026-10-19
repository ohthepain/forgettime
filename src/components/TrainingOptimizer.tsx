import { useTrainingSession } from "../lib/training-session";
import { useEffect, useRef, useState } from "react";
import { createLocalTrainingRepository } from "../audio/training-dataset";
import { createOptimizerRunStore } from "../audio/training-optimizer-records";
import {
  freezeOptimizerCandidate,
  OPTIMIZER_BUILD,
  type OptimizerRun,
  type OptimizerProgress,
  type OptimizerScore,
  type OptimizerFamily,
  type OptimizerParameters,
} from "../audio/training-optimizer";

function scoreText(score: OptimizerScore | null | undefined) {
  return score?.errorsPerSecond == null
    ? "Unavailable"
    : `${score.errorsPerSecond.toFixed(3)} errors/s · ${score.missing} missing · ${score.extra} extra · ${score.meanAbsoluteMs === null ? "timing unavailable" : `${score.meanAbsoluteMs.toFixed(2)} ms mean error`} · ${score.seconds.toFixed(2)} s evaluated`;
}
function parameterText(p: OptimizerParameters) {
  return p.family === "current"
    ? `Minimum level ${p.minimumRms} · contrast ${p.contrastRatio}× · separation ${p.minSeparationMs} ms · recovery ${p.recoverySeconds} s · frequency change ${p.frequencyBalance}%`
    : `${p.bands} mel bands · ${p.windowMs} ms window target · neighbor suppression ${p.neighbor === 1 ? "off" : p.neighbor + " bands"} · confirmation ${p.confirmation} hops · rearming ${p.rearming ? "on" : "off"} · threshold ${p.threshold}`;
}
export function TrainingOptimizer({
  disabled,
  beforeStart,
  runningChanged,
  starting,
  standalone = false,
}: {
  standalone?: boolean;
  disabled: boolean;
  starting?: OptimizerParameters;
  beforeStart: () => Promise<void>;
  runningChanged: (running: boolean) => void;
}) {
  const [open, setOpen] = useState(standalone),
    [family, setFamily] = useState<OptimizerFamily>("current"),
    [mode, setMode] = useState<"quick" | "deep">("quick"),
    [seed, setSeed] = useState("1");
  const [run, setRun] = useState<OptimizerRun | null>(null),
    [history, setHistory] = useState<OptimizerRun[]>([]),
    [progress, setProgress] = useState<OptimizerProgress | null>(null),
    [running, setRunning] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [fingerprint, setFingerprint] = useState("");
  const [exampleCount, setExampleCount] = useState(0);
  const preparingCancelled = useRef(false);
  const worker = useRef<Worker | null>(null),
    activeFingerprint = useRef(""),
    invalidated = useRef(false),
    mounted = useRef(true),
    runningCallback = useRef(runningChanged);
  runningCallback.current = runningChanged;
  useEffect(() => {
    mounted.current = true;
    const changed = (event: Event | MessageEvent) => {
      const announced = "data" in event ? event.data : (event as CustomEvent).detail;
      if (worker.current && announced === activeFingerprint.current) return;
      if (worker.current) {
        invalidated.current = true;
        worker.current.postMessage({ type: "cancel", stale: true });
        setNotice("Dataset changed. Stopping this run; start again with current inputs.");
      }
      void refresh();
    };
    const channel =
      typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("forgettime-training") : null;
    if (channel) channel.onmessage = changed;
    window.addEventListener("forgettime-training-changed", changed);
    async function refresh() {
      try {
        const snapshot = await createLocalTrainingRepository().read();
        if (mounted.current) setFingerprint(snapshot.fingerprint);
        setExampleCount(snapshot.dataset.manifest.examples.length);
      } catch (e) {
        if (mounted.current) setError((e as Error).message);
      }
    }
    return () => {
      mounted.current = false;
      worker.current?.terminate();
      worker.current = null;
      channel?.close();
      window.removeEventListener("forgettime-training-changed", changed);
      runningCallback.current(false);
    };
  }, []);
  useEffect(() => {
    if (standalone) void load();
  }, [standalone]);
  async function load() {
    try {
      const snapshot = await createLocalTrainingRepository().read(),
        records = await createOptimizerRunStore().list();
      if (mounted.current) {
        setFingerprint(snapshot.fingerprint);
        setExampleCount(snapshot.dataset.manifest.examples.length);
        setHistory(records);
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    }
  }
  async function persist(next: OptimizerRun) {
    setRun(next);
    try {
      await createOptimizerRunStore().save(next);
      await load();
      setNotice(
        next.status === "completed"
          ? "Run saved on this device."
          : `Incomplete run saved (${next.status}).`,
      );
    } catch (e) {
      setError(
        `${(e as Error).message}. The current run remains available here; prior records are retained.`,
      );
    }
  }
  async function start(withheld = false) {
    preparingCancelled.current = false;
    setError("");
    setNotice("");
    setProgress(null);
    setRunning(true);
    runningCallback.current(true);
    try {
      const capturedStarting = structuredClone(starting);
      const numericSeed = Number(seed);
      if (!Number.isInteger(numericSeed) || numericSeed < 0 || numericSeed > 0xffffffff)
        throw new Error("Use a whole seed between 0 and 4294967295");
      await beforeStart();
      const repository = createLocalTrainingRepository();
      let snapshot = await repository.read();
      if (
        !withheld &&
        snapshot.dataset.manifest.groups.some((g) => g.assignment === "unassigned")
      ) {
        await repository.assignGroups(snapshot.fingerprint, numericSeed);
        snapshot = await repository.read();
      }
      if (!snapshot.dataset.manifest.examples.length)
        throw new Error("Add reviewed complete training bars before starting a search");
      if (preparingCancelled.current) {
        setNotice("Cancelled before evaluation began.");
        setRunning(false);
        runningCallback.current(false);
        return;
      }
      activeFingerprint.current = snapshot.fingerprint;
      setFingerprint(snapshot.fingerprint);
      setExampleCount(snapshot.dataset.manifest.examples.length);
      invalidated.current = false;
      if (!withheld) setRun(null);
      const instance = new Worker(
        new URL("../audio/training-optimizer.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = instance;
      const finish = () => {
        instance.terminate();
        if (worker.current === instance) worker.current = null;
        if (mounted.current) {
          setRunning(false);
          runningCallback.current(false);
        }
      };
      instance.onerror = (event) => {
        setError(event.message || "Optimizer worker failed");
        finish();
      };
      instance.onmessage = async (event) => {
        if (!mounted.current || worker.current !== instance) return;
        if (event.data.type === "progress") {
          setProgress(event.data.progress);
          useTrainingSession.setState({
            progress: `${event.data.progress.completed} / ${event.data.progress.budget} trials`,
          });
          return;
        }
        if (event.data.type === "error") {
          setError(event.data.error);
          finish();
          return;
        }
        try {
          const current = await repository.read(),
            next = event.data.run as OptimizerRun;
          if (current.fingerprint !== activeFingerprint.current || invalidated.current) {
            next.status = "stale";
            next.withheld = null;
          }
          setFingerprint(current.fingerprint);
          await persist(next);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          finish();
        }
      };
      instance.postMessage(
        withheld
          ? { type: "withheld", dataset: snapshot.dataset, run }
          : {
              type: "start",
              dataset: snapshot.dataset,
              options: {
                family,
                mode,
                seed: numericSeed,
                ...(capturedStarting?.family === family ? { starting: capturedStarting } : {}),
              },
            },
      );
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
      runningCallback.current(false);
    }
  }
  const stale = Boolean(
    run &&
    (run.inputFingerprint !== fingerprint ||
      run.build !== OPTIMIZER_BUILD ||
      run.status === "stale"),
  );
  const best = run?.bestOrder == null ? null : run.trials[run.bestOrder],
    baseline = run?.trials[0];
  return (
    <section data-testid="parameter-optimizer" data-run-id={run?.id ?? ""} data-run-status={run?.status ?? ""} data-frozen={String(Boolean(run && run.frozenOrder !== null && run.frozenOrder === run.bestOrder))} data-withheld={String(Boolean(run?.withheld))} data-stale={String(stale)} data-profile-selected={notice.startsWith("Profile selected") ? run?.id : ""} className="training-editor" aria-label="Parameter optimization">
      {!standalone && (
        <button
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            if (!open) void load();
          }}
        >
          Parameter optimization
        </button>
      )}
      {open && (
        <>
          <p>
            Local searches use reviewed training recordings. Unassigned recording groups receive a
            stable split, with about 20% withheld when possible. All bars from one group stay
            together. Audio stays on this device; the microphone and Auto stop before a run.
          </p>
          <fieldset disabled={disabled || running || exampleCount === 0}>
            <div className="training-tools">
              <label>
                Detector family{" "}
                <select
                  value={family}
                  onChange={(e) => setFamily(e.target.value as OptimizerFamily)}
                >
                  <option value="current">Current detector</option>
                  <option value="mel">Experimental mel detector</option>
                </select>
              </label>
              <label>
                Search budget{" "}
                <select value={mode} onChange={(e) => setMode(e.target.value as "quick" | "deep")}>
                  <option value="quick">Quick · 100 trials</option>
                  <option value="deep">Deep · 500 trials</option>
                </select>
              </label>
              <label>
                Reproducibility seed{" "}
                <input
                  type="number"
                  min="0"
                  max="4294967295"
                  step="1"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                />
              </label>
              <button onClick={() => void start()}>Start parameter search</button>
            </div>
          </fieldset>
          <p>
            Budget is a trial count per family, including the baseline. Runtime depends on your
            audio and device. Candidates never become the live detector automatically.
          </p>
          <p>
            All candidates share the same exclusions for startup, incomplete tails, uncertainty and
            unavailable history. Scores without eligible reviewed time are unavailable.
          </p>
          {running && (
            <div role="status">
              <p>
                {progress
                  ? `${progress.completed} / ${progress.budget} trials completed · ${(progress.elapsedMs / 1000).toFixed(1)} s elapsed · best ${scoreText(progress.best)}`
                  : "Preparing local evaluation…"}
              </p>
              <button
                onClick={() => {
                  preparingCancelled.current = true;
                  worker.current?.postMessage({ type: "cancel" });
                  setNotice(
                    "Cancellation requested. Only fully evaluated candidates are retained.",
                  );
                }}
              >
                Cancel optimization
              </button>
            </div>
          )}
          {run && (
            <div data-testid="optimizer-results">
              <p>
                {run.family === "mel" ? "Mel" : "Current"} · {run.mode} · seed {run.seed} ·{" "}
                {run.status} · {run.trials.length} trials · {(run.elapsedMs / 1000).toFixed(1)} s
                {stale ? " · Outdated inputs or build" : ""}
              </p>
              <p>Baseline: {scoreText(baseline?.score)}</p>
              {baseline && <p>Baseline parameters: {parameterText(baseline.parameters)}</p>}
              <p>Best training candidate: {scoreText(best?.score)}</p>
              <p>
                {!baseline?.score
                  ? "No comparable training score is available."
                  : run.improved
                    ? "Training score improved over the baseline."
                    : "No improvement over the baseline."}{" "}
                {run.status !== "completed" ? "This run is incomplete." : ""}{" "}
                {best?.score?.evidence === "training-only"
                  ? "Training-only evidence."
                  : "Fewer than five recordings is preliminary evidence."}
              </p>
              {run.failure && <p role="alert">{run.failure}</p>}
              {best && (
                <>
                  <p>Candidate parameters: {parameterText(best.parameters)}</p>
                  <p>
                    Matched-onset bias:{" "}
                    {best.score?.biasMs == null
                      ? "Unavailable"
                      : `${best.score.biasMs >= 0 ? "+" : ""}${best.score.biasMs.toFixed(2)} ms`}
                  </p>
                </>
              )}
              <div className="training-tools">
                <button
                  data-testid="optimizer-use-profile"
                  disabled={
                    running ||
                    stale ||
                    !best ||
                    run.status !== "completed" ||
                    !best.score?.seconds ||
                    run.frozenOrder !== run.bestOrder
                  }
                  onClick={() => {
                    if (best) {
                      useTrainingSession.setState({
                        current: best.parameters,
                        adopt: best.parameters,
                      });
                      try {
                        localStorage.setItem(
                          "forgettime-training-profile",
                          JSON.stringify(best.parameters),
                        );
                      } catch {
                        setError(
                          "Profile selected for this session; browser storage could not save it.",
                        );
                      }
                      setNotice(
                        `Profile selected for dataset comparisons; evidence: ${best.score?.evidence || "unavailable"}. Current-detector profiles also apply to Practice review; live capture keeps shared defaults.`,
                      );
                    }
                  }}
                >
                  Use evaluated profile
                </button>
                <button
                  data-testid="optimizer-freeze-candidate"
                  disabled={running || disabled || stale || !best || run.status === "failed"}
                  onClick={() => {
                    try {
                      void persist(freezeOptimizerCandidate(run));
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Freeze best candidate
                </button>
                <button
                  data-testid="optimizer-evaluate-withheld"
                  disabled={running || disabled || stale || run.frozenOrder === null}
                  onClick={() => void start(true)}
                >
                  Evaluate frozen candidate on withheld recordings
                </button>
              </div>
              <p>
                Withheld evaluation is explicit and never ranks search trials. If its findings guide
                further tuning, use fresh withheld recordings before claiming independent
                improvement.
              </p>
              {run.withheld && (
                <p>
                  Frozen candidate withheld result: {scoreText(run.withheld)} ·{" "}
                  {run.withheld.evidence}
                </p>
              )}
              <details>
                <summary>Reproduction details</summary>
                <p>Run identifier: {run.id}</p>
                <p>Input fingerprint: {run.inputFingerprint}</p>
                <p>Detector build: {run.build}</p>
                <p>
                  Search version: {run.version}; scoring: {run.scoring}; window policy:{" "}
                  {run.envelope}
                </p>
              </details>
              <details>
                <summary>Ordered trials and resolved parameters</summary>
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Trial</th>
                        <th>Stage</th>
                        <th>Parameters</th>
                        <th>Training score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.trials.map((t) => (
                        <tr key={t.order}>
                          <td>{t.order + 1}</td>
                          <td>{t.phase}</td>
                          <td>
                            {JSON.stringify(t.parameters)}
                            <br />
                            {t.resolved
                              .map(
                                (r) =>
                                  `${r.sampleRate} Hz: window ${r.windowFrames}, hop ${r.hopFrames}`,
                              )
                              .join("; ")}
                          </td>
                          <td>{t.invalid ?? scoreText(t.score)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          )}
          {history.length > 0 && (
            <details data-testid="optimizer-saved-runs">
              <summary data-testid="optimizer-saved-runs-toggle">Saved runs ({history.length}/20)</summary>
              <ul data-testid="optimizer-run-list">
                {history.map((record) => (
                  <li key={record.id}>
                    <button disabled={running} onClick={() => setRun(record)}>
                      {record.family} · seed {record.seed} · {record.status} ·{" "}
                      {record.trials.length} trials
                      {record.inputFingerprint !== fingerprint || record.build !== OPTIMIZER_BUILD
                        ? " · outdated"
                        : ""}
                    </button>
                    <button
                      disabled={running}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Permanently delete this optimizer run record? Audio and annotations are kept.",
                          )
                        )
                          void createOptimizerRunStore()
                            .remove(record.id)
                            .then(load)
                            .catch((e) => setError(e.message));
                      }}
                    >
                      Delete run record
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p>
            Run records keep parameters, scores, assignments and fingerprints, without old
            annotations. Up to 20 runs / 8 MiB; existing records are never evicted. Reproduction
            needs the same inputs and detector build.
          </p>
          {notice && <p role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
