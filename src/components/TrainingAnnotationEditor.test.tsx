// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
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
const dialogMethods = {
  showModal: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"),
  close: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close"),
};
beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  cleanup();
  detection.hits = [{ time: 0.2 }];
  preview.stop.mockClear();
  preview.play.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const name of ["showModal", "close"] as const) {
    const descriptor = dialogMethods[name];
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
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
  await screen.findByRole("button", { name: "Select desired attack 0.200000 seconds" }, { timeout: 5000 });
}
function seconds(value: string) {
  const svg = screen.getByRole("img");
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, width: 512 } as DOMRect);
  fireEvent.click(svg, { clientX: (Number(value) - .1) / 2 * 512 });
}
it("nudges to zero crossings and preserves source annotations when calculated hits change", async () => {
  const f = fixture();
  f.props.take.audio.samples[1600] = -1;
  f.props.take.audio.samples[1601] = 1;
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Select desired attack 0.200000 seconds" }));
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Select desired attack 0.200000 seconds" }),
    { key: "ArrowRight" },
  );
  expect(screen.getByRole("button", { name: "Select desired attack 0.200125 seconds" })).toBeDefined();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Select desired attack 0.200125 seconds" }),
  );
  seconds(".4");
  expect(screen.getByRole("button", { name: "Select desired attack 0.400000 seconds" })).toBeDefined();
  detection.hits = [{ time: 0.6 }];
  f.rerender(<TrainingAnnotationEditor {...f.props} settings={{ ...DEFAULT_DETECTOR_SETTINGS }} />);
  expect(screen.getByRole("button", { name: "Select desired attack 0.400000 seconds" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "Select desired attack 0.600000 seconds" })).toBeNull();

});
it("adds on a waveform click and ignores a pan-like movement, supports source zoom and uncertainty endpoints", async () => {
  fixture();
  await ready();
  const svg = screen.getByRole("img");
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, width: 512 } as DOMRect);
  expect(screen.getAllByRole("button", { name: /^Select desired attack/ })).toHaveLength(1);
  vi.stubGlobal("PointerEvent", MouseEvent);
  fireEvent.pointerDown(svg, { clientX: 50, clientY: 10 });
  fireEvent.pointerMove(svg, { clientX: 200, clientY: 10 });
  fireEvent.pointerUp(svg, { clientX: 200, clientY: 10 });
  fireEvent.click(svg, { clientX: 200, clientY: 10 });
  expect(screen.getAllByRole("button", { name: /^Select desired attack/ })).toHaveLength(1);
  fireEvent.pointerDown(svg, { clientX: 256, clientY: 10 });
  fireEvent.click(svg, { clientX: 256, clientY: 10 });
  expect(screen.getAllByRole("button", { name: /^Select desired attack/ })).toHaveLength(2);
  fireEvent.keyDown(screen.getByRole("slider", { name: "Visible annotation passage" }), {
    key: "+",
  });
  expect(screen.getByText(/Source view 0.6000–1.6000/)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Mark uncertainty" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Stay" }));
  f.fail();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.queryByRole("checkbox")).toBeNull();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("quota failure"));
  expect((await f.repository.read()).dataset.manifest.examples).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Next training bar" }));
  expect(screen.getByRole("dialog", { name: "Unsaved training annotations" })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Stay" }));
  expect(screen.getByText(/Desired source times: 0.200000, 0.400000/)).toBeDefined();
  f.recover();
  fireEvent.click(screen.getByRole("button", { name: "Add to training set" }));
  await waitFor(() => expect(screen.getByText("Training example saved on this device.")).toBeDefined(), {
    onTimeout: (error) =>
      new Error(error.message.slice(0, 150) + " :: " + document.body.textContent?.slice(-1800)),
  });
  const saved = (await f.repository.read()).dataset.manifest.examples[0];
  expect(saved.reviewed).toBe(true);
  expect(saved.desiredFrames).toEqual([1600, 3200]);
});
it("closes incomplete bars without a save/discard prompt or training submission", async () => {
  const f = fixture(8000);
  await ready();
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Exclude training bar" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close annotation" }));
  expect(screen.queryByRole("dialog", { name: "Unsaved training annotations" })).toBeNull();
  expect(f.close).toHaveBeenCalledOnce();
  expect((await f.repository.read()).dataset.manifest.examples).toHaveLength(0);
});

