import { DEFAULT_METRONOME, MetronomeCoach, type MetronomeOptions } from './metronome'
import { OnsetDetector, type DetectedOnset } from './onset-detector'
import { TimingEngine, type ResolvedHit, type TimingSnapshot } from './engine'
import { recordedBar, type RecordedTake } from './recorded-take'

export interface ReplayOnset extends DetectedOnset { iteration: number; position: number }
export interface ReplayResult extends ResolvedHit { iteration: number; position: number }
export interface ReplayState {
  run: number
  iteration: number
  time: number
  progress: number
  metronomeActive: boolean
  snapshot: TimingSnapshot
  /** Current and immediately preceding pass, including late-resolved scores. */
  onsets: ReplayOnset[]
  results: ReplayResult[]
}
let nextRun = 0

/** Browser output and analysis read the same retained mono PCM, never the microphone. */
export class BrowserBarReplay {
  private coach = new MetronomeCoach()
  private metronome = DEFAULT_METRONOME
  private nextClick = 1
  private clicks: { node: OscillatorNode; gain: GainNode; end: number }[] = []
  private context: AudioContext | null = null
  private output: AudioBufferSourceNode | null = null
  private detector = new OnsetDetector()
  private engine: TimingEngine
  private cursor = 0
  private started = 0
  private animation = 0
  private stopped = false
  private onsets: ReplayOnset[] = []
  private results: ReplayResult[] = []
  private pendingPresentation: ResolvedHit[] = []
  private readonly run = ++nextRun
  private readonly bar
  private readonly origin: number

  constructor(take: RecordedTake, index: number, private onState: (state: ReplayState) => void, private onError: (message: string) => void) {
    this.bar = recordedBar(take, index)
    if (!this.bar.complete || !this.bar.audio.samples.length) throw new Error('Loop playback needs a complete recorded bar. Unrecorded audio cannot be replayed.')
    this.origin = this.bar.start - this.bar.audio.startFrame / this.bar.audio.sampleRate
    this.engine = new TimingEngine(take.settings, hit => {
      this.results.push({ ...hit, id: this.run * 1_000_000 + hit.id, ...this.position(hit.time) })
      this.pendingPresentation.push(hit)
    })
    this.engine.startReplay(this.origin)
  }

  private position(time: number) {
    const frames = time * this.bar.audio.sampleRate
    const length = this.bar.audio.samples.length
    return { iteration: Math.floor((frames + 1e-7) / length), position: ((frames % length) + length) % length / length }
  }

  async start() {
    const { sampleRate, samples } = this.bar.audio
    const context = this.context = new AudioContext({ sampleRate })
    try {
      await context.resume()
      if (this.stopped) return
      if (context.state !== 'running') throw new Error('Audio output could not start. Try playing the bar again.')
      const buffer = context.createBuffer(1, samples.length, sampleRate)
      buffer.copyToChannel(new Float32Array(samples), 0)
      const output = this.output = context.createBufferSource()
      output.buffer = buffer
      output.loop = true
      output.connect(context.destination)
      this.started = context.currentTime
      output.start(this.started)
      this.publish(0)
      this.animation = requestAnimationFrame(this.tick)
    } catch (cause) { await this.stop(); throw cause }
  }

