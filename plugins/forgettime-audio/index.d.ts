import type { PluginListenerHandle } from '@capacitor/core';
/** Wire mirror of src/audio/detector-contract.ts v1; parity tests guard semantics. */
export interface NativeDetectorSettings { version: 1; minimumRms: number; contrastRatio: number; minSeparationMs: number; recoverySeconds: number }
export interface NativeCandidate {
  version: 1; id: number; time: number; strength: number; confidence: number; accepted: boolean;
  reasons: ('warming-up' | 'level' | 'rise' | 'contrast' | 'rearming' | 'separation')[];
  settings: NativeDetectorSettings;
  measurements: { rms: number; minimumLevel: number; levelReference: number; rise: number; minimumRise: number;
    ratio: number; minimumRatio: number; contrast: number; minimumContrast: number; backgroundRms: number;
    baselineRms: number; armed: boolean; rearmRatio: number; elapsedMs: number | null; minimumSeparationMs: number };
}
export interface NativeDiagnostics { candidates: NativeCandidate[]; dropped: number }
export interface NativeReplayFrame {
  sessionId: string; status: 'playing' | 'stopped' | 'error'; reason?: string;
  sampleRate: number; audibleFrame: number; analyzedThroughFrame: number;
  clockQuality: 'hardware' | 'estimated'; onsets: NativeOnset[]; diagnostics: NativeDiagnostics;
}
export interface NativeOnset { time: number; strength: number; confidence: number }
export interface NativeWaveformEnvelope { time: number; duration: number; min: number; max: number }
export interface NativeAudioFrame {
  /** Seconds through which all captured onsets have been analyzed. */
  time: number;
  onsets: NativeOnset[];
  level: number;
  sampleRate: number;
  timestampQuality: 'hardware' | 'sample-clock';
  /** Platform monotonic seconds for the analyzed-through sample, when hardware mapping is available. */
  hardwareTime?: number;
  /** 2 ms min/max windows from the captured PCM, on the same sample clock. */
  waveform?: NativeWaveformEnvelope[];
  metronomeAvailable?: boolean;
  analysis?: { implementation: string; version: string };
  diagnostics?: NativeDiagnostics;
  /** Capture generation; acknowledgements from older sessions are ignored. */
  sessionId?: string;
  /** Mono source PCM, sharing sampleRate and onset clock. At most 16384 samples. */
  pcm?: { startFrame: number; samples: number[] };
}
export interface NativeMetronomePlan { origin: number; bpm: number; fromBeat: number; untilTime: number }
export interface NativeSavedBarSummary { id: string; name: string; createdAt: number; bpm: number; complete: boolean; bytes: number }
export interface NativeFileHandle { handle: string; size: number }
export interface NativeFilePlugin {
  listSavedBars(): Promise<{ bars: NativeSavedBarSummary[] }>;
  beginBarSave(options: { summary: NativeSavedBarSummary; wavBytes: number; sidecarBytes: number }): Promise<{ transferId: string }>;
  appendFileChunk(options: { transferId: string; part: 'wav' | 'sidecar' | 'audio'; offset: number; data: string }): Promise<void>;
  commitBarSave(options: { transferId: string }): Promise<void>;
  abortFileTransfer(options: { transferId: string }): Promise<void>;
  readSavedBar(options: { id: string }): Promise<{ summary: NativeSavedBarSummary; wav: NativeFileHandle; sidecar: NativeFileHandle }>;
  pickAudioFiles(): Promise<{ files: (NativeFileHandle & { name: string })[] }>;
  readFileChunk(options: { handle: string; offset: number; length: number }): Promise<{ data: string }>;
  releaseFiles(options: { handles: string[] }): Promise<void>;
  beginAudioDecode(options: { name: string; byteLength: number }): Promise<{ transferId: string }>;
  finishAudioDecode(options: { transferId: string }): Promise<NativeFileHandle & { frames: number; sampleRate: number; channels: number }>;
  exportSavedBar(options: { id: string }): Promise<{ status: 'presented' | 'cancelled' }>;
}
export interface ForgettimeAudioPlugin extends NativeFilePlugin {
  start(options?: { detectorSettings?: NativeDetectorSettings; inputGain?: number }): Promise<{ sessionId?: string; sampleRate: number; timestampQuality: 'hardware' | 'sample-clock'; inputGainSupported?: boolean; diagnosticsSupported?: boolean; analysis?: { implementation: string; version: string } }>;
  setInputGain(options: { sessionId: string; inputGain: number }): Promise<void>;
  setDetectorSettings(options: { sessionId: string; detectorSettings: NativeDetectorSettings }): Promise<void>;
  startReplay(options: { sessionId: string; sampleRate: number; samples: number[]; detectorSettings: NativeDetectorSettings }): Promise<{ sessionId: string; sampleRate: number; frameCount: number; diagnosticsSupported: boolean }>;
  readReplay(options: { sessionId: string }): Promise<NativeReplayFrame>;
  stopReplay(options: { sessionId: string }): Promise<void>;
  setReplayMetronome(options: { sessionId: string; plan: NativeMetronomePlan | null }): Promise<void>;
  stop(): Promise<void>;
  acknowledgeFrame(options: { sessionId: string; endFrame: number }): Promise<void>;
  setMetronome(options: { plan: NativeMetronomePlan | null }): Promise<void>;
  addListener(name: 'audioFrame', callback: (event: NativeAudioFrame) => void): Promise<PluginListenerHandle>;
  addListener(name: 'captureStopped', callback: (event: { reason: string; sessionId?: string }) => void): Promise<PluginListenerHandle>;
  addListener(name: 'captureError', callback: (event: { message: string; sessionId?: string }) => void): Promise<PluginListenerHandle>;
}
export declare const ForgettimeAudio: ForgettimeAudioPlugin;
