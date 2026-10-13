import { useCallback, useEffect, useRef, useState } from 'react'
import { TimingEngine, type InterpretationMode } from './engine'
import { createAudioCapture, type CaptureInfo } from './capture'

type Source = 'off' | 'microphone' | 'simulation'
export function usePractice(bpm: number, mode: InterpretationMode) {
  const engine = useRef(new TimingEngine({ bpm, mode }))
  const [snapshot, setSnapshot] = useState(() => engine.current.snapshot(0))
  const [source, setSource] = useState<Source>('off')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [captureInfo, setCaptureInfo] = useState<CaptureInfo | null>(null)
  const [level, setLevel] = useState(0)
  const capture = useRef<ReturnType<typeof createAudioCapture> | null>(null)
  const generation = useRef(0)
  const animation = useRef(0)
  const now = useRef(0)

  const stop = useCallback(async () => {
    generation.current++
    cancelAnimationFrame(animation.current)
    const previous = capture.current
    capture.current = null
    engine.current.stop()
    setSource('off')
    setBusy(false)
    setLevel(0)
    setCaptureInfo(null)
    setSnapshot(engine.current.snapshot(now.current))
    await previous?.stop()
  }, [])

  useEffect(() => {
    engine.current.configure({ bpm, mode })
    setSnapshot(engine.current.snapshot(now.current))
  }, [bpm, mode])

  useEffect(() => {
    const onVisibility = () => { if (document.hidden) void stop() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      generation.current++
      cancelAnimationFrame(animation.current)
      void capture.current?.stop()
    }
  }, [stop])

  const listen = useCallback(async () => {
    await stop()
    const activeGeneration = ++generation.current
    setBusy(true)
    setError(null)
    now.current = 0
    engine.current.start(0)
    const audio = createAudioCapture({
      onFrame: frame => {
        if (generation.current !== activeGeneration) return
        now.current = frame.time
        for (const onset of frame.onsets) engine.current.addOnset(onset)
        setSnapshot(engine.current.snapshot(frame.time))
        setLevel(frame.level)
      },
      onError: message => {
        if (generation.current !== activeGeneration) return
        setError(message instanceof Error ? message.message : String(message))
        void stop()
      },
      onStopped: () => {
        if (generation.current === activeGeneration) void stop()
      },
    })
    capture.current = audio
    try {
      const info = await audio.start()
      if (generation.current !== activeGeneration) { await audio.stop(); return }
      setCaptureInfo(info)
      setSource('microphone')
      setSnapshot(engine.current.snapshot(now.current))
    } catch (cause) {
      if (generation.current !== activeGeneration) return
      setError(cause instanceof Error ? cause.message : 'Microphone could not start. Check microphone permission and try again.')
      await stop()
    } finally {
      if (generation.current === activeGeneration) setBusy(false)
    }
  }, [stop])

  const simulate = useCallback(async () => {
    await stop()
    setError(null)
    setSource('simulation')
    now.current = 0
    engine.current.start(0)
    let hitIndex = 0
    const started = performance.now()
    const beatSeconds = 60 / bpm
    const tick = () => {
      const time = (performance.now() - started) / 1000
      now.current = time
      // Demonstration timestamps only: never presented as microphone measurements.
      while (true) {
        const errorSeconds = hitIndex < 8 ? 0 : Math.sin(hitIndex * 1.13) * 0.032
        const hitTime = 0.4 + hitIndex * beatSeconds / 2 + errorSeconds
        if (hitTime > time) break
        engine.current.addOnset({ time: hitTime, strength: 0.8, confidence: 0.95 })
        hitIndex++
      }
      setSnapshot(engine.current.snapshot(time))
      animation.current = requestAnimationFrame(tick)
    }
    animation.current = requestAnimationFrame(tick)
  }, [bpm, stop])

  return { snapshot, source, busy, error, captureInfo, level, listen, stop, simulate }
}
