import type { MetronomePlan } from './metronome'

export interface BrowserLatencyEstimate {
  inputSeconds: number | null
  outputSeconds: number | null
  /** Sum of the available browser estimates, not a loopback measurement. */
  correctionSeconds: number
}

const seconds = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2 ? value : null

export function browserLatencyEstimate(context: Pick<AudioContext, 'baseLatency' | 'outputLatency'>, settings: MediaTrackSettings): BrowserLatencyEstimate {
  // latency is standard MediaTrackSettings metadata, but omitted by some DOM typings/browsers.
  const inputSeconds = seconds((settings as MediaTrackSettings & { latency?: number }).latency)
  const base = seconds(context.baseLatency)
  const hardware = seconds(context.outputLatency)
  const outputSeconds = base === null && hardware === null ? null : (base ?? 0) + (hardware ?? 0)
  return { inputSeconds, outputSeconds, correctionSeconds: (inputSeconds ?? 0) + (outputSeconds ?? 0) }
}

/**
 * A mic sample's worklet time includes input buffering. A rendered click is heard
 * later by the output delay. Advance the click by BOTH; never move recorded hits
 * or learn a correction from the player's performance (which would hide drift).
 */
export class BrowserOutputAlignment {
  private reference: string | null = null
  private correction = 0
  private activeFromBeat: number | null = null
  private requestedFromBeat: number | null = null

  get correctionSeconds() { return this.correction }

  reset() {
    this.reference = null
    this.correction = 0
    this.activeFromBeat = this.requestedFromBeat = null
  }

  align(plan: MetronomePlan | null, renderTime: number, estimatedSeconds: number): MetronomePlan | null {
    if (!plan) {
      this.activeFromBeat = this.requestedFromBeat = null
      return null
    }
    const reference = `${plan.origin}/${plan.bpm}`
    if (reference !== this.reference) {
      this.reference = reference
      // Freeze for the entire reference, including quiet periods in Need help.
      this.correction = Number.isFinite(estimatedSeconds) ? Math.max(0, Math.min(2, estimatedSeconds)) : 0
      this.activeFromBeat = null
    }
    const origin = plan.origin - this.correction
    if (this.activeFromBeat === null || this.requestedFromBeat !== plan.fromBeat) {
      this.activeFromBeat = Math.max(plan.fromBeat, Math.ceil((renderTime + 0.003 - origin) / (60 / plan.bpm)))
      this.requestedFromBeat = plan.fromBeat
    }
    return { ...plan, origin, fromBeat: this.activeFromBeat,
      // The watchdog lives on the render clock. Only the musical deadline moves
      // earlier. Shifting the short watchdog too would mute high-latency routes.
      untilTime: Math.min(plan.untilTime, (plan.stopTime ?? Infinity) - this.correction),
    }
  }
}
