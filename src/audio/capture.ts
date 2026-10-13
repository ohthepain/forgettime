import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { ForgettimeAudio } from 'forgettime-audio'
import { OnsetDetector, type DetectedOnset } from './onset-detector'

export interface CaptureInfo {
  source: 'native' | 'web'
  sampleRate: number
  timestampQuality: 'hardware' | 'sample-clock'
  inputLabel?: string
  deviceId?: string
}

export interface CaptureFrame extends CaptureInfo {
  /** Fully analyzed sample watermark, in seconds. Pass this to engine.snapshot(). */
  time: number
  /** These timestamps use the SAME clock as time, never callback arrival time. */
  onsets: DetectedOnset[]
  level: number
  hardwareTime?: number
}

export interface CaptureCallbacks {
  onFrame: (frame: CaptureFrame) => void
  onError?: (error: Error) => void
  onStopped?: (reason: string) => void
  /** Missing browser input invalidates the reference, but need not close the mic. */
  onDiscontinuity?: () => void
}

export interface AudioCapture {
  start: () => Promise<CaptureInfo>
  stop: () => Promise<void>
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
  const detector = new OnsetDetector()

  const cleanup = async () => {
    running = false
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
      try {
        if (Capacitor.isNativePlatform()) {
          if (!Capacitor.isPluginAvailable('ForgettimeAudio')) {
            throw new Error('This mobile build is missing the Forgettime audio plugin. Rebuild and sync the native app.')
          }
          listeners.push(await ForgettimeAudio.addListener('audioFrame', (frame) => {
            if (!current()) return
            callbacks.onFrame({ ...frame, source: 'native' })
          }))
          ensureCurrent()
          listeners.push(await ForgettimeAudio.addListener('captureError', ({ message }) => {
            if (current()) fail(new Error(message))
          }))
          ensureCurrent()
          listeners.push(await ForgettimeAudio.addListener('captureStopped', ({ reason }) => {
            if (current()) interrupt(reason)
          }))
          ensureCurrent()
          // Set before awaiting, so stop() can cancel a native permission request.
          nativeStarted = true
          const nativeInfo = await ForgettimeAudio.start()
          ensureCurrent()
          info = { ...nativeInfo, source: 'native' }
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
          const acquiredStream = await navigator.mediaDevices.getUserMedia({ audio: {
            channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
            ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
          } })
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
          info = {
            source: 'web', sampleRate: currentContext.sampleRate, timestampQuality: 'sample-clock',
            inputLabel: track?.label, deviceId: track?.getSettings().deviceId,
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

  return { start, stop }
}
