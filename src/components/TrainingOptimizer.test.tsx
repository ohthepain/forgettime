// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { TrainingOptimizer } from "./TrainingOptimizer";
import type { OptimizerRun } from "../audio/training-optimizer";
const edges = vi.hoisted(() => ({
  read: vi.fn(),
  assignGroups: vi.fn(),
  save: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../audio/training-dataset", () => ({
  createLocalTrainingRepository: () => ({ read: edges.read, assignGroups: edges.assignGroups }),
}));
vi.mock("../audio/training-optimizer-records", () => ({
  createOptimizerRunStore: () => ({ save: edges.save, list: edges.list, remove: edges.remove }),
}));
import { OPTIMIZER_BUILD } from "../audio/training-optimizer";
class FakeWorker {
  static last: FakeWorker;
  onmessage: ((event: { data: unknown }) => unknown) | null = null;
  onerror: unknown;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.last = this;
  }
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const fingerprint = "a".repeat(64);
function run(): OptimizerRun {
  return {
    format: "forgettime-optimizer-run",
    schemaVersion: 1,
    id: "11111111-1111-4111-8111-111111111111",
    version: "seeded-grid-v1",
    build: OPTIMIZER_BUILD,
    scoring: "source-onset-v1",
    envelope: "optimizer-common-envelope-v1",
    family: "current",
    mode: "quick",
    seed: 1,
    inputFingerprint: fingerprint,
    comparisonFingerprint: "b".repeat(64),
    assignments: { one: "training" },
    status: "cancelled",
    trials: [
      {
        order: 0,
        phase: "baseline",
        parameters: {
          family: "current",
          minimumRms: 0.002,
          contrastRatio: 1.8,
          minSeparationMs: 18,
          recoverySeconds: 4,
          frequencyBalance: 100,
        },
        resolved: [],
        score: {
          errorsPerSecond: 0,
          meanAbsoluteMs: null,
          biasMs: null,
          missingTimingGroups: 1,
          matched: 0,
          missing: 0,
          extra: 0,
          seconds: 1,
          recordings: 1,
          evidence: "training-only",
        },
      },
    ],
    bestOrder: 0,
    improved: false,
    elapsedMs: 42,
    frozenOrder: null,
    withheld: null,
  };
}
async function setup() {
  vi.stubGlobal("Worker", FakeWorker);
  edges.read.mockResolvedValue({
    fingerprint,
    dataset: { manifest: { groups: [{ id: "one", assignment: "training" }], examples: [{}] } },
  });
  edges.list.mockResolvedValue([]);
  edges.save.mockResolvedValue(undefined);
  const beforeStart = vi.fn().mockResolvedValue(undefined),
    runningChanged = vi.fn();
  const rendered = render(
    <TrainingOptimizer
      disabled={false}
      beforeStart={beforeStart}
      runningChanged={runningChanged}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Parameter optimization" }));
  await waitFor(() => expect(edges.list).toHaveBeenCalled());
  return { ...rendered, beforeStart, runningChanged };
}
it("stops audio before starting a local worker, shows progress, cancels and freezes before explicit withheld evaluation", async () => {
  const f = await setup();
  fireEvent.click(screen.getByRole("button", { name: "Start parameter search" }));
  await waitFor(() =>
    expect(FakeWorker.last.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "start",
        options: expect.objectContaining({ mode: "quick", seed: 1 }),
      }),
    ),
  );
  expect(f.beforeStart).toHaveBeenCalledOnce();
  expect(f.runningChanged).toHaveBeenCalledWith(true);
  await act(async () => {
    await FakeWorker.last.onmessage?.({
      data: {
        type: "progress",
        progress: { completed: 1, budget: 100, elapsedMs: 12, best: run().trials[0].score },
      },
    });
  });
  expect(screen.getByText(/1 \/ 100 trials completed/)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Cancel optimization" }));
  expect(FakeWorker.last.postMessage).toHaveBeenLastCalledWith({ type: "cancel" });
  await act(async () => {
    await FakeWorker.last.onmessage?.({ data: { type: "result", run: run() } });
  });
  expect(screen.getByText("This run is incomplete.", { exact: false })).toBeDefined();
  expect(
    (
      screen.getByRole("button", {
        name: "Evaluate frozen candidate on withheld recordings",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Freeze best candidate" }));
  await waitFor(() =>
    expect(edges.save).toHaveBeenLastCalledWith(expect.objectContaining({ frozenOrder: 0 })),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Evaluate frozen candidate on withheld recordings" }),
  );
  await waitFor(() =>
    expect(FakeWorker.last.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "withheld",
        run: expect.objectContaining({ frozenOrder: 0 }),
      }),
    ),
  );
});
it("stops for dataset edits and rejects late old-input results as stale", async () => {
  await setup();
  fireEvent.click(screen.getByRole("button", { name: "Start parameter search" }));
  await waitFor(() => expect(FakeWorker.last.postMessage).toHaveBeenCalled());
  edges.read.mockResolvedValue({
    fingerprint: "c".repeat(64),
    dataset: { manifest: { groups: [], examples: [] } },
  });
  fireEvent(window, new Event("forgettime-training-changed"));
  expect(FakeWorker.last.postMessage).toHaveBeenLastCalledWith({ type: "cancel", stale: true });
  await act(async () => {
    await FakeWorker.last.onmessage?.({ data: { type: "result", run: run() } });
  });
  expect(edges.save).toHaveBeenCalledWith(
    expect.objectContaining({ status: "stale", withheld: null }),
  );
  expect(
    (screen.getByRole("button", { name: "Freeze best candidate" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it("honors cancellation during preparation and does not launch a worker", async () => {
  const f = await setup();
  let release!: () => void;
  f.beforeStart.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start parameter search" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel optimization" }));
  await act(async () => release());
  expect(screen.getByText("Cancelled before evaluation began.")).toBeDefined();
  expect(f.runningChanged).toHaveBeenLastCalledWith(false);
});
