import type { PluginListenerHandle } from '@capacitor/core';
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
  /** Capture generation; acknowledgements from older sessions are ignored. */
  sessionId?: string;
  /** Mono source PCM, sharing sampleRate and onset clock. At most 16384 samples. */
  pcm?: { startFrame: number; samples: number[] };
}
export interface NativeMetronomePlan { origin: number; bpm: number; fromBeat: number; untilTime: number }
export interface ForgettimeAudioPlugin {
  start(): Promise<{ sessionId?: string; sampleRate: number; timestampQuality: 'hardware' | 'sample-clock' }>;
  stop(): Promise<void>;
  acknowledgeFrame(options: { sessionId: string; endFrame: number }): Promise<void>;
  setMetronome(options: { plan: NativeMetronomePlan | null }): Promise<void>;
  addListener(name: 'audioFrame', callback: (event: NativeAudioFrame) => void): Promise<PluginListenerHandle>;
  addListener(name: 'captureStopped', callback: (event: { reason: string; sessionId?: string }) => void): Promise<PluginListenerHandle>;
  addListener(name: 'captureError', callback: (event: { message: string; sessionId?: string }) => void): Promise<PluginListenerHandle>;
}
export declare const ForgettimeAudio: ForgettimeAudioPlugin;
