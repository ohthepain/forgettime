import { selectedMicrophoneProfile } from './live-detector'
import { createTrainingSampleCatalog } from './training-sample-catalog'
import { prepareTrainingImport, type PendingTrainingSample, type TrainingImportReport } from './training-import'
import { createLocalTrainingRepository } from './training-dataset'
import { DEFAULT_FREQUENCY_BALANCE, normalizeFrequencyBalance } from './frequency-evidence'
import { createLatestPerformanceRepository } from './latest-performance'
import { AutomaticGain } from './automatic-gain'
import { usePreferences } from '../lib/preferences'
import { createNativeBarFiles } from './native-files'
import { browserAudioImport, filenameTempo, prepareAudioImport, decodeImportAudio, importedMaterial, type ImportFile, type ImportState } from './audio-import'
import { createBarFiles, restoreBarFiles } from './bar-files'
import { createBrowserSavedBars, requestBrowserDownload, type BarFileOptions, type SavedBarSummary } from './saved-bars'
import { DEFAULT_DETECTOR_SETTINGS, normalizeDetectorSettings, MAX_DIAGNOSTIC_CANDIDATES, type ReviewedCandidate, type DetectorSettings } from './detector-contract'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TimingEngine, type InterpretationMode } from './engine'
import { createAudioCapture, type CaptureInfo } from './capture'
import { Capacitor } from '@capacitor/core'
import { createBarReplay, type BarReplay, type ReplayState } from './replay'
import { DEFAULT_START_SENSITIVITY } from './start-sensitivity'
import { DEFAULT_INPUT_GAIN } from './input-gain'
import { DEFAULT_DETECTION_SENSITIVITY, sensitivitySettings } from './detector-sensitivity'
import { BarWaveformBuffer, emptyWaveform } from './bar-waveform'
import { simulationWaveform } from './simulation-waveform'
import type { DetectedOnset } from './onset-detector'
import { DEFAULT_METRONOME, MetronomeCoach, type MetronomeOptions } from './metronome'