it("auditions exact source selection and releases output on zoom, Escape and unmount", async () => {
  const f = fixture();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Select desired attack 0.200000 seconds" }));
  fireEvent.click(screen.getByTestId("annotation-marker-play"));
  await screen.findByRole("button", { name: "Stop audio preview" });
  expect(preview.play).toHaveBeenCalledWith(
    expect.objectContaining({ samples: f.props.take.audio.samples, sampleRate: 8000 }),
    0.2,
    2.1,
    expect.any(Function),
  );
  const calls = preview.stop.mock.calls.length;
  fireEvent.keyDown(screen.getByRole("slider", { name: "Visible annotation passage" }), {
    key: "+",
  });
  expect(preview.stop.mock.calls.length).toBeGreaterThan(calls);
  fireEvent.keyDown(window, { key: "Escape" });
  f.unmount();
  expect(preview.stop.mock.calls.length).toBeGreaterThan(calls + 1);
});

it("zooms and navigates through the overview without changing source attacks or the tempo reference", async () => {
  fixture();
  await ready();
  vi.stubGlobal("PointerEvent", MouseEvent);
  const detail = screen.getByRole("img");
  const overview = screen.getByRole("slider", { name: "Visible annotation passage" });
  for (const element of [detail, overview])
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ left: 0, width: 512 } as DOMRect);
  expect(screen.queryByLabelText("Time zoom")).toBeNull();
  expect(screen.queryByLabelText("Navigate audio")).toBeNull();
  expect(screen.queryByLabelText("Waveform height")).toBeNull();
  fireEvent.pointerDown(detail, { clientX: 256, clientY: 100 });
  fireEvent.pointerMove(detail, { clientX: 256, clientY: 0 });
  fireEvent.pointerUp(detail, { clientX: 256, clientY: 0 });
  fireEvent.click(detail, { clientX: 256, clientY: 0 });
  expect(Number(overview.getAttribute("aria-valuenow"))).toBeGreaterThan(0.1);
  expect(screen.getByText(/1 desired/)).toBeDefined();
  fireEvent.keyDown(overview, { key: "End" });
  const right = Number(overview.getAttribute("aria-valuenow"));
  fireEvent.pointerDown(overview, { clientX: 256, clientY: 30 });
  fireEvent.pointerMove(overview, { clientX: 100, clientY: 30 });
  fireEvent.pointerUp(overview, { clientX: 100, clientY: 30 });
  expect(Number(overview.getAttribute("aria-valuenow"))).toBeLessThan(right);
  const position = overview.getAttribute("aria-valuenow");
  fireEvent.pointerDown(overview, { clientX: 100, clientY: 100 });
  fireEvent.pointerMove(overview, { clientX: 100, clientY: 0 });
  fireEvent.pointerUp(overview, { clientX: 100, clientY: 0 });
  expect(overview.getAttribute("aria-valuenow")).toBe(position);
  expect(screen.getByText(/1 desired/)).toBeDefined();
  expect((screen.getByLabelText("Tempo BPM") as HTMLInputElement).value).toBe("120");
  fireEvent.keyDown(screen.getByRole("slider", { name: "Visible annotation passage" }), {
    key: "0",
  });
  expect(screen.getByText(/Source view 0.0000–5.0000/)).toBeDefined();
});

it("opens unsaved changes as a modal and treats Escape as Stay", async () => {
  const f = fixture();
  await ready();
  seconds(".4");
  fireEvent.click(screen.getByRole("button", { name: "Close annotation" }));
  const dialog = screen.getByRole("dialog", { name: "Unsaved training annotations" });
  expect(dialog.tagName).toBe("DIALOG");
  expect(dialog.hasAttribute("open")).toBe(true);
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog", { name: "Unsaved training annotations" })).toBeNull();
  expect(f.close).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Select desired attack 0.400000 seconds" })).toBeDefined();
});

