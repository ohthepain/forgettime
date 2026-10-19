// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { WaveformDisplay } from "./WaveformDisplay";

const output = vi.hoisted(() => ({ play: vi.fn().mockResolvedValue(true), stop: vi.fn(), frame: null as number | null }));
vi.mock("../audio/audio-region-preview", () => ({
  AudioRegionPreview: class {
    get currentFrame() { return output.frame; }
    play = output.play;
    stop = output.stop;
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  output.frame = null;
});
const audio = { samples: new Float32Array(16000), sampleRate: 8000, channels: 1 };
const markers = [
  { frame: 2000, kind: "desired" as const },
  { frame: 4000, kind: "desired" as const },
];

it("owns zoom, navigation and height for either caller without duplicate buttons or source edits", () => {
  const select = vi.fn(),
    place = vi.fn();
  const { container } = render(
    <WaveformDisplay
      audio={audio}
      range={{ start: 1000, end: 9000 }}
      markers={markers}
      selectedFrame={null}
      onSelect={select}
      onPlace={place}
    />,
  );
  for (const name of [
    "Zoom time in",
    "Zoom time out",
    "Enlarge waveform",
    "Reduce waveform",
    "Reset zoom",
  ])
    expect(screen.queryByRole("button", { name })).toBeNull();
  const overview = screen.getByRole("slider", { name: "Visible audio passage" });
  fireEvent.keyDown(overview, { key: "+" });
  expect(overview.getAttribute("aria-valuenow")).toBe("0.375");
  fireEvent.keyDown(overview, { key: "End" });
  expect(overview.getAttribute("aria-valuenow")).toBe("0.625");
  fireEvent.keyDown(overview, { key: "ArrowUp" });
  expect(container.textContent).toContain("waveform height 2.00×");
  fireEvent.keyDown(overview, { key: "0" });
  expect(overview.getAttribute("aria-valuenow")).toBe("0.125");
  expect(overview.getAttribute("aria-valuemax")).toBe("0.125");
  expect(place).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});

it("uses source-frame bounds for playback and ignores late completion after changing context", async () => {
  let resolve!: (result: boolean) => void;
  output.play.mockImplementationOnce(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  const props = {
    audio,
    range: { start: 1000, end: 9000 },
    markers,
    selectedFrame: 4000,
    onSelect: vi.fn(),
  };
  const { rerender } = render(<WaveformDisplay {...props} contextKey="first" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Play from 0.500000 seconds to 1.125000 seconds" }),
  );
  expect(output.play).toHaveBeenCalledWith(audio, 0.5, 1.125, expect.any(Function));
  rerender(<WaveformDisplay {...props} contextKey="second" />);
  await act(async () => resolve(true));
  expect(screen.queryByRole("button", { name: "Stop audio preview" })).toBeNull();
  expect(output.stop).toHaveBeenCalled();
});

it("keeps viewport and overview clips independent when import and annotation are both mounted", () => {
  const { container } = render(
    <>
      <section aria-label="import">
        <WaveformDisplay audio={audio} markers={markers} selectedFrame={null} onSelect={vi.fn()} />
      </section>
      <section aria-label="annotation">
        <WaveformDisplay
          scope="annotation"
          audio={audio}
          range={{ start: 1000, end: 9000 }}
          markers={markers}
          selectedFrame={null}
          onSelect={vi.fn()}
        />
      </section>
    </>,
  );
  const first = within(screen.getByRole("region", { name: "import" })).getByRole("slider");
  const second = within(screen.getByRole("region", { name: "annotation" })).getByRole("slider");
  fireEvent.keyDown(first, { key: "+" });
  expect(first.getAttribute("aria-valuenow")).toBe("0.5");
  expect(second.getAttribute("aria-valuenow")).toBe("0.125");
  const clips = [...container.querySelectorAll("clipPath")].map((e) => e.id);
  expect(new Set(clips).size).toBe(2);
});

it("labels bar starts from the source reference without renumbering after zoom or navigation", () => {
  const source = { samples: new Float32Array(48000), sampleRate: 8000, channels: 1 };
  const { container } = render(
    <WaveformDisplay
      audio={source}
      markers={[]}
      selectedFrame={null}
      onSelect={vi.fn()}
      grid={{ bpm: 120, beatOneFrame: 0 }}
    />,
  );
  const labels = () =>
    [...container.querySelectorAll(".waveform-detail .waveform-bar-label")].map(
      (e) => e.textContent,
    );
  expect(labels()).toEqual(["1.1.1", "2.1.1", "3.1.1"]);
  const overview = screen.getByRole("slider", { name: "Visible audio passage" });
  fireEvent.keyDown(overview, { key: "+" });
  fireEvent.keyDown(overview, { key: "End" });
  expect(labels()).toEqual(["3.1.1"]);
  expect(
    [...container.querySelectorAll(".waveform-overview-container .waveform-bar-label")].map(
      (e) => e.textContent,
    ),
  ).toEqual(["1.1.1", "2.1.1", "3.1.1"]);
});

it('auditions sample zero and clears a selected region when clicking outside the display', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  render(<><WaveformDisplay audio={audio} markers={markers} selectedFrame={null} onSelect={vi.fn()} /><button>Outside</button></>);
  const detail = screen.getByRole('img');
  vi.spyOn(detail, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 512 } as DOMRect);
  fireEvent.pointerMove(detail, { clientX: 1, clientY: 10 });
  fireEvent.click(screen.getByRole('button', { name: 'Play from 0.000000 seconds to 0.250000 seconds' }));
  await screen.findByRole('button', { name: 'Stop audio preview' });
  expect(output.play).toHaveBeenCalledWith(audio, 0, .25, expect.any(Function));
  fireEvent.pointerDown(detail, { clientX: 80, clientY: 20 });
  fireEvent.pointerMove(detail, { clientX: 180, clientY: 20 });
  fireEvent.pointerUp(detail, { clientX: 180, clientY: 20 });
  expect(screen.getByTestId('waveform-selection')).toBeDefined();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
  expect(screen.queryByTestId('waveform-selection')).toBeNull();
});

it('uses zero-crossing nudges and commits dragging without selecting or adding audio', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const pcm = new Float32Array(16000).fill(-1); pcm.fill(1, 2100);
  const move = vi.fn(), place = vi.fn();
  render(<WaveformDisplay audio={{ ...audio, samples: pcm }} markers={markers} selectedFrame={null} onSelect={vi.fn()} onNudge={move} onPlace={place} />);
  const detail = screen.getByRole('img');
  vi.spyOn(detail, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 512 } as DOMRect);
  fireEvent.focus(screen.getByRole('button', { name: 'Select calculated attack 0.250000 seconds' }));
  fireEvent.click(screen.getByRole('button', { name: 'Nudge attack 0.250000 seconds right to zero crossing' }));
  expect(move).toHaveBeenCalledWith(2000, 100);
  const handle = screen.getByRole('button', { name: 'Drag attack 0.250000 seconds' });
  fireEvent.pointerDown(handle, { button: 0, clientX: 64 });
  fireEvent.pointerMove(handle, { clientX: 128 });
  fireEvent.pointerUp(handle, { clientX: 128 });
  expect(move).toHaveBeenCalledWith(2000, 2000);
  expect(place).not.toHaveBeenCalled();
});

