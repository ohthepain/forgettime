import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { ForgettimeAudio, type NativeAudioFrame } from 'forgettime-audio'
import type { CapturedPcm } from './recorded-take'
import { OnsetDetector, type DetectedOnset } from './onset-detector'
import { WaveformEnvelopeCapture, type WaveformEnvelope } from './waveform-envelope'
import type { MetronomePlan } from './metronome'
import { BrowserOutputAlignment, browserLatencyEstimate, type BrowserLatencyEstimate } from './output-alignment'

export interface CaptureInfo {
  source: 'native' | 'web'
  sampleRate: number
  timestampQuality: 'hardware' | 'sample-clock'
  inputLabel?: string
  deviceId?: string
  /** Browser-reported applied settings. Missing values mean unknown, not disabled. */
  processing?: Pick<MediaTrackSettings, 'autoGainControl' | 'echoCancellation' | 'noiseSuppression'>
  /** Browser-reported estimates only; never inferred from a drummer's hits. */
  latency?: BrowserLatencyEstimate
}

export interface CaptureFrame extends CaptureInfo {
  /** Fully analyzed sample watermark, in seconds. Pass this to engine.snapshot(). */
  time: number
  /** These timestamps use the SAME clock as time, never callback arrival time. */
  onsets: DetectedOnset[]
  level: number
  hardwareTime?: number
  /** Captured 2 ms min/max envelopes; optional for older native plugin builds. */
  waveform?: WaveformEnvelope[]
  metronomeAvailable?: boolean
  /** Optional retained audio, on the same sample clock as onset timestamps. */
  pcm?: CapturedPcm
}

export interface CaptureCallbacks {
  onFrame: (frame: CaptureFrame) => void
  onError?: (error: Error) => void
  onStopped?: (reason: string) => void
  /** Missing browser input invalidates the reference, but need not close the mic. */
  onDiscontinuity?: () => void
  onOutputError?: (message: string) => void
}

export interface AudioCapture {
  start: () => Promise<CaptureInfo>
  stop: () => Promise<void>
  setMetronome: (plan: MetronomePlan | null) => void
}

