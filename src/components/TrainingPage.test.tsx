// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { TrainingPage, trainingExampleTake } from './TrainingPage'
import { createTrainingSource, trainingExampleId } from '../audio/training-contract'
import { emptyTrainingDataset } from '../audio/training-transfer'
import { baselineParameters } from '../audio/training-optimizer'
import { AudioRegionPreview } from '../audio/audio-region-preview'
import { trainingNavigation, useTrainingSession } from '../lib/training-session'

const edges = vi.hoisted(() => ({ read: vi.fn(), exportFile: vi.fn(), deleteSource: vi.fn() }))
vi.mock('../audio/training-dataset', () => ({ createLocalTrainingRepository: () => edges }))
vi.mock('@tanstack/react-router', () => ({ Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a> }))
vi.mock('./TrainingOptimizer', () => ({ TrainingOptimizer: () => <div>Optimizer</div> }))
vi.mock('./TrainingAnnotationEditor', () => ({ TrainingAnnotationEditor: () => <div>Attack editor</div> }))
const originalDialogs = { showModal: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal'), close: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close') };
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => { for (const name of ['showModal', 'close'] as const) { const descriptor = originalDialogs[name]; if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor); else Reflect.deleteProperty(HTMLDialogElement.prototype, name); } });
const workers: WorkerMock[] = []
class WorkerMock {
  terminate = vi.fn(); postMessage = vi.fn(); onmessage: ((event: { data: unknown }) => void) | null = null; onerror = null
  constructor() { workers.push(this) }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); workers.length = 0; localStorage.clear(); useTrainingSession.setState({ samples: [], importReport: { duplicates: [], errors: [] }, adopt: null, current: baselineParameters('current') }) })
it('shows real annotations, discards stale worker replies and uses the selected profile for the whole dataset', async () => {
  vi.stubGlobal('Worker', WorkerMock)
  const pcm = await createTrainingSource([new Float32Array(40000)], 8000, { kind: 'import', name: 'Test recording', beginningAvailable: true, endAvailable: true })
  const dataset = emptyTrainingDataset(), bar = { startFrame: 16000, endFrame: 32000 }
  const example = { id: trainingExampleId(pcm.source.checksum, bar), sourceChecksum: pcm.source.checksum, bar, reference: { bpm: 120, beatOneFrame: 0, meter: [4, 4] as [4, 4] }, desiredFrames: [20000, 22000], uncertain: [], reviewed: true }
  dataset.manifest.sources.push(pcm.source); dataset.manifest.examples.push(example); dataset.manifest.groups.push({ id: 'one', assignment: 'training', sourceChecksums: [pcm.source.checksum] }); dataset.audio[pcm.source.checksum] = pcm.samples
  edges.read.mockResolvedValue({ dataset, fingerprint: 'a'.repeat(64) })
  localStorage.setItem('forgettime-training-profile', JSON.stringify(baselineParameters('mel')))
  const view = render(<TrainingPage />)
  const fileButton = await screen.findByRole('button', { name: /Test recording · 1 bar/ });
  expect(screen.queryByTestId('training-comparison')).toBeNull();
  expect(screen.getByRole('img', { name: 'Included in training dataset' })).toBeDefined()
  act(() => useTrainingSession.setState({ samples: [{ checksum: 'b'.repeat(64), name: 'New loop.wav' }], importReport: { duplicates: ['Renamed copy.wav'], errors: [] } }))
  const openPending = vi.fn().mockResolvedValue(undefined)
  trainingNavigation.openSample = openPending
  await screen.findByRole('button', { name: 'New loop.wav New' })
  const duplicatePopup = await screen.findByRole('dialog', { name: 'Duplicates skipped' })
  expect(duplicatePopup.textContent).toContain('Renamed copy.wav')
  expect(duplicatePopup.hasAttribute('open')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog', { name: 'Duplicates skipped' })).toBeNull()
  const list = screen.getByRole('list', { name: 'Training files' })
  expect(list.textContent).not.toContain('Renamed copy.wav')
  expect(list.children).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'New loop.wav New' }))
  expect(openPending).toHaveBeenCalledWith('b'.repeat(64))
  trainingNavigation.openSample = undefined
  fireEvent.click(fileButton)
  expect(screen.getAllByRole('button', { name: 'Edit training bar 2' }).every(pill => pill.getAttribute('data-included') === 'true')).toBe(true)
  expect(screen.getByRole('button', { name: 'Edit training bar 1' }).getAttribute('data-included')).toBe('false')
  await waitFor(() => expect(workers).toHaveLength(1))
  act(() => workers[0].onmessage?.({ data: { onsets: { [pcm.source.checksum]: [20000] }, scores: { [example.id]: { matched: 1, missing: 0, extra: 0, seconds: 2 } } } }))
  expect(await screen.findByText('1 matched · 0 missing · 0 extra · 2.00 s evaluated')).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: 'Comparison profile' }), { target: { value: 'Selected optimized profile' } })
  await waitFor(() => expect(workers).toHaveLength(2))
  expect(workers[1].postMessage.mock.calls[0][0].parameters.family).toBe('mel')
  act(() => workers[0].onmessage?.({ data: { onsets: {}, scores: {} } }))
  expect(screen.getByText('Calculating hits… Previous comparison is stale.')).toBeTruthy()
  act(() => workers[1].onmessage?.({ data: { onsets: { [pcm.source.checksum]: [20000, 24000] }, scores: { [example.id]: { matched: 1, missing: 1, extra: 1, seconds: 2, matchedFrames: [20000], missingFrames: [22000], extraFrames: [24000] } } } }))
  expect(await screen.findByText('1 matched · 1 missing · 1 extra · 2.00 s evaluated')).toBeTruthy()
  expect(screen.getByRole('img', { name: 'Correct detection at 2.500000 seconds' }).textContent).toBe('✓')
  expect(screen.getByRole('img', { name: 'Missing detection at 2.750000 seconds' }).textContent).toBe('m')
  expect(screen.getByRole('img', { name: 'Extra detection at 3.000000 seconds' }).textContent).toBe('×')
  expect(screen.getByRole('img', { name: 'Extra detection at 3.000000 seconds' }).closest('svg')).toBeNull()
  expect(screen.queryByText('Desired ● · Calculated │ · shaded regions are uncertain.')).toBeNull()
  const material = trainingExampleTake(dataset, example)
  expect(material.index).toBe(1)
  expect(material.take.audio.samples).toBe(dataset.audio[example.sourceChecksum])
  expect(material.take.origin).toBe(0)
  expect(example.desiredFrames).toEqual([20000, 22000])
  const stop = vi.spyOn(AudioRegionPreview.prototype, 'stop')
  view.rerender(<TrainingPage active={false} />)
  expect(stop).toHaveBeenCalled()
  view.rerender(<TrainingPage />)
  stop.mockRestore()
  fireEvent.click(screen.getByRole('button', { name: 'Remove file from training dataset' }))
  await waitFor(() => expect(edges.deleteSource).toHaveBeenCalledWith(pcm.source.checksum, 'a'.repeat(64), true))
  await waitFor(() => expect(screen.queryByTestId('training-comparison')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: /Test recording · 1 bar/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit attacks' }))
  expect(screen.getByText('Attack editor')).toBeTruthy()
})


