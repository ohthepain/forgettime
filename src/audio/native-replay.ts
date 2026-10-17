import { normalizeFrequencyBalance } from './frequency-evidence'
import { ForgettimeAudio, type NativeReplayFrame, type NativeOnset, type NativeMetronomePlan } from 'forgettime-audio'
import { DEFAULT_DETECTOR_SETTINGS, MAX_DIAGNOSTIC_CANDIDATES, normalizeDetectorSettings, type DetectorSettings } from './detector-contract'
import { TimingEngine, type ResolvedHit } from './engine'
import { DEFAULT_METRONOME, MetronomeCoach, type MetronomeOptions } from './metronome'
import { recordedBar, type RecordedTake } from './recorded-take'
import { allocateReplayRun, type BarReplay, type ReplayState, type ReplayOnset, type ReplayResult, type ReplayCandidate } from './replay'

/** Native output and detector own source time. Polling only delivers their results. */
export class NativeBarReplay implements BarReplay {
  private readonly run = allocateReplayRun()
  private readonly sessionId = `replay-${crypto.randomUUID()}`
  private readonly bar
  private readonly origin: number
  private readonly settings: DetectorSettings
  private readonly engine: TimingEngine
  private readonly coach = new MetronomeCoach()
  private metronome = DEFAULT_METRONOME
  private animation = 0
  private stopped = false
  private stopping: Promise<void> | undefined
  private audible = 0
  private analyzed = 0
  private presentationFrame = 0
  private presentedThrough = 0
  private queuedOnsets: NativeOnset[] = []
  private planPending = false
  private latestPlan: NativeMetronomePlan | null = null
  private lastOnset = -Infinity
  private lastCandidate = 0
  private onsets: ReplayOnset[] = []
  private results: ReplayResult[] = []
  private candidates: ReplayCandidate[] = []
  private dropped = 0
  private pending: ResolvedHit[] = []