export type CaptureMode = 'single' | 'auto'
import { TakeRecorder, recordedBar, recordedBarCount, initialReviewBar, type RecordedTake, type TakeEndReason } from './recorded-take'
type Source = 'off' | 'microphone' | 'simulation' | 'replay'
export function usePractice(bpm: number, mode: InterpretationMode, inputGain = DEFAULT_INPUT_GAIN, metronomeOptions = DEFAULT_METRONOME, fileOptions: BarFileOptions = {}) {
  const latestPerformance = useMemo(() => fileOptions.latestPerformance === undefined
    ? (typeof indexedDB === 'undefined' ? null : createLatestPerformanceRepository()) : fileOptions.latestPerformance, [])
  const [latestLoaded, setLatestLoaded] = useState(false)
  const reviewEdited = useRef(false)
  const startSensitivity = DEFAULT_START_SENSITIVITY // Legacy sidecar field, not an active live control.
  const automaticGain = useRef(new AutomaticGain())
  const [gainAdjustment, setGainAdjustment] = useState({ adjusting: false, limited: false, take: 0 })
  const gainTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  function stopGainAdjustment() {
    if (gainTimer.current !== null) clearInterval(gainTimer.current)
    gainTimer.current = null
    automaticGain.current.stop()
    setGainAdjustment(value => ({ ...value, adjusting: false }))
  }
  function manualInputGain() { automaticGain.current.manual(); stopGainAdjustment() }
  const gain = useRef(inputGain)
  gain.current = inputGain
  const [frequencyBalance, setFrequencyBalance] = useState(DEFAULT_FREQUENCY_BALANCE)
  const balance = useRef(DEFAULT_FREQUENCY_BALANCE)
  const [detectionSensitivity, setDetectionSensitivity] = useState<number | null>(DEFAULT_DETECTION_SENSITIVITY)
  const platformFiles = useMemo(() => Capacitor.isNativePlatform() ? createNativeBarFiles() : {}, [])
  const importer = useRef(fileOptions.importer ?? platformFiles.importer ?? browserAudioImport)
  const pairedExport = useRef(fileOptions.exportPair ?? platformFiles.exportPair)
  const [importState, setImportState] = useState<ImportState | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const [trainingSamples, setTrainingSamples] = useState<PendingTrainingSample[]>([])
  const pendingSamples = useRef<PendingTrainingSample[]>([])
  const sampleCatalog = useMemo(() => fileOptions.trainingSamples === undefined ? (typeof indexedDB === 'undefined' ? null : createTrainingSampleCatalog()) : fileOptions.trainingSamples, []);
  const catalogReady = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let alive = true;
    catalogReady.current = sampleCatalog ? sampleCatalog.read().then(samples => {
      if (alive) { pendingSamples.current = samples; setTrainingSamples(samples); }
    }) : Promise.resolve();
    void catalogReady.current.catch(cause => { if (alive) setImportError((cause as Error).message); });
    return () => { alive = false; };
  }, [sampleCatalog]);
  const [trainingImportReport, setTrainingImportReport] = useState<TrainingImportReport>({ duplicates: [], errors: [] })
  const importGeneration = useRef(0)
  const repository = useRef(fileOptions.savedBars ?? platformFiles.savedBars ?? (!Capacitor.isNativePlatform() && typeof indexedDB !== 'undefined' ? createBrowserSavedBars() : undefined))
  const download = useRef(fileOptions.exportFile ?? requestBrowserDownload)
  const [savedBars, setSavedBars] = useState<SavedBarSummary[]>([])
  const [savedBarsSupported, setSavedBarsSupported] = useState<boolean | null>(null)
  const libraryOperation = useRef(0)
  const [libraryBusy, setLibraryBusy] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [libraryNotice, setLibraryNotice] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setSavedBarsSupported(Boolean(repository.current))
    void repository.current?.list().then(list => { if (active) setSavedBars(list) }).catch(cause => { if (active) setLibraryError(String(cause)) })
    return () => { active = false }
  }, [])
  const [detectorSettings, setDetectorSettings] = useState<DetectorSettings>({ ...DEFAULT_DETECTOR_SETTINGS })
  const detectorOptions = useRef<DetectorSettings>({ ...DEFAULT_DETECTOR_SETTINGS })
  const [liveDiagnostics, setLiveDiagnostics] = useState<{ candidates: ReviewedCandidate[]; dropped: number; supported: boolean }>({ candidates: [], dropped: 0, supported: false })
  const replay = useRef<BarReplay | null>(null)
  const [replayState, setReplayState] = useState<ReplayState | null>(null)
  const recorder = useRef(new TakeRecorder())
  const engine = useRef(new TimingEngine({ bpm, mode, startSensitivity, liveMinimumStrength: 0 }, hit => recorder.current.resolve(hit)))
  const [recordedTake, setRecordedTake] = useState<RecordedTake | null>(null)
  const [reviewBarIndex, setReviewBarIndex] = useState(0)
  const [recordingNotice, setRecordingNotice] = useState<string | null>(null)
  const settings = useRef({ bpm, mode, startSensitivity })
  const retainTake = useCallback((take: RecordedTake | null) => {
    if (!take) return
    setRecordedTake(take)
    balance.current = DEFAULT_FREQUENCY_BALANCE; setFrequencyBalance(balance.current)
    setReviewBarIndex(initialReviewBar(take))
  }, [])
  const finishTake = useCallback((reason: TakeEndReason, endTime?: number) => {
    const take = recorder.current.finish(reason, endTime)
    retainTake(take)
    if (take) {
      automaticGain.current.disabled = false
      setGainAdjustment(value => ({ ...value, take: value.take + 1 }))
    }
  }, [retainTake])
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
    stopGainAdjustment()
    generation.current++
    cancelAnimationFrame(animation.current)
    const previousReplay = replay.current
    replay.current = null
    const previous = capture.current
    capture.current = null
    if (keepReview) finishTake('stopped')
    recorder.current.resetContinuity()
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
    await Promise.all([previous?.stop(), previousReplay?.stop()])
  }, [finishTake])

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
    const changed = () => { usePreferences.getState().setAudioCalibration(null); void refresh() }
    media.addEventListener('devicechange', changed)
    return () => { active = false; media.removeEventListener('devicechange', changed) }
    // Refresh labels after microphone permission has been granted.
  }, [captureInfo])

  useEffect(() => {
    if (settings.current.bpm !== bpm || settings.current.mode !== mode) {
      finishTake('interrupted')
      recorder.current.resetContinuity()
    }
    settings.current = { bpm, mode, startSensitivity }
    if (replay.current) return
    engine.current.configure({ bpm, mode, startSensitivity })
    setSnapshot(engine.current.snapshot(now.current))
  }, [bpm, mode, startSensitivity])

  useEffect(() => { capture.current?.setInputGain?.(inputGain) }, [inputGain])

  useEffect(() => { setWaveform(waveformBuffer.current.reset()) }, [bpm, mode])

  useEffect(() => {
    outputOptions.current = metronomeOptions
    replay.current?.setMetronome(metronomeOptions)
    if (replay.current) return
    const state = coach.current.update(engine.current.snapshot(now.current), now.current, metronomeOptions)
    capture.current?.setMetronome(state.plan)
    setMetronomeActive(Boolean(state.plan) && !outputFailed.current)
  }, [bpm, mode, metronomeOptions.enabled, metronomeOptions.mode, metronomeOptions.thresholdMs])

  useEffect(() => {
    const onVisibility = () => { if (document.hidden) { finishTake('interrupted'); void stop() } }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (gainTimer.current !== null) clearInterval(gainTimer.current)
      generation.current++
      cancelAnimationFrame(animation.current)
      void capture.current?.stop()
      void replay.current?.stop()
    }
  }, [stop])

  const listen = useCallback(async (requestedMode: CaptureMode = 'single') => {
    const stopping = stop(false)
    const activeGeneration = ++generation.current
    await stopping
    if (generation.current !== activeGeneration) return
    setReplayState(null)
    setLiveDiagnostics({ candidates: [], dropped: 0, supported: false })
    engine.current.configure(settings.current)
    setRecordingNotice(null)
    setCaptureMode(requestedMode)
    setWaveformSource('microphone')
    setBusy(true)
    setError(null)
    now.current = 0
    engine.current.start(0)
    automaticGain.current.reset()
    setGainAdjustment(value => ({ adjusting: false, limited: false, take: value.take + 1 }))
    const captureGain = gain.current
    const microphoneProfile = selectedMicrophoneProfile()
    const audio = createAudioCapture({
      onFrame: frame => {
        if (generation.current !== activeGeneration) return
        now.current = frame.time
        if (frame.pcm && frame.inputGain !== undefined) {
          automaticGain.current.observe(frame.pcm.samples, frame.inputGain, gain.current, performance.now())
          setGainAdjustment(value => ({ ...value, adjusting: automaticGain.current.adjusting, limited: automaticGain.current.limited }))
          if (automaticGain.current.adjusting && gainTimer.current === null) {
            gainTimer.current = setInterval(() => {
              const value = automaticGain.current.tick(performance.now())
              if (value !== null) {
                gain.current = value
                audio.setInputGain?.(value)
                usePreferences.getState().setInputGain(value)
              }
              if (!automaticGain.current.adjusting) stopGainAdjustment()
            }, 16)
          }
        }
        if (frame.pcm) {
          const interrupted = recorder.current.append(frame.pcm, frame.sampleRate)
          if (interrupted) {
            retainTake(interrupted)
            engine.current.start(frame.pcm.startFrame / frame.sampleRate)
            coach.current.reset()
            setCaptureNotice('Recording interrupted · a new take needs a fresh beat')
          }
        } else setRecordingNotice('Recorded bar review unavailable · update the mobile audio plugin')
        const candidates: ReviewedCandidate[] = frame.diagnostics?.candidates.map(candidate => ({ ...candidate })) ?? []
        recorder.current.appendDiagnostics(frame.diagnostics)
        const acceptedOnsets: typeof frame.onsets = []
        for (const onset of frame.onsets) {
          if (recorder.current.limitTime !== null && onset.time >= recorder.current.limitTime) break
          const deadline = engine.current.silenceDeadline
          if (deadline !== null && onset.time >= deadline - 1e-9) {
            engine.current.snapshot(deadline)
            finishTake('silence', deadline)
            if (requestedMode === 'single') { void stop(); return }
          }
          engine.current.addOnset(onset)
          const state = engine.current.snapshot(onset.time)
          if (state.status === 'playing' && state.phaseOrigin === onset.time) {
            setRecordedTake(null)
            recorder.current.begin(onset.time, { ...settings.current, detector: microphoneProfile ? microphoneProfile.family === 'current' ? { version: 1, minimumRms: microphoneProfile.minimumRms, contrastRatio: microphoneProfile.contrastRatio, minSeparationMs: microphoneProfile.minSeparationMs, recoverySeconds: microphoneProfile.recoverySeconds } : undefined : frame.source === 'web' || frame.diagnostics ? { ...DEFAULT_DETECTOR_SETTINGS } : undefined }, frame.source, frame.analysis)
          }
          const acquisition: ReviewedCandidate['acquisition'] = state.phaseOrigin === onset.time ? 'started'
            : state.lastHitTime === onset.time ? 'not-required'
            : 'low-confidence'
          const acquisitionGate = acquisition === 'not-required' ? undefined : { minimumStrength: 0, minimumConfidence: 0.55 }
          recorder.current.annotateCandidate(onset.time, acquisition, acquisitionGate)
          const candidate = candidates.find(candidate => candidate.accepted && candidate.time === onset.time)
          if (candidate) { candidate.acquisition = acquisition; candidate.acquisitionGate = acquisitionGate }
          if (state.lastHitTime === onset.time) { recorder.current.accept(onset); acceptedOnsets.push(onset) }
        }
        if (frame.diagnostics) setLiveDiagnostics(previous => {
          const combined = [...previous.candidates, ...candidates]
          return { candidates: combined.slice(-MAX_DIAGNOSTIC_CANDIDATES), supported: true,
            dropped: previous.dropped + frame.diagnostics!.dropped + Math.max(0, combined.length - MAX_DIAGNOSTIC_CANDIDATES) }
        })
        const next = engine.current.snapshot(frame.time)
        if (next.status === 'paused' && recorder.current.recording) {
          finishTake('silence', next.lastHitTime === null || next.lastHitTime === undefined ? frame.time : next.lastHitTime + 240 / next.bpm)
        }
        const coaching = coach.current.update(next, frame.time, outputOptions.current)
        audio.setMetronome(coaching.plan)
        setMetronomeActive(Boolean(coaching.plan) && frame.metronomeAvailable !== false && !outputFailed.current)
        if (frame.metronomeAvailable === false && coaching.plan && frame.time > (next.phaseOrigin ?? frame.time) + 1) {
          setOutputNotice('Metronome is waiting for a reliable audio output clock. Try another audio device.')
        } else if (!outputFailed.current) setOutputNotice(null)
        setWaveform(waveformBuffer.current.addFrame(frame.time, frame.waveform, acceptedOnsets, next))
        setSnapshot(next)
        setCaptureNotice(notice => next.status === 'playing' ? null : notice ? 'Microphone input restored · play to set a fresh beat' : null)
        setLevel(frame.level)
        if (recorder.current.limitReached) {
          finishTake('limit', recorder.current.limitTime!)
          setRecordingNotice('Recording reached the 2-minute limit. Your take is available for review.')
          void stop()
        } else if (next.status === 'paused' && requestedMode === 'single') void stop()
      },
      onDiscontinuity: () => {
        if (generation.current !== activeGeneration) return
        finishTake('interrupted')
        recorder.current.resetContinuity()
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
        finishTake('interrupted')
        void stop()
      },
      onStopped: () => {
        if (generation.current === activeGeneration) { finishTake('interrupted'); void stop() }
      },
      onOutputError: message => {
        if (generation.current !== activeGeneration) return
        outputFailed.current = true
        setOutputNotice(message)
        setMetronomeActive(false)
      },
    }, { deviceId, detectorSettings: { ...DEFAULT_DETECTOR_SETTINGS }, inputGain: captureGain, profile: microphoneProfile })
    capture.current = audio
    try {
      const info = await audio.start()
      if (generation.current !== activeGeneration) { await audio.stop(); return }
      if (gain.current !== captureGain) audio.setInputGain?.(gain.current)
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
  }, [stop, deviceId, finishTake, retainTake])

  const simulate = useCallback(async () => {
    await stop(false)
    setReplayState(null)
    engine.current.configure(settings.current)
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

  const reviewBarCount = recordedTake ? recordedBarCount(recordedTake) : 0
  const reviewBar = useMemo(() => recordedTake ? recordedBar(recordedTake, reviewBarIndex) : null, [recordedTake, reviewBarIndex])
  const playBar = useCallback(async (index = reviewBarIndex) => {
    if (!recordedTake) return
    const stopping = stop()
    const activeGeneration = ++generation.current
    await stopping
    if (generation.current !== activeGeneration) return
    setError(null)
    setReplayState(null)
    setReviewBarIndex(index)
    try {
      const output = createBarReplay(recordedTake, index, state => {
        if (generation.current !== activeGeneration) return
        now.current = state.time
        setReplayState(state)
        setMetronomeActive(state.metronomeActive)
        setSnapshot(state.snapshot)
      }, message => {
        if (generation.current !== activeGeneration) return
        setError(message)
        void stop()
      }, detectorOptions.current, balance.current)
      replay.current = output
      output.setMetronome(outputOptions.current)
      await output.start()
      if (generation.current !== activeGeneration) { await output.stop(); return }
      setSource('replay')
    } catch (cause) {
      if (generation.current !== activeGeneration) return
      setError(cause instanceof Error ? cause.message : 'Recorded playback could not start.')
      await stop()
    }
  }, [recordedTake, reviewBarIndex, stop])
  // Settings controls call this boundary to begin an equivalent fresh run.
  const restartReplay = useCallback(async () => { if (replay.current) await playBar() }, [playBar])
  const configureDetector = useCallback(async (patch: Partial<DetectorSettings>) => {
    if (capture.current || busy) return
    reviewEdited.current = true
    const next = normalizeDetectorSettings({ ...detectorOptions.current, ...patch })
    if (JSON.stringify(next) === JSON.stringify(detectorOptions.current)) return
    detectorOptions.current = next
    setDetectorSettings(next)
    setDetectionSensitivity(null)
    if (replay.current) await playBar()
  }, [playBar, busy])
  const configureSensitivity = useCallback(async (value: number) => {
    if (capture.current || busy || !Number.isFinite(value)) return
    const bounded = Math.round(Math.max(0, Math.min(100, value)))
    const operation = configureDetector(sensitivitySettings(bounded))
    setDetectionSensitivity(bounded)
    await operation
  }, [configureDetector, busy])
  const configureBalance = useCallback(async (value: number) => {
    if (capture.current || busy || !Number.isFinite(value)) return
    reviewEdited.current = true
    const next = normalizeFrequencyBalance(value)
    if (next === balance.current) return
    balance.current = next; setFrequencyBalance(next)
    if (replay.current) await playBar()
  }, [playBar, busy])
  const resetDetector = useCallback(() => configureSensitivity(DEFAULT_DETECTION_SENSITIVITY), [configureSensitivity])
  const reviewCurrentBar = useCallback(async () => { await stop() }, [stop])
  const selectBar = useCallback(async (index: number) => {
    if (index === reviewBarIndex) return
    if (replay.current && recordedTake && recordedBar(recordedTake, index).complete) await playBar(index)
    else { await stop(); setReplayState(null); setReviewBarIndex(index) }
  }, [reviewBarIndex, recordedTake, playBar, stop])
  const previousBar = useCallback(() => selectBar(Math.max(0, reviewBarIndex - 1)), [selectBar, reviewBarIndex])
  const nextBar = useCallback(() => selectBar(Math.min(reviewBarCount - 1, reviewBarIndex + 1)), [selectBar, reviewBarCount, reviewBarIndex])

  const installMaterial = useCallback((take: RecordedTake) => {
    setError(null)
    setImportState(null); setImportError(null); setImportNotice(null); setImportBusy(false)
    balance.current = DEFAULT_FREQUENCY_BALANCE; setFrequencyBalance(balance.current)
    setRecordedTake(take); setReviewBarIndex(0); setReplayState(null); setRecordingNotice(null)
    setLiveDiagnostics({ candidates: [], dropped: 0, supported: false })
    if (take.settings.detector) { detectorOptions.current = { ...take.settings.detector }; setDetectorSettings(detectorOptions.current); setDetectionSensitivity(null) }
  }, [])
  useEffect(() => {
    let active = true
    const startingGeneration = generation.current
    void latestPerformance?.read().then(performance => {
      if (!active || !performance || generation.current !== startingGeneration || reviewEdited.current) return
      installMaterial(performance.take)
      setReviewBarIndex(performance.review.barIndex)
      detectorOptions.current = { ...performance.review.detector }
      setDetectorSettings(detectorOptions.current)
      setDetectionSensitivity(performance.review.detectionSensitivity)
      balance.current = performance.review.frequencyBalance
      setFrequencyBalance(balance.current)
      usePreferences.setState({ bpm: performance.take.settings.bpm, mode: performance.take.settings.mode })
    }).catch(() => {}).finally(() => { if (active) setLatestLoaded(true) })
    if (!latestPerformance) setLatestLoaded(true)
    return () => { active = false }
  }, [latestPerformance, installMaterial])
  useEffect(() => {
    if (!latestLoaded || !latestPerformance || !recordedTake) return
    // No active-take checkpoints or unload writes; complete replacements are atomic.
    void latestPerformance.save({ take: recordedTake, review: {
      barIndex: reviewBarIndex, detectionSensitivity, detector: detectorSettings, frequencyBalance,
    } }).catch(() => {})
  }, [latestLoaded, latestPerformance, recordedTake, reviewBarIndex, detectionSensitivity, detectorSettings, frequencyBalance])

  /** Import adapters validate their material before installing it here. Never starts a microphone. */
  const openRecordedMaterial = useCallback(async (take: RecordedTake) => {
    const stopping = stop(); const activeGeneration = ++generation.current
    await stopping
    if (generation.current === activeGeneration) installMaterial(take)
  }, [stop, installMaterial])
  const beginImport = useCallback(async () => {
    const stopping = stop()
    const active = ++generation.current; importGeneration.current = active
    setImportState(null); setImportError(null); setImportNotice(null); setImportBusy(false)
    await stopping
    return active
  }, [stop])
  const cancelImport = useCallback(async () => { await beginImport(); setImportNotice('Import cancelled. Previous review is available; microphone is off.') }, [beginImport])
  const importFiles = useCallback(async (files: readonly ImportFile[], directAnnotation = false) => {
    const active = await beginImport()
    if (generation.current !== active) return
    if (!files.length) { setImportNotice('No files selected. Previous review is available; microphone is off.'); return }
    setImportBusy(true)
    try {
      if (directAnnotation) {
        setTrainingImportReport({ duplicates: [], errors: [] });
        await catalogReady.current;
        const stored = typeof indexedDB !== 'undefined' ? await createLocalTrainingRepository().read() : null;
        if (generation.current !== active) return;
        const included = new Set(stored?.dataset.manifest.sources.map(source => source.checksum) ?? []);
        const retained = pendingSamples.current;
        const known = new Set([...included, ...retained.map(sample => sample.checksum)]);
        const bytes = retained.filter(sample => !included.has(sample.checksum)).reduce((sum, sample) => sum + sample.take.audio.samples.byteLength, 0) + Object.values(stored?.dataset.audio ?? {}).reduce((sum, pcm) => sum + pcm.byteLength, 0);
        const batch = await prepareTrainingImport(files, importer.current, { ...settings.current }, known, bytes, Math.max(0, 100 - known.size), () => generation.current === active);
        if (generation.current !== active) return;
        const nextSamples = sampleCatalog && batch.samples.length ? await sampleCatalog.add(batch.samples) : [...retained, ...batch.samples];
        if (generation.current !== active) return;
        pendingSamples.current = nextSamples;
        setTrainingSamples(nextSamples);
        setTrainingImportReport(batch.report);
        if (batch.fallback) setImportState({ ...batch.fallback, bpm: filenameTempo(batch.fallback.file.name) ?? settings.current.bpm });
        else if (batch.samples[0]) installMaterial(batch.samples[0].take);
        if (batch.samples.length) setImportNotice(`${batch.samples.length} samples loaded.`);
        return;
      }
      const prepared = await prepareAudioImport(files, importer.current)
      if (generation.current !== active) return
      if (prepared.kind === 'restored') { installMaterial(prepared.take); setImportNotice('Audio and original context restored from the matching .forget file.') }
      else {
        const bpm = filenameTempo(prepared.file.name) ?? settings.current.bpm;
        if (directAnnotation && prepared.kind === 'setup') {
          installMaterial(importedMaterial({ ...prepared, bpm }, { ...settings.current, bpm }, 0));
        } else setImportState({ ...prepared, bpm });
      }
    } catch (cause) { if (generation.current === active) setImportError(cause instanceof Error ? cause.message : 'Import failed.') }
    finally { if (importGeneration.current === active) setImportBusy(false) }
  }, [beginImport, installMaterial, sampleCatalog])
  const chooseImportFiles = useCallback(async (directAnnotation = false) => {
    const active = await beginImport()
    if (!importer.current.pick) return
    try {
      const files = await importer.current.pick()
      if (generation.current === active) await importFiles(files, directAnnotation)
    } catch (cause) { if (generation.current === active) setImportError(cause instanceof Error ? cause.message : 'File selection failed.') }
  }, [beginImport, importFiles])
  const useImportAudioOnly = useCallback(async (directAnnotation = false) => {
    if (importState?.kind !== 'fallback' || importBusy) return
    if (directAnnotation) { await importFiles([importState.file], true); return; }
    const active = importGeneration.current
    setImportBusy(true); setImportError(null)
    try {
      const audio = await decodeImportAudio(importState.file, importState.bytes, importer.current)
      if (generation.current === active) {
        const setup = { kind: 'setup' as const, file: importState.file, bpm: importState.bpm, audio, explanation: 'Using audio only. Original metadata and detection results were not restored.' };
        if (directAnnotation) installMaterial(importedMaterial(setup, { ...settings.current, bpm: setup.bpm }, 0));
        else setImportState(setup);
      }
    } catch (cause) { if (generation.current === active) setImportError(cause instanceof Error ? cause.message : 'Audio decoding failed.') }
    finally { if (importGeneration.current === active) setImportBusy(false) }
  }, [importState, importBusy, installMaterial, importFiles])
  const confirmImport = useCallback(async (confirmedBpm: number, beatOne: number) => {
    if (importState?.kind !== 'setup' || importBusy || generation.current !== importGeneration.current) return
    try {
      const take = importedMaterial(importState, { ...settings.current, bpm: confirmedBpm }, beatOne)
      await openRecordedMaterial(take)
      setImportState(null); setImportError(null); setImportNotice('Audio imported with your fixed tempo and beat-one reference. Original detection results are unavailable.')
    } catch (cause) { setImportError(cause instanceof Error ? cause.message : 'Invalid tempo or beat one.') }
  }, [importState, importBusy, openRecordedMaterial])

  const saveSelectedBar = useCallback(async () => {
    if (!recordedTake || !repository.current || libraryBusy) return
    setLibraryBusy(true); setLibraryError(null); setLibraryNotice(null)
    try {
      await stop()
      const files = await createBarFiles(recordedTake, reviewBarIndex)
      const bar = recordedBar(recordedTake, reviewBarIndex), id = crypto.randomUUID()
      await repository.current.save({ ...files, id, name: `Bar ${reviewBarIndex + 1} · ${recordedTake.settings.bpm} BPM`, createdAt: Date.now(), bpm: recordedTake.settings.bpm, complete: bar.complete, bytes: files.wav.byteLength + new TextEncoder().encode(files.sidecar).length })
      setSavedBars(await repository.current.list()); setLibraryNotice(pairedExport.current ? 'Bar saved on this device. Export both files for a portable copy.' : 'Bar saved on this device. WAV and .forget downloads are separate actions.')
    } catch (cause) { setLibraryError(cause instanceof Error ? cause.message : 'Local save failed.') }
    finally { setLibraryBusy(false) }
  }, [recordedTake, reviewBarIndex, libraryBusy, stop])
  const openSavedBar = useCallback(async (id: string) => {
    if (!repository.current) return
    const operation = ++libraryOperation.current
    const stopping = stop(); const activeGeneration = ++generation.current
    setLibraryBusy(true); setLibraryError(null); setLibraryNotice(null)
    try {
      await stopping
      const take = await restoreBarFiles(await repository.current.read(id))
      if (generation.current === activeGeneration) installMaterial(take)
    } catch (cause) { if (generation.current === activeGeneration) setLibraryError(cause instanceof Error ? cause.message : 'Saved bar could not be opened.') }
    finally { if (libraryOperation.current === operation) setLibraryBusy(false) }
  }, [stop, installMaterial])
  const exportSavedPair = useCallback(async (id: string) => {
    if (!repository.current || !pairedExport.current || libraryBusy) return
    setLibraryBusy(true); setLibraryError(null); setLibraryNotice(null)
    try {
      await restoreBarFiles(await repository.current.read(id))
      const status = await pairedExport.current(id)
      setLibraryNotice(status === 'cancelled' ? 'Export cancelled. The local saved pair is retained.' : 'Both files were offered to the system share sheet. Check your chosen destination; the local pair is retained.')
    } catch (cause) { setLibraryError(`${cause instanceof Error ? cause.message : 'Export failed.'} The local saved pair is retained.`) }
    finally { setLibraryBusy(false) }
  }, [libraryBusy])
  const exportSavedFile = useCallback(async (id: string, extension: 'wav' | 'forget') => {
    if (!repository.current || libraryBusy) return
    setLibraryBusy(true); setLibraryError(null); setLibraryNotice(null)
    try {
      const record = await repository.current.read(id)
      await restoreBarFiles(record)
      await download.current(`forgettime-${id}.${extension}`, extension === 'wav' ? record.wav : record.sidecar, extension === 'wav' ? 'audio/wav' : 'application/json')
      setLibraryNotice(`${extension === 'wav' ? 'WAV' : '.forget'} download requested. Check browser downloads; the local pair is retained.`)
    } catch (cause) { setLibraryError(`${cause instanceof Error ? cause.message : 'Download failed.'} The local saved pair is retained.`) }
    finally { setLibraryBusy(false) }
  }, [libraryBusy])

  return { trainingSamples, trainingImportReport, frequencyBalance, configureBalance, gainAdjustment, manualInputGain, detectionSensitivity, configureSensitivity, exportSavedPair, pairedExportSupported: Boolean(pairedExport.current), importState, importBusy, importError, importNotice, beginImport, cancelImport, importFiles, chooseImportFiles, useImportAudioOnly, confirmImport, nativeImportPicker: Boolean(importer.current.pick), savedBars, libraryBusy, libraryError, libraryNotice, savedBarsSupported, saveSelectedBar, openSavedBar, exportSavedFile, openRecordedMaterial, liveDiagnostics, detectorSettings, configureDetector, resetDetector, detectorSettingsSupported: source !== 'microphone' && !busy, playBar, restartReplay, replayState, recordedTake, reviewBar, reviewBarIndex, reviewBarCount, previousBar, nextBar, reviewCurrentBar, recordingNotice, snapshot, captureTime: now.current, waveform, waveformSource, source, captureMode, busy, error, captureInfo, captureNotice, outputNotice, metronomeActive, level, listen, stop, simulate, inputDevices, canSelectInput, deviceId, setDeviceId }
}