it('plays the visible passage with Space and displays an audio-clock playhead', async () => {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  render(<><WaveformDisplay audio={audio} range={{ start: 1000, end: 9000 }} markers={markers} selectedFrame={null} onSelect={vi.fn()} /><input aria-label="Tempo" /></>);
  fireEvent.keyDown(screen.getByLabelText('Tempo'), { key: ' ' });
  expect(output.play).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: ' ' });
  await act(async () => {});
  expect(output.play).toHaveBeenCalledWith(audio, .125, 1.125, expect.any(Function));
  output.frame = 5000;
  act(() => callbacks[0](0));
  expect(screen.getByTestId('waveform-playhead').getAttribute('x1')).toBe('256');
  fireEvent.focus(screen.getByRole('button', { name: 'Select calculated attack 0.250000 seconds' }));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Stop audio preview' }), { key: ' ' });
  await act(async () => {});
  expect(output.play).toHaveBeenCalledTimes(2);
  expect(output.play).toHaveBeenLastCalledWith(audio, .125, 1.125, expect.any(Function));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByTestId('waveform-playhead')).toBeNull();
});

it('slides the overview viewport across the source without changing the current bar highlight', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const selectBar = vi.fn(), place = vi.fn();
  render(<WaveformDisplay audio={audio} range={{ start: 2000, end: 6000 }} grid={{ bpm: 120, beatOneFrame: 0 }} markers={markers} selectedFrame={null} onSelect={vi.fn()} onSelectBar={selectBar} onPlace={place} />);
  const overview = screen.getByRole('slider', { name: 'Visible audio passage' });
  vi.spyOn(overview, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 512 } as DOMRect);
  const highlight = screen.getByTestId('current-bar-overview');
  expect(screen.getByTestId('waveform-overview-viewport').getAttribute('fill')).toBe('#f4cf682e');
  expect(highlight.getAttribute('x')).toBe('64');
  fireEvent.pointerDown(overview, { clientX: 100, clientY: 20 });
  fireEvent.pointerMove(overview, { clientX: 228, clientY: 20 });
  fireEvent.pointerUp(overview, { clientX: 228, clientY: 20 });
  expect(overview.getAttribute('aria-valuenow')).toBe('0.75');
  expect(screen.getByTestId('waveform-overview-viewport').getAttribute('x')).toBe('192');
  expect(highlight.getAttribute('x')).toBe('64');
  expect(screen.getByTestId('current-bar-detail').getAttribute('width')).toBe('0');
  expect(selectBar).not.toHaveBeenCalled();
  const detail = screen.getByRole('img');
  vi.spyOn(detail, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 512 } as DOMRect);
  fireEvent.pointerDown(detail, { clientX: 256, clientY: 20 });
  fireEvent.pointerUp(detail, { clientX: 256, clientY: 20 });
  fireEvent.click(detail, { clientX: 256 });
  expect(place).not.toHaveBeenCalled();
  fireEvent.pointerDown(overview, { clientX: 480, clientY: 20 });
  fireEvent.pointerUp(overview, { clientX: 480, clientY: 20 });
  expect(selectBar).not.toHaveBeenCalled();
  expect(highlight.getAttribute('x')).toBe('64');
});