  private tick = () => {
    if (this.stopped || !this.context) return
    if (this.context.state !== 'running') { this.onError('Audio playback interrupted. Play again to start a fresh run.'); return }
    // AudioContext time, never animation/callback arrival, determines source frames.
    const outputTimestamp = this.context.getOutputTimestamp?.().contextTime
    const audibleTime = outputTimestamp && outputTimestamp > 0 ? outputTimestamp : this.context.currentTime - (this.context.outputLatency ?? 0)
    const time = Math.max(0, audibleTime - this.started)
    const { sampleRate, samples } = this.bar.audio
    const through = Math.floor(time * sampleRate)
    // Fixed small packets preserve interpretation lookahead under delayed UI delivery.
    while (this.cursor + 128 <= through) {
      const packet = new Float32Array(128)
      for (let i = 0; i < packet.length; i++) packet[i] = samples[(this.cursor + i) % samples.length]
      const onsets = this.detector.process(packet, this.cursor / sampleRate, sampleRate)
      this.cursor += packet.length
      for (const onset of onsets) {
        this.engine.addOnset(onset)
        this.onsets.push({ ...onset, ...this.position(onset.time) })
      }
      this.engine.snapshot(this.detector.processedThrough ?? 0)
      const oldest = this.position(this.cursor / sampleRate).iteration - 1
      this.onsets = this.onsets.filter(hit => hit.iteration >= oldest)
      this.results = this.results.filter(hit => hit.iteration >= oldest)
    }
    this.publish(time)
    this.animation = requestAnimationFrame(this.tick)
  }

  private publish(time: number) {
    const { iteration, position } = this.position(time)
    // The analyzed watermark may trail output by a partial detector window.
    const snapshot = this.engine.snapshot(this.detector.processedThrough ?? 0)
    snapshot.beat = (Math.floor((time - this.origin + 1e-8) / (60 / snapshot.bpm)) % 4 + 1) as 1 | 2 | 3 | 4
    // Scores keep their sample timestamps, but each newly delivered line gets its
    // own full presentation animation even when the UI callback arrived late.
    const delivered = new Map([...this.pendingPresentation, ...snapshot.hits].map(hit => [hit.id, hit]))
    this.pendingPresentation = []
    snapshot.hits = [...delivered.values()].map(hit => ({ ...hit, id: this.run * 1_000_000 + hit.id }))
    const metronomeActive = this.scheduleMetronome(snapshot, time)
    this.onState({ metronomeActive, run: this.run, iteration, time, progress: position, snapshot, onsets: this.onsets.slice(), results: this.results.slice() })
  }

  setMetronome(options: MetronomeOptions) {
    this.metronome = options
    this.coach.reset()
    this.nextClick = 1
    for (const click of this.clicks) { click.node.stop(); click.node.disconnect(); click.gain.disconnect() }
    this.clicks = []
  }

  private scheduleMetronome(snapshot: TimingSnapshot, time: number) {
    const context = this.context
    if (!context) return false
    // Replay has no live-silence cutoff. Click synthesis is a separate output graph.
    const { plan } = this.coach.update({ ...snapshot, lastHitTime: null }, time, this.metronome)
    this.clicks = this.clicks.filter(click => {
      if (click.end >= context.currentTime) return true
      click.node.disconnect(); click.gain.disconnect(); return false
    })
    if (!plan) return false
    const beat = 60 / snapshot.bpm
    const renderTime = context.currentTime - this.started
    this.nextClick = Math.max(this.nextClick, plan.fromBeat, Math.ceil((renderTime - this.origin) / beat))
    while (this.origin + this.nextClick * beat < Math.min(renderTime + 0.15, plan.untilTime, plan.stopTime ?? Infinity)) {
      const start = this.started + this.origin + this.nextClick * beat
      const accent = this.nextClick % 4 === 0
      const node = context.createOscillator()
      const gain = context.createGain()
      node.frequency.value = accent ? 1500 : 1000
      gain.gain.setValueAtTime(accent ? 0.16 : 0.11, start)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.025)
      node.connect(gain); gain.connect(context.destination)
      node.start(start); node.stop(start + 0.026)
      this.clicks.push({ node, gain, end: start + 0.026 })
      this.nextClick++
    }
    return true
  }

  async stop() {
    this.stopped = true
    this.setMetronome({ ...this.metronome, enabled: false })
    cancelAnimationFrame(this.animation)
    this.output?.stop()
    this.output?.disconnect()
    this.output = null
    const context = this.context
    this.context = null
    if (context && context.state !== 'closed') await context.close()
  }
}
