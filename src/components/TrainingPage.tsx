import { CircleCheck, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { createLocalTrainingRepository } from "../audio/training-dataset";
import type { TrainingDataset } from "../audio/training-transfer";
import { trainingBarFrames, trainingExampleId, type TrainingExample } from "../audio/training-contract";
import type { RecordedTake } from "../audio/recorded-take";
import { DEFAULT_DETECTOR_SETTINGS } from "../audio/detector-contract";
import {
  optimizerParametersSchema,
  parameterKey,
  type OptimizerParameters,
} from "../audio/training-optimizer";
import { trainingNavigation, useTrainingSession } from "../lib/training-session";
import { TrainingOptimizer } from "./TrainingOptimizer";
import { TrainingAnnotationEditor } from "./TrainingAnnotationEditor";
import { WaveformDisplay } from "./WaveformDisplay";

type Results = {
  key: string;
  onsets: Record<string, number[]>;
  scores: Record<string, { matched: number; missing: number; extra: number; seconds: number; missingFrames?: number[]; extraFrames?: number[]; matchedFrames?: number[] }>;
};
const repository = () => createLocalTrainingRepository();
export function trainingExampleTake(
  dataset: TrainingDataset,
  example: TrainingExample,
): { take: RecordedTake; index: number } {
  const source = dataset.manifest.sources.find((s) => s.checksum === example.sourceChecksum)!;
  return {
    index: Math.round(
      (example.bar.startFrame - example.reference.beatOneFrame) /
        ((source.sampleRate * 240) / example.reference.bpm),
    ),
    take: {
      source: "imported",
      continuity: 0,
      origin: example.reference.beatOneFrame / source.sampleRate,
      settings: { bpm: example.reference.bpm, mode: "auto", startSensitivity: 50 },
      audio: {
        startFrame: 0,
        sampleRate: source.sampleRate,
        samples: dataset.audio[source.checksum],
      },
      provenance: { kind: source.provenance.kind, name: source.provenance.name },
      onsets: [],
      results: [],
      endReason: "stopped",
    },
  };
}
export function TrainingPage({ active = true }: { active?: boolean } = {}) {
  const pendingSamples = useTrainingSession(state => state.samples);
  const importReport = useTrainingSession(state => state.importReport);
  const [duplicates, setDuplicates] = useState<string[]>([]);
  const duplicateDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (importReport.duplicates.length) setDuplicates([...importReport.duplicates]);
  }, [importReport]);
  useEffect(() => {
    if (!duplicates.length) return;
    const dialog = duplicateDialog.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, [duplicates]);
  const annotating = useTrainingSession(s => s.annotating);
  const importing = useTrainingSession(s => s.importing);
  const current = useTrainingSession((s) => s.current);
  const [showImport, setShowImport] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [tab, setTab] = useState<"dataset" | "optimization">("dataset");
  const [snapshot, setSnapshot] =
    useState<Awaited<ReturnType<ReturnType<typeof repository>["read"]>>>();
  const [attack, setAttack] = useState<number | null>(null);
  const [selected, setSelected] = useState(""),
    [filter, setFilter] = useState("");
  const [profile, setProfile] = useState<OptimizerParameters>(current);
  const [profileName, setProfileName] = useState("Current settings");
  const [result, setResult] = useState<Results>(),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [editingChecksum, setEditingChecksum] = useState("");
  const [editingMaterial, setEditingMaterial] = useState<ReturnType<typeof trainingExampleTake> | null>(null);
  const [editing, setEditing] = useState(false),
    [closeRequest, setCloseRequest] = useState(0);
  const pendingLeave = useRef<((allowed: boolean) => void) | null>(null);
  const [recalculate, setRecalculate] = useState(0);
  const [savedProfile, setSavedProfile] = useState<OptimizerParameters | null>(null);
  const worker = useRef<Worker | null>(null);
  const running = useTrainingSession((s) => s.running),
    progress = useTrainingSession((s) => s.progress);
  async function refresh() {
    try {
      const next = await repository().read();
      setSnapshot(next);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    try {
      const saved = optimizerParametersSchema.safeParse(
        JSON.parse(localStorage.getItem("forgettime-training-profile") || "null"),
      );
      if (saved.success) setSavedProfile(saved.data);
    } catch {
      /* No selected profile. */
    }
    const changed = () => {
      void refresh();
    };
    const channel =
      typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("forgettime-training") : null;
    if (channel) channel.onmessage = changed;
    window.addEventListener("forgettime-training-changed", changed);
    return () => {
      channel?.close();
      window.removeEventListener("forgettime-training-changed", changed);
    };
  }, []);
  const adopted = useTrainingSession((s) => s.adopt);
  useEffect(() => {
    if (adopted) setSavedProfile(adopted);
  }, [adopted]);
  useEffect(() => {
    if (profileName === "Current settings") setProfile(current);
  }, [current, profileName]);
  useEffect(() => {
    if (!active) return;
    trainingNavigation.guards.set("training", async () =>
      !editing ||
      (await new Promise<boolean>((resolve) => {
        pendingLeave.current = resolve;
        setCloseRequest((n) => n + 1);
      })));
    return () => {
      trainingNavigation.guards.delete("training");
    };
  }, [active, editing]);
  const key = snapshot ? snapshot.fingerprint + parameterKey(profile) : "";
  useEffect(() => {
    if (!active || !snapshot?.dataset.manifest.examples.length) {
      setPending(false);
      return;
    }
    let closed = false;
    const instance = new Worker(
      new URL("../audio/training-inspection.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = instance;
    setPending(true);
    instance.onmessage = (event) => {
      if (closed) return;
      if (event.data.error) setError(event.data.error);
      else setResult({ ...event.data, key });
      setPending(false);
      instance.terminate();
    };
    instance.onerror = (event) => {
      if (closed) return;
      setError(event.message || "Comparison failed");
      setPending(false);
      instance.terminate();
    };
    instance.postMessage({ dataset: snapshot.dataset, parameters: profile });
    return () => {
      closed = true;
      instance.terminate();
      worker.current = null;
    };
  }, [active, key, recalculate]);
  const examples = snapshot?.dataset.manifest.examples ?? [];
  const example = examples.find((e) => e.id === selected);
  const source = snapshot?.dataset.manifest.sources.find(
    (s) => s.checksum === example?.sourceChecksum,
  );
  const audio = useMemo(
    () =>
      source && snapshot
        ? {
            samples: snapshot.dataset.audio[source.checksum],
            sampleRate: source.sampleRate,
            channels: 1,
          }
        : null,
    [source, snapshot],
  );
  const editable = useMemo(
    () => (snapshot && example ? trainingExampleTake(snapshot.dataset, example) : null),
    [snapshot, example],
  );
  const stale = pending || result?.key !== key;
  const score = example && !stale ? result?.scores[example.id] : undefined;
  const barIndex = editable?.index ?? 0;
  const lastBarIndex = example && audio ? Math.max(0, Math.ceil((audio.samples.length - example.reference.beatOneFrame) / ((audio.sampleRate * 240) / example.reference.bpm)) - 1) : 0;
  function selectBar(index: number) {
    if (!example || !audio || index < 0 || index > lastBarIndex) return;
    const next = examples.find(item => item.sourceChecksum === example.sourceChecksum && Math.round((item.bar.startFrame - item.reference.beatOneFrame) / ((audio.sampleRate * 240) / item.reference.bpm)) === index);
    if (next) { setSelected(next.id); setAttack(null); }
    else if (editable) { setEditingMaterial({ ...editable, index }); setEditingChecksum(example.sourceChecksum); setEditing(true); }
  }
  async function removeFile(checksum = source?.checksum) {
    if (!checksum || !snapshot) return;
    setRemoving(true);
    try {
      await repository().deleteSource(checksum, snapshot.fingerprint, true);
      setSelected('');
      setEditing(false);
      setEditingMaterial(null);
      await refresh();
    } catch (cause) { setError((cause as Error).message); }
    finally { setRemoving(false); }
  }
  async function exportDataset() {
    try {
      const bytes = await repository().exportFile();
      const url = URL.createObjectURL(new Blob([bytes]));
      const link = document.createElement("a");
      link.href = url;
      link.download = "forgettime-training.forget-training";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main data-testid="training-page" className="app-shell training-page">
      <header className="app-header">
        <Link to="/">← Back to practice</Link>
        <h1>Training</h1>
      </header>
      <p>Audio and training data stay on this device.</p>
      {running && (
        <p role="status">
          Optimization running · {progress || "Preparing…"} · continues when you return to Practice.
        </p>
      )}
      <div role="tablist" aria-label="Training tools" className="training-tabs">
        <button
          role="tab"
          data-testid="training-dataset-tab" aria-selected={tab === "dataset"}
          disabled={editing || annotating || importing}
          onClick={() => setTab("dataset")}
        >
          Data
        </button>
        <button
          role="tab"
          data-testid="training-optimization-tab"
          aria-selected={tab === "optimization"}
          disabled={editing || annotating || importing}
          onClick={() => setTab("optimization")}
        >
          Optimization
        </button>
      </div>
      <section hidden={tab !== "dataset"} aria-label="Training dataset">
        <div className="training-file-list-heading">
          <h2>Samples</h2>
          <button data-testid="import-audio" aria-label="Add new sample" title="Add new sample" disabled={editing || annotating || importing} onClick={() => { setShowImport(true); setSelected(''); trainingNavigation.importAudio?.(); }}><Plus size={20} /></button>
        </div>
        {snapshot && <>
          {(examples.length > 0 || pendingSamples.length > 0) && <label>Filter files <input data-testid="training-recording-filter" value={filter} onChange={event => setFilter(event.target.value)} /></label>}
          <ul data-testid="training-files-list" className="training-example-list" aria-label="Training files">
            {snapshot.dataset.manifest.sources.filter(file => examples.some(example => example.sourceChecksum === file.checksum)).filter(file => (file.provenance.name || 'Recorded take').toLowerCase().includes(filter.toLowerCase())).map((file, index) => {
              const bars = examples.filter(example => example.sourceChecksum === file.checksum);
              return <li key={file.checksum}><button data-testid="training-example" data-example-id={bars[0].id} disabled={editing || annotating || importing} aria-pressed={!showImport && source?.checksum === file.checksum} onClick={() => { setShowImport(false); setSelected(bars[0].id); setAttack(null); }}>
                {file.provenance.name || `Recording ${index + 1}`} <span>· {bars.length} {bars.length === 1 ? 'bar' : 'bars'}</span> <CircleCheck role="img" className="training-included" aria-label="Included in training dataset" size={18} />
              </button></li>;
            })}
            {pendingSamples.filter(sample => !snapshot.dataset.manifest.sources.some(source => source.checksum === sample.checksum)).filter(sample => sample.name.toLowerCase().includes(filter.toLowerCase())).map(sample => <li key={sample.checksum}>
              <button disabled={editing || annotating || importing} onClick={() => { setShowImport(true); setSelected(''); void trainingNavigation.openSample?.(sample.checksum); }}>{sample.name} <span className="training-new-pill">New</span></button>
            </li>)}
          </ul>
          {importReport.errors.length > 0 && <div role="alert">{importReport.errors.map((failure, index) => <p key={index}>{failure.name}: {failure.message}</p>)}</div>}
        </>}
        <section id="training-import-panel" hidden={!showImport || editing} className="training-import-panel" aria-label="Selected sample" />
        {!snapshot && !error && <p role="status">Loading training data…</p>}
        {snapshot && !examples.length && !pendingSamples.length && !editing && !annotating && (
          <div className="training-empty">
            <h2>No training examples yet</h2>
            <p>
              Use + to add a sample, choose a complete bar, and save its desired attacks.
            </p>
            <Link to="/">Or record a new take in Practice</Link>
          </div>
        )}
        {!editing && !annotating && (
          <div className="training-tools">
            <button disabled={!examples.length} onClick={() => void exportDataset()}>
              Export dataset
            </button>
          </div>
        )}
        {example && !showImport && !editing && !annotating && (
          <>
            <label>
              Comparison profile{" "}
              <select
                data-testid="training-comparison-profile"
                value={profileName}
                onChange={(e) => {
                  setProfileName(e.target.value);
                  setProfile(e.target.value === "Current settings" ? current : savedProfile!);
                }}
              >
                <option>Current settings</option>
                {savedProfile && <option>Selected optimized profile</option>}
              </select>
            </label>
            <details>
              <summary>Profile parameters</summary>
              <pre>{JSON.stringify(profile, null, 2)}</pre>
            </details>
            <p>
              {pending
                ? "Calculating hits… Previous comparison is stale."
                : stale
                  ? "Comparison stale or unavailable."
                  : "Calculated hits use the selected profile. Desired hits are authoritative."}{" "}
              <button disabled={pending} onClick={() => setRecalculate((n) => n + 1)}>
                Recalculate
              </button>
            </p>

          </>
        )}
        {example && audio && !showImport && !editing && !annotating && !importing && (
          <div data-testid="training-comparison" data-state={pending ? "calculating" : stale ? "stale" : "ready"} className="training-comparison">
            <div className="training-file-heading training-comparison-heading">
              <h2>{source?.provenance.name || 'Recorded take'}</h2>
              <CircleCheck role="img" className="training-included" aria-label="Included in training dataset" size={22} />
              <nav className="training-bar-selector" aria-label="Training bars">
                <button aria-label="Previous training bar" disabled={barIndex === 0} onClick={() => selectBar(barIndex - 1)}>{"<"}</button>
                <span aria-live="polite">Bar {barIndex + 1} / {lastBarIndex + 1}</span>
                <button aria-label="Next training bar" disabled={barIndex >= lastBarIndex} onClick={() => selectBar(barIndex + 1)}>{">"}</button>
              </nav>
              <button className="training-file-remove" aria-label="Remove file from training dataset" title="Remove file and all its training bars" disabled={removing} onClick={() => void removeFile()}><Trash2 size={18} /></button>
            </div>
            <WaveformDisplay
              audio={audio}
              range={{
                start: Math.max(0, example.bar.startFrame),
                end: Math.min(audio.samples.length, example.bar.endFrame),
              }}
              markers={[
                ...example.desiredFrames.map((frame) => ({ frame, kind: "desired" as const, outcome: score?.missingFrames?.includes(frame) ? "missing" as const : undefined })),
                ...(!stale ? (result?.onsets[example.sourceChecksum] ?? []) : [])
                  .filter(
                    (frame) => frame >= example.bar.startFrame && frame < example.bar.endFrame,
                  )
                  .map((frame) => ({ frame, kind: "calculated" as const, outcome: score?.extraFrames?.includes(frame) ? "extra" as const : score?.matchedFrames?.includes(frame) ? "correct" as const : undefined })),
              ]}
              isBarIncluded={index => examples.some(item => item.id === trainingExampleId(example.sourceChecksum, trainingBarFrames(audio.sampleRate, example.reference.bpm, example.reference.beatOneFrame, index)))}
              onSelectBar={selectBar}
              selectedFrame={attack}
              onSelect={setAttack}
              contextKey={example.id + key + tab + String(active)}
              uncertainRegions={example.uncertain.map((r) => ({
                start: r.startFrame,
                end: r.endFrame,
              }))}
              grid={{ bpm: example.reference.bpm, beatOneFrame: example.reference.beatOneFrame }}
              scope="annotation"
            />
            <p>
              {score && score.seconds > 0
                ? `${score.matched} matched · ${score.missing} missing · ${score.extra} extra · ${score.seconds.toFixed(2)} s evaluated`
                : "No current eligible scoring coverage."}
            </p>
            <small>
              Scoring excludes startup, incomplete coverage, uncertainty and duplicate source
              coverage. Matching tolerance: 20 ms.
            </small>
            <button onClick={() => { setEditingMaterial(editable); setEditingChecksum(example.sourceChecksum); setEditing(true) }}>Edit attacks</button>
          </div>
        )}
        {editing && editingMaterial && <div className="training-file-heading"><h2>{editingMaterial.take.provenance?.name || 'Recorded take'}</h2>{examples.some(example => example.sourceChecksum === editingChecksum) ? <><CircleCheck role="img" className="training-included" aria-label="Included in training dataset" size={22} /><button aria-label="Remove file from training dataset" disabled={removing} onClick={() => void removeFile(editingChecksum)}><Trash2 size={18} /></button></> : <span className="training-new-pill">New</span>}</div>}
        {editing && editingMaterial && (
          <TrainingAnnotationEditor
            take={editingMaterial.take}
            initialIndex={editingMaterial.index}
            settings={
              profile.family === "current"
                ? {
                    version: 1,
                    minimumRms: profile.minimumRms,
                    contrastRatio: profile.contrastRatio,
                    minSeparationMs: profile.minSeparationMs,
                    recoverySeconds: profile.recoverySeconds,
                  }
                : DEFAULT_DETECTOR_SETTINGS
            }
            balance={profile.family === "current" ? profile.frequencyBalance : 100}
            closeRequest={closeRequest}
            onStay={() => {
              pendingLeave.current?.(false);
              pendingLeave.current = null;
            }}
            onClose={() => {
              setEditing(false);
            setEditingMaterial(null);
              pendingLeave.current?.(true);
              pendingLeave.current = null;
              void refresh();
            }}
          />
        )}
      </section>
      <section hidden={tab !== "optimization"} aria-label="Optimization">
        <TrainingOptimizer standalone starting={current} disabled={editing || annotating || importing} beforeStart={async () => {}} runningChanged={running => useTrainingSession.setState({ running })} />
      </section>
      {duplicates.length > 0 && <dialog ref={duplicateDialog} className="training-duplicate-dialog" aria-labelledby="training-duplicate-title" onCancel={() => setDuplicates([])}>
        <h2 id="training-duplicate-title">Duplicates skipped</h2>
        <p>These files were already loaded or included in training and were not imported again.</p>
        <ul>{duplicates.map((name, index) => <li key={index}>{name}</li>)}</ul>
        <button autoFocus onClick={() => { duplicateDialog.current?.close(); setDuplicates([]); }}>Close</button>
      </dialog>}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
