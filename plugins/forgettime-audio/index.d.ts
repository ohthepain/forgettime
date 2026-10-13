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
}
export interface NativeMetronomePlan { origin: number; bpm: number; fromBeat: number; untilTime: number }
export interface ForgettimeAudioPlugin {
  start(): Promise<{ sampleRate: number; timestampQuality: 'hardware' | 'sample-clock' }>;
  stop(): Promise<void>;
  setMetronome(options: { plan: NativeMetronomePlan | null }): Promise<void>;
  addListener(name: 'audioFrame', callback: (event: NativeAudioFrame) => void): Promise<PluginListenerHandle>;
  addListener(name: 'captureStopped', callback: (event: { reason: string }) => void): Promise<PluginListenerHandle>;
  addListener(name: 'captureError', callback: (event: { message: string }) => void): Promise<PluginListenerHandle>;
}
export declare const ForgettimeAudio: ForgettimeAudioPlugin;