  constructor(take: RecordedTake, index: number, private onState: (state: ReplayState) => void, private onError: (message: string) => void, settings: DetectorSettings = DEFAULT_DETECTOR_SETTINGS, private frequencyBalance = 0) {
    this.frequencyBalance = normalizeFrequencyBalance(frequencyBalance)
    this.bar = recordedBar(take, index)
    if (!this.bar.complete || !this.bar.audio.samples.length) throw new Error('Loop playback needs a complete recorded bar. Unrecorded audio cannot be replayed.')
    const { sampleRate, samples } = this.bar.audio
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || samples.length > Math.min(8 * sampleRate, 1536000)
      || !samples.every(Number.isFinite)) throw new Error('This bar exceeds the supported native replay format or size.')
    this.settings = normalizeDetectorSettings(settings)
    this.origin = this.bar.start - this.bar.audio.startFrame / sampleRate
    this.engine = new TimingEngine(take.settings, hit => {
      this.results.push({ ...hit, id: this.run * 1_000_000 + hit.id, ...this.position(hit.time) })
      this.pending.push(hit)
    })
    this.engine.startReplay(this.origin)
  }
  private position(time: number) {
    const frames = time * this.bar.audio.sampleRate, length = this.bar.audio.samples.length
    return { iteration: Math.floor((frames + 1e-7) / length), position: ((frames % length) + length) % length / length }
  }
  async start() {
    try {
      const { sampleRate, samples } = this.bar.audio
      const result = await ForgettimeAudio.startReplay({ sessionId: this.sessionId, sampleRate, samples: Array.from(samples), detectorSettings: this.settings, frequencyBalance: this.frequencyBalance })
      if (this.stopped) { await ForgettimeAudio.stopReplay({ sessionId: this.sessionId }); return }
      if (result.sessionId !== this.sessionId || result.sampleRate !== sampleRate || result.frameCount !== samples.length || !result.diagnosticsSupported || (this.frequencyBalance > 0 && !result.frequencyBalanceSupported)) {
        throw new Error('Native replay capability changed. Rebuild and sync the native app.')
      }
      this.publish()
      this.animation = requestAnimationFrame(this.poll)
    } catch (error) { await this.stop(); throw error }
  }
  private poll = async () => {
    if (this.stopped) return
    try {
      const frame = await ForgettimeAudio.readReplay({ sessionId: this.sessionId })
      if (this.stopped) return
      this.accept(frame)
      if (!this.stopped) this.animation = requestAnimationFrame(this.poll)
    } catch (error) {
      if (this.stopped) return
      await this.stop()
      this.onError(error instanceof Error ? error.message : 'Native replay failed. Play again to restart.')
    }
  }
  private accept(frame: NativeReplayFrame) {
    if (frame.sessionId !== this.sessionId) throw new Error('Native replay session changed. Play again to restart.')
    if (frame.status !== 'playing') throw new Error(frame.reason || 'Native playback stopped. Play again to restart.')
    if (frame.sampleRate !== this.bar.audio.sampleRate || !Number.isSafeInteger(frame.audibleFrame) || frame.audibleFrame < this.audible
      || !Number.isSafeInteger(frame.analyzedThroughFrame) || frame.analyzedThroughFrame < this.analyzed || frame.analyzedThroughFrame > frame.audibleFrame
      || frame.audibleFrame - this.audible > frame.sampleRate * 2 || frame.onsets.length > 2048
      || !frame.diagnostics || frame.diagnostics.candidates.length > MAX_DIAGNOSTIC_CANDIDATES
      || !Number.isSafeInteger(frame.diagnostics.dropped) || frame.diagnostics.dropped < 0) throw new Error('Native replay clock or result limit interrupted playback.')
    for (const onset of frame.onsets) {
      if (!Number.isFinite(onset.time) || onset.time < 0 || onset.time <= this.lastOnset || onset.time * frame.sampleRate > frame.analyzedThroughFrame + 1e-6
        || !Number.isFinite(onset.strength) || !Number.isFinite(onset.confidence)) throw new Error('Native replay returned invalid attack measurements.')
      this.lastOnset = onset.time
      this.queuedOnsets.push(onset)
    }
    for (const candidate of frame.diagnostics.candidates) {
      if (candidate.version !== 1 || !Number.isSafeInteger(candidate.id) || candidate.id <= this.lastCandidate || !Number.isFinite(candidate.time)
        || candidate.time < 0 || candidate.time * frame.sampleRate > frame.analyzedThroughFrame + 1e-6) throw new Error('Native replay returned invalid candidate measurements.')
      this.lastCandidate = candidate.id
      this.candidates.push({ ...candidate, ...this.position(candidate.time) })
    }
    this.dropped += frame.diagnostics.dropped
    this.audible = frame.audibleFrame
    this.analyzed = frame.analyzedThroughFrame
    // Match browser replay's fixed 128-source-frame interpretation cadence.
    // A delayed bridge read must not let a later attack change an earlier score.
    const windowFrames = Math.max(32, Math.round(frame.sampleRate * 0.002667))
    while (this.presentationFrame + 128 <= this.audible) {
      this.presentationFrame += 128
      const through = Math.floor(this.presentationFrame / windowFrames) * windowFrames
      if (through > this.analyzed) throw new Error('Native replay analysis watermark is incomplete.')
      while (this.queuedOnsets.length && Math.round(this.queuedOnsets[0].time * frame.sampleRate) < through) {
        const onset = this.queuedOnsets.shift()!
        this.engine.addOnset(onset)
        this.onsets.push({ ...onset, ...this.position(onset.time) })
      }
      this.presentedThrough = through
      this.engine.snapshot(through / frame.sampleRate)
    }
    this.publish()
  }
  private publish() {
    const time = this.audible / this.bar.audio.sampleRate
    const { iteration, position } = this.position(time)
    const snapshot = this.engine.snapshot(this.presentedThrough / this.bar.audio.sampleRate)
    snapshot.beat = (((Math.floor((time - this.origin + 1e-8) / (60 / snapshot.bpm)) % 4) + 4) % 4 + 1) as 1 | 2 | 3 | 4
    snapshot.hits = [...new Map([...this.pending, ...snapshot.hits].map(hit => [hit.id, hit])).values()].map(hit => ({ ...hit, id: this.run * 1_000_000 + hit.id }))
    this.pending = []
    this.onsets = this.onsets.filter(hit => hit.iteration >= iteration - 1)
    this.results = this.results.filter(hit => hit.iteration >= iteration - 1)
    this.candidates = this.candidates.filter(hit => hit.iteration >= iteration - 1)
    if (this.candidates.length > MAX_DIAGNOSTIC_CANDIDATES) {
      this.dropped += this.candidates.length - MAX_DIAGNOSTIC_CANDIDATES
      this.candidates = this.candidates.slice(-MAX_DIAGNOSTIC_CANDIDATES)
    }
    // Replay silence never shuts off its established coaching/reference clock.
    const plan = this.coach.update({ ...snapshot, lastHitTime: time }, time, this.metronome).plan
    this.latestPlan = plan
    void this.sendPlan()
    this.onState({ settings: this.settings, frequencyBalance: this.frequencyBalance, run: this.run, time, iteration, progress: position, snapshot,
      onsets: this.onsets.slice(), results: this.results.slice(), candidates: this.candidates.slice(), diagnosticsDropped: this.dropped, metronomeActive: Boolean(plan) })
  }
  private async sendPlan() {
    if (this.planPending || this.stopped) return
    this.planPending = true
    try {
      let sent: NativeMetronomePlan | null
      do {
        sent = this.latestPlan
        await ForgettimeAudio.setReplayMetronome({ sessionId: this.sessionId, plan: sent })
      } while (!this.stopped && sent !== this.latestPlan)
    } catch {
      if (!this.stopped) { await this.stop(); this.onError('Native replay metronome output failed.') }
    } finally { this.planPending = false }
  }
  setMetronome(options: MetronomeOptions) { this.metronome = options }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping
    this.stopped = true
    cancelAnimationFrame(this.animation)
    this.stopping = ForgettimeAudio.stopReplay({ sessionId: this.sessionId }).catch(() => undefined)
    return this.stopping
  }
}