it("exposes a marker play control on hover and keyboard focus without changing desired attacks", async () => {
  detection.hits = [{ time: 0.2 }, { time: 0.6 }, { time: 1.4 }];
  const f = fixture();
  await ready();
  vi.stubGlobal("PointerEvent", MouseEvent);
  const detail = screen.getByRole("img");
  vi.spyOn(detail, "getBoundingClientRect").mockReturnValue({ left: 0, width: 512 } as DOMRect);
  fireEvent.pointerMove(detail, { clientX: 26, clientY: 20 });
  const play = screen.getByRole("button", {
    name: "Play from 0.200000 seconds to 0.600000 seconds",
  });
  fireEvent.pointerMove(detail, { clientX: 42, clientY: 40 });
  expect(play.isConnected).toBe(true);
  fireEvent.click(play);
  await screen.findByRole("button", { name: "Stop audio preview" });
  expect(preview.play).toHaveBeenCalledWith(
    expect.objectContaining({ samples: f.props.take.audio.samples }),
    0.2,
    0.6,
    expect.any(Function),
  );
  fireEvent.click(screen.getByRole("button", { name: "Stop audio preview" }));
  fireEvent.pointerLeave(detail.parentElement!);
  const marker = screen.getByRole("button", { name: "Select desired attack 0.600000 seconds" });
  fireEvent.focus(marker);
  expect(
    screen.getByRole("button", { name: "Play from 0.600000 seconds to 1.400000 seconds" }),
  ).toBeDefined();
  expect(
    screen.getAllByRole("button", { name: /^Select desired attack/ }),
  ).toHaveLength(3);
});

it("selects attack slices in either drag direction and auditions that range without editing annotations", async () => {
  detection.hits = [{ time: 0.2 }, { time: 0.6 }, { time: 1.4 }];
  const f = fixture();
  await ready();
  vi.stubGlobal("PointerEvent", MouseEvent);
  const detail = screen.getByRole("img");
  vi.spyOn(detail, "getBoundingClientRect").mockReturnValue({ left: 0, width: 512 } as DOMRect);
  for (const [from, to] of [
    [80, 180],
    [180, 80],
  ]) {
    fireEvent.pointerDown(detail, { clientX: from, clientY: 20 });
    fireEvent.pointerMove(detail, { clientX: to, clientY: 20 });
    fireEvent.pointerUp(detail, { clientX: to, clientY: 20 });
    fireEvent.click(detail, { clientX: to, clientY: 20 });
    expect(screen.getByTestId("annotation-playback-selection")).toBeDefined();
    expect(screen.getByTestId("annotation-marker-play").getAttribute("aria-label")).toBe(
      "Play from 0.200000 seconds to 1.400000 seconds",
    );
    fireEvent.click(screen.getByTestId("annotation-marker-play"));
    await screen.findByRole("button", { name: "Stop audio preview" });
    expect(preview.play).toHaveBeenLastCalledWith(
      expect.objectContaining({ samples: f.props.take.audio.samples, sampleRate: 8000 }),
      0.2,
      1.4,
      expect.any(Function),
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Select desired attack 0.200000 seconds" }), { key: "Enter" });
    expect(screen.queryByTestId("annotation-playback-selection")).toBeNull();
  }
  expect(
    screen.getAllByRole("button", { name: /^Select desired attack/ }),
  ).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByText(/Uncertain source ranges: None/)).toBeDefined();
});

it("ignores late playback completion after Stop", async () => {
  let complete!: (value: boolean) => void;
  preview.play.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        complete = resolve;
      }),
  );
  fixture();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Select desired attack 0.200000 seconds" }));
  fireEvent.click(screen.getByTestId("annotation-marker-play"));
  fireEvent.click(screen.getByRole("button", { name: "Stop audio preview" }));
  complete(true);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Stop audio preview" })).toBeNull(),
  );
});