/** Foreground-only live capture. Native builds require the native plugin. */
export function createAudioCapture(callbacks: CaptureCallbacks, options: { deviceId?: string } = {}): AudioCapture {
  let generation = 0
  let running = false
  let starting: Promise<CaptureInfo> | undefined
  let stopping: Promise<void> | undefined
  let info: CaptureInfo | undefined
  let context: AudioContext | undefined
  let stream: MediaStream | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let worklet: AudioWorkletNode | undefined
  let listeners: PluginListenerHandle[] = []
  let nativeStarted = false
  let outputFailed = false
  let outputPending = false
  let latestPlan: MetronomePlan | null = null
  const detector = new OnsetDetector()
  const waveform = new WaveformEnvelopeCapture()
  const outputAlignment = new BrowserOutputAlignment()

  const cleanup = async () => {
    running = false
    latestPlan = null
    outputAlignment.reset()
    info = undefined
    document.removeEventListener('visibilitychange', visibilityChanged)
    window.removeEventListener('pagehide', pageHidden)
    if (worklet) {
      worklet.port.onmessage = null
      worklet.onprocessorerror = null
      worklet.disconnect()
      worklet.port.close()
      worklet = undefined
    }
    source?.disconnect()
    source = undefined
    stream?.getTracks().forEach((track) => {
      track.onended = null
      track.onmute = null
      track.onunmute = null
      track.stop()
    })
    stream = undefined
    const closingContext = context
    context = undefined
    if (closingContext && closingContext.state !== 'closed') {
      closingContext.onstatechange = null
      await closingContext.close().catch(() => undefined)
    }
    if (nativeStarted) {
      nativeStarted = false
      await ForgettimeAudio.stop().catch(() => undefined)
    }
    const removingListeners = listeners
    listeners = []
    await Promise.all(removingListeners.map((listener) => listener.remove()))
  }

  const stop = (): Promise<void> => {
    generation++
    if (stopping) return stopping
    const operation = cleanup()
    stopping = operation
    void operation.finally(() => { if (stopping === operation) stopping = undefined }).catch(() => undefined)
    return operation
  }

  const interrupt = (reason: string) => {
    // Also cancel a permission request that has not resolved yet.
    if (!running && !starting) return
    void stop().finally(() => callbacks.onStopped?.(reason))
  }
  const fail = (error: Error) => {
    void stop().finally(() => {
      callbacks.onError?.(error)
      callbacks.onStopped?.('error')
    })
  }
  function visibilityChanged() {
    if (document.visibilityState === 'hidden') interrupt('background')
  }
  function pageHidden() { interrupt('background') }

  const start = (): Promise<CaptureInfo> => {
    if (starting) return starting
    if (stopping) return stopping.then(start)
    if (running && info) return Promise.resolve(info)
    const token = ++generation
    const current = () => token === generation
    const ensureCurrent = () => {
      if (!current()) throw new DOMException('Capture was stopped.', 'AbortError')
    }
    const operation = (async (): Promise<CaptureInfo> => {
      if (typeof window === 'undefined') throw new Error('Microphone capture requires a browser or the mobile app.')
      if (document.visibilityState === 'hidden') throw new Error('Open the app before starting the microphone.')
      document.addEventListener('visibilitychange', visibilityChanged)
      window.addEventListener('pagehide', pageHidden)
      detector.reset()
      waveform.reset()
      outputFailed = false
      try {
        if (Capacitor.isNativePlatform()) {
          if (!Capacitor.isPluginAvailable('ForgettimeAudio')) {
            throw new Error('This mobile build is missing the Forgettime audio plugin. Rebuild and sync the native app.')
          }
          let nativeClock: { sessionId: string; sampleRate: number; endFrame: number } | undefined
          let nativeSession: string | undefined
          let nativeRate: number | undefined
          const pendingFrames: NativeAudioFrame[] = []
          type TerminalEvent = { sessionId?: string } & ({ message: string } | { reason: string })
          const pendingTerminals: TerminalEvent[] = []
          const receiveTerminal = (event: TerminalEvent) => {
            if (!current()) return
            if (!nativeSession) {
              if (pendingTerminals.length < 64) pendingTerminals.push(event)
              else fail(new Error('Native audio startup could not keep up. Restart listening.'))
              return
            }
            if (event.sessionId && event.sessionId !== nativeSession) return
            if ('message' in event) fail(new Error(event.message))
            else interrupt(event.reason)
          }
          let pendingSamples = 0
          const receiveNative = (frame: NativeAudioFrame) => {
            if (!current()) return
            if (!nativeSession) {
              pendingSamples += frame.pcm?.samples.length ?? 0
              if (pendingFrames.length >= 64 || pendingSamples > frame.sampleRate * 0.5) {
                fail(new Error('Native audio startup could not keep up. Restart listening.'))
              } else pendingFrames.push(frame)
              return
            }
            // An old native generation can still have events queued in the bridge.
            if (frame.sessionId && frame.sessionId !== nativeSession) return
            const pcm = frame.pcm
            if (!pcm || !frame.sessionId || typeof ForgettimeAudio.acknowledgeFrame !== 'function') {
              fail(new Error('This native audio plugin cannot retain recordings. Rebuild and sync the native app.'))
              return
            }
            if (!Number.isSafeInteger(pcm.startFrame) || pcm.startFrame < 0
              || !Number.isFinite(frame.sampleRate) || frame.sampleRate <= 0 || frame.sampleRate !== nativeRate
              || !Array.isArray(pcm.samples) || !pcm.samples.length || pcm.samples.length > 16384
              || !pcm.samples.every(sample => Number.isFinite(sample) && Number.isFinite(Math.fround(sample)))
              || (nativeClock && (nativeClock.sessionId !== frame.sessionId
                || nativeClock.sampleRate !== frame.sampleRate || nativeClock.endFrame !== pcm.startFrame))) {
              fail(new Error('Native audio capture was interrupted or changed format. Your captured material is preserved; restart listening.'))
              return
            }
            const endFrame = pcm.startFrame + pcm.samples.length
            nativeClock = { sessionId: frame.sessionId, sampleRate: frame.sampleRate, endFrame }
            callbacks.onFrame({ ...frame, source: 'native', pcm: {
              startFrame: pcm.startFrame, samples: Float32Array.from(pcm.samples),
            } })
            if (current()) {
              void ForgettimeAudio.acknowledgeFrame({ sessionId: frame.sessionId, endFrame }).catch(() => {
                if (current()) fail(new Error('Native audio retention is unavailable. Rebuild and sync the native app.'))
              })
            }
          }
          listeners.push(await ForgettimeAudio.addListener('audioFrame', receiveNative))
          ensureCurrent()
          listeners.push(await ForgettimeAudio.addListener('captureError', receiveTerminal))
          ensureCurrent()
          listeners.push(await ForgettimeAudio.addListener('captureStopped', receiveTerminal))
          ensureCurrent()
          // Set before awaiting, so stop() can cancel a native permission request.
          nativeStarted = true
          const nativeInfo = await ForgettimeAudio.start()
          ensureCurrent()
          if (!nativeInfo.sessionId) throw new Error('This native audio plugin cannot retain recordings. Rebuild and sync the native app.')
          nativeSession = nativeInfo.sessionId
          nativeRate = nativeInfo.sampleRate
          info = { ...nativeInfo, source: 'native' }
          for (const frame of pendingFrames) receiveNative(frame)
          pendingFrames.length = 0
          for (const event of pendingTerminals) receiveTerminal(event)
          pendingTerminals.length = 0
        } else {
          if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            throw new Error('Microphone access needs HTTPS or localhost and a supported browser.')
          }
          // Resume within the initiating user gesture, before permission/network awaits.
          context = new AudioContext({ latencyHint: 'interactive' })
          const currentContext = context
          await currentContext.resume()
          ensureCurrent()
          if (!currentContext.audioWorklet) throw new Error('This browser does not support AudioWorklet microphone capture.')
          const inputConstraints: MediaTrackConstraints & { latency: { ideal: number } } = {
            channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
            latency: { ideal: 0 },
            ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
          }
          const acquiredStream = await navigator.mediaDevices.getUserMedia({ audio: inputConstraints })
          if (!current()) {
            acquiredStream.getTracks().forEach((track) => track.stop())
            ensureCurrent()
          }
          stream = acquiredStream
          await currentContext.audioWorklet.addModule('/audio/capture-worklet.js')
          ensureCurrent()
          source = currentContext.createMediaStreamSource(acquiredStream)
          worklet = new AudioWorkletNode(currentContext, 'forgettime-capture', {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1,
          })
          let expectedFrame: number | undefined
          let inputInterrupted = false
          const resetInput = () => {
            expectedFrame = undefined
            detector.reset()
            waveform.reset()
            outputAlignment.reset()
            if (!inputInterrupted) callbacks.onDiscontinuity?.()
            inputInterrupted = true
          }
          type WorkletMessage = { type: 'gap' } | { type: 'samples'; samples: Float32Array; startFrame: number; sampleRate: number }
          worklet.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
            if (!current()) return
            if (event.data.type === 'gap') { resetInput(); return }
            const { samples, startFrame, sampleRate } = event.data
            if (acquiredStream.getAudioTracks().some(track => track.muted)) return
            if (expectedFrame !== undefined && Math.abs(expectedFrame - startFrame) > 2) {
              // Keep listening, but never score a new clock against an old beat.
              resetInput()
            }
            inputInterrupted = false
            expectedFrame = startFrame + samples.length
            const time = startFrame / sampleRate
            const onsets = detector.process(samples, time, sampleRate)
            let energy = 0
            for (const sample of samples) energy += sample * sample
            callbacks.onFrame({
              // Do not pause while a just-before-timeout attack is in a partial window.
              time: detector.processedThrough ?? time,
              onsets, level: Math.min(1, Math.sqrt(energy / samples.length)), sampleRate,
              waveform: waveform.process(samples, time, sampleRate),
              pcm: { startFrame, samples },
              source: 'web', timestampQuality: 'sample-clock',
            })
          }
          worklet.onprocessorerror = () => { if (current()) fail(new Error('Microphone audio processing stopped. Enable the microphone to restart.')) }
          acquiredStream.getAudioTracks().forEach((track) => {
            track.onended = () => { if (current()) fail(new Error('The microphone disconnected. Choose an available input and enable the microphone again.')) }
            track.onmute = () => { if (current()) resetInput() }
            track.onunmute = () => { if (current()) resetInput() }
          })
          source.connect(worklet)
          worklet.connect(currentContext.destination)
          const track = acquiredStream.getAudioTracks()[0]
          const settings = track?.getSettings()
          info = {
            source: 'web', sampleRate: currentContext.sampleRate, timestampQuality: 'sample-clock',
            inputLabel: track?.label, deviceId: settings?.deviceId,
            processing: {
              autoGainControl: settings?.autoGainControl,
              echoCancellation: settings?.echoCancellation,
              noiseSuppression: settings?.noiseSuppression,
            },
            latency: browserLatencyEstimate(currentContext, settings ?? {}),
          }
          currentContext.onstatechange = () => {
            if (current() && running && currentContext.state !== 'running') interrupt('audio-interrupted')
          }
        }
        ensureCurrent()
        running = true
        return info
      } catch (error) {
        await cleanup()
        throw error
      }
    })()
    starting = operation
    void operation.finally(() => { if (starting === operation) starting = undefined }).catch(() => undefined)
    return operation
  }

  const setMetronome = (plan: MetronomePlan | null) => {
    if (outputFailed) return
    if (worklet && context) {
      const estimate = browserLatencyEstimate(context, stream?.getAudioTracks()[0]?.getSettings() ?? {})
      worklet.port.postMessage({ type: 'metronome', plan: outputAlignment.align(plan, context.currentTime, estimate.correctionSeconds) })
      return
    }
    if (!nativeStarted) return
    if (!plan && !latestPlan && !outputPending) return
    latestPlan = plan
    if (outputPending) return
    // Coalesce bridge backpressure, always retaining the most recent plan/mute.
    const send = async () => {
      outputPending = true
      try {
        let sent: MetronomePlan | null
        do {
          sent = latestPlan
          await ForgettimeAudio.setMetronome({ plan: sent })
        } while (nativeStarted && sent !== latestPlan)
      } catch {
        outputFailed = true
        callbacks.onOutputError?.('Metronome output is unavailable. Rebuild the native app to update its audio plugin.')
      } finally { outputPending = false }
    }
    void send()
  }

  return { start, stop, setMetronome }
}
