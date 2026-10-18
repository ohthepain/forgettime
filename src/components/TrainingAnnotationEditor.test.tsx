// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { webcrypto } from "node:crypto";
import { TrainingAnnotationEditor } from "./TrainingAnnotationEditor";
import { createTrainingRepository, type TrainingSnapshot } from "../audio/training-dataset";
import { DEFAULT_DETECTOR_SETTINGS } from "../audio/detector-contract";
import type { RecordedTake } from "../audio/recorded-take";

const detection = vi.hoisted(() => ({ hits: [{ time: 0.2 }], pending: false }));
vi.mock("../audio/use-import-detections", () => ({ useImportDetections: () => detection }));
const preview = vi.hoisted(() => ({ stop: vi.fn(), play: vi.fn().mockResolvedValue(true) }));
vi.mock("../audio/audio-region-preview", () => ({
  AudioRegionPreview: class {
    stop = preview.stop;
    play = preview.play;
  },
}));
afterEach(() => {
  cleanup();
  detection.hits = [{ time: 0.2 }];
  preview.stop.mockClear();
  preview.play.mockClear();
  vi.unstubAllGlobals();
});
function fixture(length = 40000) {
  vi.stubGlobal("crypto", webcrypto);
  const take: RecordedTake = {
    audio: { startFrame: 800, sampleRate: 8000, samples: new Float32Array(length) },
    source: "web",
    origin: 0.2,
    continuity: 1,
    settings: { bpm: 120, mode: "straight", startSensitivity: 50 },
    onsets: [],
    results: [],
    endReason: "stopped",
  };
  let data: TrainingSnapshot | null = null,
    fail = false;
  const clone = (snapshot: TrainingSnapshot | null) => {
    if (!snapshot) return null;
    const copy = structuredClone(snapshot);
    for (const [key, pcm] of Object.entries(copy.dataset.audio))
      copy.dataset.audio[key] = Float32Array.from(pcm);
    return copy;
  };
  const repository = createTrainingRepository({
    read: async () => clone(data),
    compareAndSwap: async (_, next) => {
      if (fail) throw new Error("quota failure");
      data = clone(next);
    },
  });
  const close = vi.fn(),
    props = {
      take,
      initialIndex: 0,
      settings: DEFAULT_DETECTOR_SETTINGS,
      balance: 100,
      onClose: close,
      repository,
    };
  return {
    ...render(<TrainingAnnotationEditor {...props} />),
    props,
    close,
    repository,
    fail: () => {
      fail = true;
    },
    recover: () => {
      fail = false;
    },
  };
}
async function ready() {
  await screen.findByRole("button", { name: "Add missing attacks" });
}
function seconds(value: string) {
  const input = screen.getByLabelText("Desired attack source seconds");
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}
it("edits precise attacks, uses keyboard nudges, preserves labels when calculated hits change, and supports explicit reset/Undo", async () => {
  const f = fixture();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "0.200000 s" }));
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Select desired attack 0.200000 seconds" }),
    { key: "ArrowRight" },
  );
  expect(screen.getByRole("button", { name: "0.200125 s" })).toBeDefined();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Select desired attack 0.200125 seconds" }),
  );
  seconds(".4");
  expect(screen.getByRole("button", { name: "0.400000 s" })).toBeDefined();
  detection.hits = [{ time: 0.6 }];
  f.rerender(<TrainingAnnotationEditor {...f.props} settings={{ ...DEFAULT_DETECTOR_SETTINGS }} />);
  expect(screen.getByRole("button", { name: "0.400000 s" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "0.600000 s" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reset desired attacks from detections…" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Reset desired attacks" })).getByRole("button", {
      name: "Reset desired attacks",
    }),
  );
  expect(screen.getByRole("button", { name: "0.600000 s" })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByRole("button", { name: "0.400000 s" })).toBeDefined();
});
it("requires explicit add mode and ignores a pan-like movement, supports source zoom and uncertainty endpoints", async () => {
  fixture();
  await ready();
  const svg = screen.getByRole("img");
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, width: 512 } as DOMRect);
  fireEvent.click(svg, { clientX: 100 });
  expect(screen.getAllByRole("button", { name: /^Select desired attack/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Add missing attacks" }));
  vi.stubGlobal("PointerEvent", MouseEvent);
  fireEvent.pointerDown(svg, { clientX: 50, clientY: 10 });
  fireEvent.pointerMove(svg, { clientX: 200, clientY: 10 });
  fireEvent.pointerUp(svg, { clientX: 200, clientY: 10 });
  fireEvent.click(svg, { clientX: 200, clientY: 10 });
  expect(screen.getAllByRole("button", { name: /^Select desired attack/ })).toHaveLength(1);
  fireEvent.pointerDown(svg, { clientX: 256, clientY: 10 });
  fireEvent.click(svg, { clientX: 256, clientY: 10 });
  expect(screen.getAllByRole("button", { name: /^Select desired attack/ })).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Time zoom"), { target: { value: "2" } });
  expect(screen.getByText(/Source view 0.1000–1.1000/)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "2. Mark uncertainty" }));
  fireEvent.change(screen.getByLabelText("Uncertain start seconds"), { target: { value: ".15" } });
  fireEvent.change(screen.getByLabelText("Uncertain end seconds"), { target: { value: ".3" } });
  fireEvent.click(screen.getByRole("button", { name: "Add uncertainty region" }));
  const endpoint = screen.getByLabelText("Region 1 end seconds");
  fireEvent.change(endpoint, { target: { value: ".4" } });
  fireEvent.blur(endpoint);
  expect((screen.getByLabelText("Region 1 end seconds") as HTMLInputElement).value).toBe("0.4");
});
it("guards close and bar navigation, retains a failed save, then commits reviewed annotations without a checkbox", async () => {
  const f = fixture();
  await ready();
  seconds(".4");
  fireEvent.click(screen.getByRole("button", { name: "Close annotation" }));
  expect(f.close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Stay" }));
  fireEvent.click(screen.getByRole("button", { name: "Next training bar" }));
  fireEvent.click(screen.getByRole("button", { name: "Save…" }));
  expect(screen.queryByRole("checkbox")).toBeNull();
  f.fail();
  fireEvent.click(screen.getByRole("button", { name: "Add to training set" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("quota failure"));
  expect((await f.repository.read()).dataset.manifest.examples).toHaveLength(0);
  expect(screen.getByText(/Desired source times: 0.200000, 0.400000/)).toBeDefined();
  f.recover();
  fireEvent.click(screen.getByRole("button", { name: "Add to training set" }));
  await waitFor(() => expect(screen.getByText("Bar 2 / 3")).toBeDefined(), {
    onTimeout: (error) =>
      new Error(error.message.slice(0, 150) + " :: " + document.body.textContent?.slice(-1800)),
  });
  const saved = (await f.repository.read()).dataset.manifest.examples[0];
  expect(saved.reviewed).toBe(true);
  expect(saved.desiredFrames).toEqual([1600, 3200]);
});
it("discards a draft only explicitly, and partial bars remain inspectable without submission", async () => {
  const f = fixture(8000);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "3. Review & save" }));
  expect(
    (screen.getByRole("button", { name: "Add to training set" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Close annotation" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(f.close).toHaveBeenCalledOnce();
  expect((await f.repository.read()).dataset.manifest.examples).toHaveLength(0);
});

it("auditions exact source selection and releases output on zoom, Escape and unmount", async () => {
  const f = fixture();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "0.200000 s" }));
  fireEvent.click(screen.getByRole("button", { name: "Audition source" }));
  await screen.findByRole("button", { name: "Stop audition" });
  expect(preview.play).toHaveBeenCalledWith(
    expect.objectContaining({ samples: f.props.take.audio.samples, sampleRate: 8000 }),
    0.2,
    2.1,
    expect.any(Function),
  );
  const calls = preview.stop.mock.calls.length;
  fireEvent.change(screen.getByLabelText("Time zoom"), { target: { value: "2" } });
  expect(preview.stop.mock.calls.length).toBeGreaterThan(calls);
  fireEvent.keyDown(window, { key: "Escape" });
  f.unmount();
  expect(preview.stop.mock.calls.length).toBeGreaterThan(calls + 1);
});