it('renders finer detail labels and lines when zooming without changing overview bar controls', () => {
  const selectBar = vi.fn();
  const { container } = render(<WaveformDisplay audio={audio} markers={[]} grid={{ bpm: 120, beatOneFrame: 0 }} selectedFrame={null} onSelect={vi.fn()} onSelectBar={selectBar} />);
  const labels = () => Array.from(container.querySelectorAll('.waveform-beat-label')).map(node => node.textContent);
  expect(labels()).toEqual(['1.2.1', '1.3.1', '1.4.1']);
  fireEvent.keyDown(screen.getByRole('slider', { name: 'Visible audio passage' }), { key: '+' });
  expect(labels()).toContain('1.2.2');
  expect(container.querySelectorAll('.waveform-beat-marker')).toHaveLength(4);
  expect(container.querySelector('.waveform-beat-label')?.closest('svg')).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Edit training bar 1' })).toHaveLength(1);
  expect(selectBar).not.toHaveBeenCalled();
});

it('switches only the detail background to mel while preserving grid, markers and viewport', () => {
  const terminate = vi.fn(), postMessage = vi.fn();
  vi.stubGlobal('Worker', class { terminate = terminate; postMessage = postMessage; });
  const select = vi.fn();
  const { container } = render(<WaveformDisplay audio={audio} scope="annotation" markers={markers} grid={{ bpm: 120, beatOneFrame: 0 }} selectedFrame={null} onSelect={select} />);
  const overview = screen.getByRole('slider', { name: 'Visible annotation passage' });
  fireEvent.keyDown(overview, { key: '+' });
  const position = overview.getAttribute('aria-valuenow');
  const labels = container.querySelectorAll('.waveform-beat-label').length;
  fireEvent.click(screen.getByRole('button', { name: 'Spectrum' }));
  expect(screen.getByRole('button', { name: 'Spectrum' }).getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('.waveform-detail .waveform-trace')).toBeNull();
  expect(container.querySelectorAll('.waveform-beat-label')).toHaveLength(labels);
  expect(overview.getAttribute('aria-valuenow')).toBe(position);
  expect(postMessage).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Waveform' }));
  expect(container.querySelector('.waveform-detail .waveform-trace')).not.toBeNull();
  expect(terminate).toHaveBeenCalled();
});
