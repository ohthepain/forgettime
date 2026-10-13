import type { PluginListenerHandle } from '@capacitor/core';
export interface NativeOnset { time: number; strength: number; confidence: number }
export interface NativeAudioFrame {
  /** Seconds through which all captured onsets have been analyzed. */
  time: number;
  onsets: NativeOnset[];
  level: number;
  sampleRate: number;
  timestampQuality: 'hardware' | 'sample-clock';
  /** Platform monotonic seconds for the analyzed-through sample, when hardware mapping is available. */
  hardwareTime?: number;
}
export interface ForgettimeAudioPlugin {
  start(): Promise<{ sampleRate: number; timestampQuality: 'hardware' | 'sample-clock' }>;
  stop(): Promise<void>;
  addListener(name: 'audioFrame', callback: (event: NativeAudioFrame) => void): Promise<PluginListenerHandle>;
  addListener(name: 'captureStopped', callback: (event: { reason: string }) => void): Promise<PluginListenerHandle>;
  addListener(name: 'captureError', callback: (event: { message: string }) => void): Promise<PluginListenerHandle>;
}
export declare const ForgettimeAudio: ForgettimeAudioPlugin;
