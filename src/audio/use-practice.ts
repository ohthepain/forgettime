import { useCallback, useEffect, useRef, useState } from 'react'
import { TimingEngine, type InterpretationMode } from './engine'
import { createAudioCapture, type CaptureInfo } from './capture'
import { Capacitor } from '@capacitor/core'
import { DEFAULT_START_SENSITIVITY } from './start-sensitivity'
import { BarWaveformBuffer, emptyWaveform } from './bar-waveform'
import { simulationWaveform } from './simulation-waveform'
import type { DetectedOnset } from './onset-detector'
import { DEFAULT_METRONOME, MetronomeCoach, type MetronomeOptions } from './metronome'

export type CaptureMode = 'single' | 'auto'
type Source = 'off' | 'microphone' | 'simulation'
export function usePractice(bpm: number, mode: InterpretationMode, startSensitivity = DEFAULT_START_SENSITIVITY, metronomeOptions = DEFAULT_METRONOME) {
  const engine = useRef(new TimingEngine({ bpm, mode, startSensitivity }))
  const waveformBuffer = useRef(new BarWaveformBuffer())
  const [waveform, setWaveform] = useState(emptyWaveform)
  const [waveformSource, setWaveformSource] = useState<'microphone' | 'simulation'>('microphone')
  const [snapshot, setSnapshot] = useState(() => engine.current.snapshot(0))
  const [source, setSource] = useState<Source>('off')
  const [captureMode, setCaptureMode] = useState<CaptureMode>('single')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [captureInfo, setCaptureInfo] = useState<CaptureInfo | null>(null)
  const [level, setLevel] = useState(0)
  const [captureNotice, setCaptureNotice] = useState<string | null>(null)
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([])
  const [canSelectInput, setCanSelectInput] = useState(false)
  const [deviceId, setDeviceId] = useState('')
  const capture = useRef<ReturnType<typeof createAudioCapture> | null>(null)
  const generation = useRef(0)
  const animation = useRef(0)
  const now = useRef(0)
  const coach = useRef(new MetronomeCoach())
  const outputOptions = useRef<MetronomeOptions>(metronomeOptions)
  const [metronomeActive, setMetronomeActive] = useState(false)
  const [outputNotice, setOutputNotice] = useState<string | null>(null)
  const outputFailed = useRef(false)

  const stop = useCallback(async (keepReview = true) => {
    generation.current++
    cancelAnimationFrame(animation.current)
    const previous = capture.current
    capture.current = null
    engine.current.stop()
    coach.current.reset()
    setMetronomeActive(false)
    setOutputNotice(null)
    outputFailed.current = false
    setWaveform(keepReview ? waveformBuffer.current.hold() : waveformBuffer.current.reset())
    setSource('off')
    setCaptureMode('single')
    setBusy(false)
    setLevel(0)
    setCaptureInfo(null)
    setCaptureNotice(null)
    setSnapshot(engine.current.snapshot(now.current))
    await previous?.stop()
  }, [])

  useEffect(() => {
    if (Capacitor.isNativePlatform() || !navigator.mediaDevices?.enumerateDevices) return
    const media = navigator.mediaDevices
    let active = true
    setCanSelectInput(true)
    const refresh = async () => {
      try {
        const devices = await media.enumerateDevices()
        if (active) setInputDevices(devices.filter(device => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default'))
      } catch { /* Some embedded browsers allow capture but not device enumeration. */ }
    }
    void refresh()
    media.addEventListener('devicechange', refresh)
    return () => { active = false; media.removeEventListener('devicechange', refresh) }
    // Refresh labels after microphone permission has been granted.
  }, [captureInfo])

  useEffect(() => {
    engine.current.configure({ bpm, mode, startSensitivity })
    setSnapshot(engine.current.snapshot(now.current))
  }, [bpm, mode, startSensitivity])

  useEffect(() => { setWaveform(waveformBuffer.current.reset()) }, [bpm, mode])

  useEffect(() => {
    outputOptions.current = metronomeOptions
    const state = coach.current.update(engine.current.snapshot(now.current), now.current, metronomeOptions)
    capture.current?.setMetronome(state.plan)
    setMetronomeActive(Boolean(state.plan) && !outputFailed.current)
  }, [bpm, mode, metronomeOptions.enabled, metronomeOptions.mode, metronomeOptions.thresholdMs])

  useEffect(() => {
    const onVisibility = () => { if (document.hidden) void stop(false) }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      generation.current++
      cancelAnimationFrame(animation.current)
      void capture.current?.stop()
    }
  }, [stop])

  const listen = useCallback(async (requestedMode: CaptureMode = 'single') => {
    const stopping = stop(false)
    const activeGeneration = ++generation.current
    await stopping
    if (generation.current !== activeGeneration) return
    setCaptureMode(requestedMode)
    setWaveformSource('microphone')
    setBusy(true)
    setError(null)
    now.current = 0
    engine.current.start(0)
    const audio = createAudioCapture({
      onFrame: frame => {
        if (generation.current !== activeGeneration) return
        now.current = frame.time
        for (const onset of frame.onsets) {
          // One packet can span the end of a take. A later onset must not
          // silently reopen single capture before we inspect the watermark.
          const deadline = engine.current.silenceDeadline
          if (requestedMode === 'single' && deadline !== null && onset.time >= deadline - 1e-9) {
            setWaveform(waveformBuffer.current.hold())
            void stop()
            return
          }
          engine.current.addOnset(onset)
        }
        const next = engine.current.snapshot(frame.time)
        const coaching = coach.current.update(next, frame.time, outputOptions.current)
        audio.setMetronome(coaching.plan)
        setMetronomeActive(Boolean(coaching.plan) && frame.metronomeAvailable !== false && !outputFailed.current)
        if (frame.metronomeAvailable === false && coaching.plan && frame.time > (next.phaseOrigin ?? frame.time) + 1) {
          setOutputNotice('Metronome is waiting for a reliable audio output clock. Try another audio device.')
        } else if (!outputFailed.current) setOutputNotice(null)
        setWaveform(waveformBuffer.current.addFrame(frame.time, frame.waveform, frame.onsets, next))
        setSnapshot(next)
        setCaptureNotice(notice => next.status === 'playing' ? null : notice ? 'Microphone input restored · play to set a fresh beat' : null)
        setLevel(frame.level)
        if (next.status === 'paused' && requestedMode === 'single') void stop()
      },
      onDiscontinuity: () => {
        if (generation.current !== activeGeneration) return
        engine.current.start(now.current)
        coach.current.reset()
        audio.setMetronome(null)
        setMetronomeActive(false)
        setWaveform(waveformBuffer.current.reset())
        setSnapshot(engine.current.snapshot(now.current))
        setLevel(0)
        setCaptureNotice('Microphone input interrupted · waiting for audio')
      },
      onError: message => {
        if (generation.current !== activeGeneration) return
        setError(message instanceof Error ? message.message : String(message))
        void stop()
      },
      onStopped: () => {
        if (generation.current === activeGeneration) void stop()
      },
      onOutputError: message => {
        if (generation.current !== activeGeneration) return
        outputFailed.current = true
        setOutputNotice(message)
        setMetronomeActive(false)
      },
    }, { deviceId })
    capture.current = audio
    try {
      const info = await audio.start()
      if (generation.current !== activeGeneration) { await audio.stop(); return }
      setCaptureInfo(info)
      setSource('microphone')
      setSnapshot(engine.current.snapshot(now.current))
    } catch (cause) {
      if (generation.current !== activeGeneration) return
      setError(cause instanceof Error && (cause.name === 'OverconstrainedError' || cause.name === 'NotFoundError')
        ? 'That microphone is unavailable. Choose another input and try again.'
        : cause instanceof Error ? cause.message : 'Microphone could not start. Check microphone permission and try again.')
      await stop()
    } finally {
      if (generation.current === activeGeneration) setBusy(false)
    }
  }, [stop, deviceId])

  const simulate = useCallback(async () => {
    await stop(false)
    setWaveformSource('simulation')
    setError(null)
    setSource('simulation')
    now.current = 0
    engine.current.start(0)
    let hitIndex = 0
    let previousTime = 0
    let demoHits: DetectedOnset[] = []
    const started = performance.now()
    const beatSeconds = 60 / bpm
    const tick = () => {
      const time = (performance.now() - started) / 1000
      now.current = time
      const freshHits: DetectedOnset[] = []
      // Demonstration timestamps only: never presented as microphone measurements.
      while (true) {
        const errorSeconds = hitIndex < 8 ? 0 : Math.sin(hitIndex * 1.13) * 0.032
        const hitTime = 0.4 + hitIndex * beatSeconds / 2 + errorSeconds
        if (hitTime > time) break
        const hit = { time: hitTime, strength: [0.85, 0.14, 0.5, 0.05, 0.28][hitIndex % 5], confidence: 0.95 }
        engine.current.addOnset(hit)
        freshHits.push(hit)
        hitIndex++
      }
      demoHits = [...demoHits, ...freshHits].filter(hit => hit.time >= time - 8.3)
      const next = engine.current.snapshot(time)
      setWaveform(waveformBuffer.current.addFrame(time, simulationWaveform(previousTime, time, demoHits), freshHits, next))
      previousTime = time
      setSnapshot(next)
      animation.current = requestAnimationFrame(tick)
    }
    animation.current = requestAnimationFrame(tick)
  }, [bpm, stop])

  return { snapshot, captureTime: now.current, waveform, waveformSource, source, captureMode, busy, error, captureInfo, captureNotice, outputNotice, metronomeActive, level, listen, stop, simulate, inputDevices, canSelectInput, deviceId, setDeviceId }
}
