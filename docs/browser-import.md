# Browser audio import

Import audio opens an explicit multi-file picker; the adjacent drop area accepts the same selection. Choose one WAV or M4A, optionally with one `.forget` file, in either order. Both routes call the same controller boundary. Opening import stops microphone capture, Auto and replay. Cancellation, unsupported files and invalid selection leave the prior review available, with capture off. File inputs are cleared after selection so the same file can be selected again.

A matching WAV/`.forget` pair restores its original context directly using the strict [bar file format](bar-files.md). Filename similarity never establishes identity: SHA-256 covers the encoded WAV bytes. Invalid JSON, version, hash or coverage produces an explanation and an explicit **Use audio only** action. Original settings/results are not silently attached to mismatched audio.

Ordinary audio begins with the current tempo, then requires **Confirm tempo and beat one**. Tempo is 30–300 BPM. The full-source waveform supports pointer placement, arrow keys (one decoded sample), Shift+arrow (10 ms), Home/End, and an accessible seconds input. Beat one must lie within the audio. Leading audio is retained in the source but lies before the review grid. The confirmed tempo and origin remain fixed through navigation, replay, detector tuning and saving. Ordinary audio has no invented original detections or diagnostics; current replay analysis is shown separately. Imported/saved review uses the existing bar navigation and local library.

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