it('opens the separate import picker with the plus button', async () => {
  edges.read.mockResolvedValue({ dataset: emptyTrainingDataset(), fingerprint: 'a'.repeat(64) });
  const open = vi.fn();
  trainingNavigation.importAudio = open;
  render(<TrainingPage />);
  await screen.findByText('No training examples yet');
  fireEvent.click(screen.getByRole('button', { name: 'Add new sample' }));
  expect(open).toHaveBeenCalledOnce();
  expect(document.getElementById('training-import-panel')?.hidden).toBe(false);
  expect(screen.queryByText('Add training examples')).toBeNull();
  trainingNavigation.importAudio = undefined;
});

it('lists imported files as New even when no training examples have been saved', async () => {
  edges.read.mockResolvedValue({ dataset: emptyTrainingDataset(), fingerprint: 'a'.repeat(64) });
  useTrainingSession.setState({ samples: [{ checksum: 'c'.repeat(64), name: 'Unannotated loop.wav' }] });
  render(<TrainingPage />);
  expect(await screen.findByRole('button', { name: 'Unannotated loop.wav New' })).toBeDefined();
  expect(screen.queryByRole('img', { name: 'Included in training dataset' })).toBeNull();
  expect(screen.queryByText('No training examples yet')).toBeNull();
});

it('navigates saved comparison bars with previous and next controls', async () => {
  vi.stubGlobal('Worker', WorkerMock)
  const pcm = await createTrainingSource([new Float32Array(32000)], 8000, { kind: 'import', name: 'Two bars', beginningAvailable: true, endAvailable: true })
  const dataset = emptyTrainingDataset()
  dataset.manifest.sources.push(pcm.source)
  dataset.audio[pcm.source.checksum] = pcm.samples
  for (let index = 0; index < 2; index++) {
    const bar = { startFrame: index * 16000, endFrame: (index + 1) * 16000 }
    dataset.manifest.examples.push({ id: trainingExampleId(pcm.source.checksum, bar), sourceChecksum: pcm.source.checksum, bar, reference: { bpm: 120, beatOneFrame: 0, meter: [4, 4] }, desiredFrames: [], uncertain: [], reviewed: true })
  }
  edges.read.mockResolvedValue({ dataset, fingerprint: 'b'.repeat(64) })
  render(<TrainingPage />)
  fireEvent.click(await screen.findByRole('button', { name: /Two bars · 2 bars/ }))
  expect(screen.getByText('Bar 1 / 2')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Previous training bar' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Next training bar' }))
  expect(screen.getByText('Bar 2 / 2')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Next training bar' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Previous training bar' }))
  expect(screen.getByText('Bar 1 / 2')).toBeTruthy()
  expect(screen.queryByText('Attack editor')).toBeNull()
})
