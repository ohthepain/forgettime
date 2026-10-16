# Browser audio import

Import audio opens an explicit multi-file picker; the adjacent drop area accepts the same selection. Choose one WAV or M4A, optionally with one `.forget` file, in either order. Both routes call the same controller boundary. Opening import stops microphone capture, Auto and replay. Cancellation, unsupported files and invalid selection leave the prior review available, with capture off. File inputs are cleared after selection so the same file can be selected again.

A matching WAV/`.forget` pair restores its original context directly using the strict [bar file format](bar-files.md). Filename similarity never establishes identity: SHA-256 covers the encoded WAV bytes. Invalid JSON, version, hash or coverage produces an explanation and an explicit **Use audio only** action. Original settings/results are not silently attached to mismatched audio.

Ordinary audio begins with the current tempo, then requires **Confirm tempo and beat one**. Tempo is 30–300 BPM. The source waveform supports tap placement away from detection markers, arrow keys (one decoded sample), Shift+arrow (10 ms), Home/End, and an accessible seconds input. Beat one must lie within the audio. Leading audio is retained in the source but lies before the review grid. The confirmed tempo and origin remain fixed through navigation, replay, detector tuning and saving. Ordinary audio has no invented original detections or diagnostics; current replay analysis is shown separately. Imported/saved review uses the existing bar navigation and local library.

## Inspecting imported audio

The setup waveform shows accepted-onset markers from full-source analysis, independent of BPM and beat one. Detection sensitivity opens a popover in the imported-audio section; the slider shows a 0–100 value, with default/reset 50. Adjustments cancel stale analysis and update markers without playback. Select a marker (or its paged accessible list entry) to inspect its source timestamp. Marker selection does not move beat one. These preview results never become original analysis.

Drag one finger or the mouse up/down on either waveform to zoom the time axis in/out. Main-waveform horizontal drags enlarge/reduce display amplitude (right/left); overview horizontal drags navigate later/earlier through the source (right/left). A seven-pixel movement distinguishes drags from taps and locks each drag to its first clear axis. Time zoom retains the source point under the initial main-waveform position; overview zoom retains the corresponding point within the visible passage, clamped to its edges. Additional simultaneous pointers cancel interaction until all pointers lift. Cancellation never places beat one. The overview sits directly beneath the main waveform, before zoom buttons. Amplitude magnification is display-only; source samples, detection and playback volume stay unchanged. The full-file overview has a draggable viewport; its arrow keys pan by a quarter viewport and Home/End reach the source boundaries. Explicit zoom buttons provide keyboard alternatives; Reset zoom restores the full duration and initial waveform height. Existing beat-one keyboard and seconds controls remain available.

The same sensitivity setting carries into replay. Preview starts at source zero, while replay starts on the selected bar and retains detector state at loop joins, so boundary detections may differ. Tuning and zoom preserve the chosen musical reference. Live capture uses shared defaults and microphone-only Input gain; import analysis never applies microphone gain. The slider is a reproducible diagnostic experiment: report the source passage, sensitivity value and missed/extra attack so deliberate detector improvements can be checked against other examples. Slider changes never train or silently change live defaults.

## Decoding and resource limits

WAV uses the shared DataView codec at the file's own sample rate: signed PCM16/24/32 or IEEE Float32, including validated extensible formats, 1–8 channels, 8–192 kHz. Channels are averaged arithmetically into mono; Float32 input remains exact for mono. Invalid frame/chunk structure and nonfinite PCM are errors. Unknown WAV encodings are rejected explicitly.

Ordinary M4A uses the browser's media metadata reader followed by Web Audio `decodeAudioData`; installed browser/platform codecs determine support. The returned AudioBuffer sample rate is the decoded timeline used for analysis (the browser can resample compressed audio to its context rate). All channels are averaged with the same policy as WAV. Playback and analysis use those same decoded samples. Decode failure never substitutes silence, synthesized hits or a simulation.

Selected audio is capped at 64 MiB before read, verified again after read. Metadata is capped at 2 MiB. Audio duration is at most 120 seconds and decoded mono PCM at most 32 MiB. M4A metadata duration is checked before decoding, then actual channel count/duration/frame count/sample validity are checked again before installation. Browser decoding allocates its AudioBuffer before these final checks; it is not a streaming memory guarantee. Cancelling an in-flight browser decode ignores its stale result and preserves review; Web Audio does not expose cancellation of the decode allocation itself. No files upload to a server.

## Shared platform seam

`src/audio/audio-import.ts` provides:

```ts
interface ImportFile {
  name: string
  size: number
  read(): Promise<ArrayBuffer>
}
interface DecodedImportAudio {
  samples: Float32Array // arithmetic mono
  sampleRate: number   // actual decoded clock
  channels: number     // original decoded channel count
}
interface AudioImportAdapter {
  pick?(): Promise<ImportFile[]>
  decode(file: ImportFile, bytes: ArrayBuffer): Promise<DecodedImportAudio>
}
```

Native adapters can retain scoped/private handles behind `read`; they must return bounded selected bytes and decoded mono PCM. Shared WAV decoding bypasses the compressed-audio adapter. `prepareAudioImport(files, adapter)` returns `restored`, `fallback`, or `setup`; `validateDecodedAudio` checks decoded results. `BarFileOptions.importer` injects the adapter into `usePractice`. An adapter with `pick` automatically uses the same import button through `chooseImportFiles`; native screens need no separate review UI.

The controller exposes `beginImport`, `importFiles`, `chooseImportFiles`, `useImportAudioOnly`, `confirmImport`, `cancelImport`, and `importState/importBusy/importError/importNotice`. Browser picker/drop wrap explicitly selected File objects with `browserImportFile`. Native picker cancellation should return an empty list. The shared `openRecordedMaterial` boundary remains available for already validated material.

## Verification scope

Workflow tests cover paired selection order, exact samples and settings, unpaired 110 BPM/nonzero origin, stereo PCM24/32 at 44.1/48 kHz, explicit invalid metadata fallback, cancellation during a pending read, oversize admission, ambiguous selections, platform decode error/invalid PCM, paired re-export and filename-independent identity. Focused UI tests cover picker/drop routing and accessible beat placement. A replay regression verifies fractional positive origins always show beats 1–4. Real integrated browser picker/M4A/playback checks are tracked separately from these synthetic/file-edge checks.

## Audition from a detection marker

Hover a detail marker to brighten it and reveal a flat square play button at the line's foot. Its left edge stays aligned to the source marker; the column above the button retains hover. A marker tap/click or selection in the accessible list also reveals the button. Press play to audition the original mono PCM once from that source timestamp to the current visible detail range's right boundary, rounded to source frames. The preview does not apply microphone gain, rescale samples, score timing, move beat one, or create original analysis. Web Audio provides this short output-only audition; it is separate from platform detector replay.

The button shows a stop square during playback; Stop preview and Escape also stop it. Starting another preview replaces the prior one. Changing the visible time range, detector settings or source, leaving import setup, hiding the page or losing audio output stops and releases it. Output failures are visible. Amplitude display zoom remains independent. Hover playback and square-corner/outline styling require no microphone access or file persistence.