it("cancels a dragged playback selection without placing a desired attack", async () => {
  fixture();
  await ready();
  vi.stubGlobal("PointerEvent", MouseEvent);
  const detail = screen.getByRole("img");
  vi.spyOn(detail, "getBoundingClientRect").mockReturnValue({ left: 0, width: 512 } as DOMRect);
  fireEvent.pointerDown(detail, { clientX: 80, clientY: 20 });
  fireEvent.pointerMove(detail, { clientX: 180, clientY: 20 });
  expect(screen.getByTestId("annotation-playback-selection")).toBeDefined();
  fireEvent.pointerCancel(detail, { clientX: 180, clientY: 20 });
  fireEvent.click(detail, { clientX: 180, clientY: 20 });
  expect(screen.queryByTestId("annotation-playback-selection")).toBeNull();
  expect(
    screen.getAllByRole("button", { name: /^Select desired attack/ }),
  ).toHaveLength(1);
});

it("saves from attack correction without visiting optional uncertainty tools", async () => {
  const f = fixture();
  await ready();
  const tools = screen.getByRole("navigation", { name: "Annotation tools" });
  expect(within(tools).getByRole("button", { name: "Mark uncertainty" })).toBeDefined();
  fireEvent.click(within(tools).getByRole("button", { name: "Save" }));
  expect(screen.queryByLabelText("Uncertain start seconds")).toBeNull();
  await screen.findByText("Training example saved on this device.");
  const saved = (await f.repository.read()).dataset.manifest.examples[0];
  expect(saved.reviewed).toBe(true);
  expect(saved.desiredFrames).toEqual([1600]);
  expect(saved.uncertain).toEqual([]);
});

it("Save persists annotations and allows next-bar navigation without a draft prompt", async () => {
  const f = fixture();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Training example saved on this device.");
  expect((await f.repository.read()).dataset.manifest.examples).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Next training bar" }));
  await screen.findByText(/Bar 2 \/ 3/);
  expect(screen.queryByRole("dialog", { name: "Unsaved training annotations" })).toBeNull();
});

it("deletes a hovered desired attack outside the selected audio region and saves the remaining attacks", async () => {
  detection.hits = [{ time: .2 }, { time: .6 }, { time: 1.4 }];
  const f = fixture();
  await ready();
  expect(screen.queryByRole("button", { name: "Correct attacks" })).toBeNull();
  expect(screen.queryByLabelText("Desired attack source seconds")).toBeNull();
  vi.stubGlobal("PointerEvent", MouseEvent);
  const detail = screen.getByRole("img");
  vi.spyOn(detail, "getBoundingClientRect").mockReturnValue({ left: 0, width: 512 } as DOMRect);
  fireEvent.pointerDown(detail, { clientX: 26, clientY: 30 });
  fireEvent.pointerMove(detail, { clientX: 80, clientY: 30 });
  fireEvent.pointerUp(detail, { clientX: 80, clientY: 30 });
  const selection = screen.getByTestId("annotation-playback-selection");
  fireEvent.pointerMove(detail, { clientX: 333, clientY: 10 });
  const remove = screen.getByRole("button", { name: "Delete desired attack 1.400000 seconds" });
  fireEvent.pointerEnter(remove);
  fireEvent.click(remove);
  expect(screen.queryByRole("button", { name: "Select desired attack 1.400000 seconds" })).toBeNull();
  expect(selection).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Training example saved on this device.");
  expect((await f.repository.read()).dataset.manifest.examples[0].desiredFrames).toEqual([1600, 4800]);
});

it("exposes delete by keyboard focus without deleting calculated detections", async () => {
  fixture();
  await ready();
  fireEvent.focus(screen.getByRole("button", { name: "Select desired attack 0.200000 seconds" }));
  const remove = screen.getByRole("button", { name: "Delete desired attack 0.200000 seconds" });
  fireEvent.blur(screen.getByRole("button", { name: "Select desired attack 0.200000 seconds" }), { relatedTarget: remove });
  expect(remove.isConnected).toBe(true);
  fireEvent.focus(remove);
  fireEvent.click(remove);
  expect(screen.queryByRole("button", { name: "Select desired attack 0.200000 seconds" })).toBeNull();
  expect(screen.getByRole("button", { name: "Select calculated attack 0.200000 seconds" })).toBeDefined();
});

it("excludes a saved bar even after a tempo edit makes it incomplete, and retains it if removal fails", async () => {
  const f = fixture();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Training example saved on this device.");
  const tempo = screen.getByLabelText("Tempo BPM");
  fireEvent.change(tempo, { target: { value: "30" } });
  fireEvent.blur(tempo);
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Exclude training bar" }) as HTMLButtonElement).disabled).toBe(false);
  f.fail();
  fireEvent.click(screen.getByRole("button", { name: "Exclude training bar" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("quota failure"));
  expect((await f.repository.read()).dataset.manifest.examples).toHaveLength(1);
  f.recover();
  fireEvent.click(screen.getByRole("button", { name: "Exclude training bar" }));
  await screen.findByText("Bar excluded from the training set.");
  expect((await f.repository.read()).dataset.manifest.examples).toHaveLength(0);
  expect(screen.queryByRole("button", { name: "Exclude training bar" })).toBeNull();
});

it("navigates unchanged bars freely and guards only actual edits", async () => {
  fixture();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Edit training bar 2" }));
  await screen.findByText(/Bar 2 \/ 3/);
  expect(screen.queryByRole("dialog", { name: "Unsaved training annotations" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit training bar 1" }));
  await screen.findByText(/Bar 1 \/ 3/);
  expect(screen.queryByRole("dialog", { name: "Unsaved training annotations" })).toBeNull();
  seconds('.4');
  fireEvent.click(screen.getByRole("button", { name: "Edit training bar 2" }));
  expect(screen.getByRole("dialog", { name: "Unsaved training annotations" })).toBeDefined();
});


it("leaves an edited incomplete bar without prompting, then protects edits on a complete bar", async () => {
  const f = fixture();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Next training bar" }));
  await screen.findByText(/Bar 2 \/ 3/);
  fireEvent.click(screen.getByRole("button", { name: "Next training bar" }));
  await screen.findByText(/Bar 3 \/ 3/);
  const tempo = screen.getByLabelText("Tempo BPM");
  fireEvent.change(tempo, { target: { value: "121" } });
  fireEvent.blur(tempo);
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Previous training bar" }));
  await screen.findByText(/Bar 2 \/ 3/);
  expect(screen.queryByRole("dialog", { name: "Unsaved training annotations" })).toBeNull();
  const nextTempo = screen.getByLabelText("Tempo BPM");
  fireEvent.change(nextTempo, { target: { value: "122" } });
  fireEvent.blur(nextTempo);
  fireEvent.click(screen.getByRole("button", { name: "Close annotation" }));
  expect(screen.getByRole("dialog", { name: "Unsaved training annotations" })).toBeDefined();
  expect(f.close).not.toHaveBeenCalled();
});

it('edits beat one beside Tempo, keeps attack source times, and carries the reference to the next bar', async () => {
  fixture();
  await ready();
  expect(screen.getByLabelText('Tempo BPM')).toBeDefined();
  expect(screen.getByRole('slider', { name: 'Beat one marker' }).getAttribute('aria-valuenow')).toBe('0.1');
  const input = screen.getByLabelText('Beat one (seconds)');
  fireEvent.change(input, { target: { value: '.15' } });
  fireEvent.blur(input);
  expect(screen.getByRole('button', { name: 'Select desired attack 0.200000 seconds' })).toBeDefined();
  expect(screen.getByRole('slider', { name: 'Beat one marker' }).getAttribute('aria-valuenow')).toBe('0.15');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Training example saved on this device.');
  fireEvent.click(screen.getByRole('button', { name: 'Next training bar' }));
  await screen.findByText(/Bar 2 \/ 3/);
  expect((screen.getByLabelText('Beat one (seconds)') as HTMLInputElement).value).toBe('0.15');
});


it('colors pills from saved membership through save and exclusion', async () => {
  fixture();
  await ready();
  const pills = () => screen.getAllByRole('button', { name: 'Edit training bar 1' });
  expect(pills().every(pill => pill.getAttribute('data-included') === 'false')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Training example saved on this device.');
  expect(pills().every(pill => pill.getAttribute('data-included') === 'true')).toBe(true);
  expect(screen.getByRole('button', { name: 'Edit training bar 2' }).getAttribute('data-included')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Exclude training bar' }));
  await screen.findByText('Bar excluded from the training set.');
  expect(pills().every(pill => pill.getAttribute('data-included') === 'false')).toBe(true);
});
