import { createPortal } from 'react-dom'
import { calibrateAudio } from '../audio/calibration'
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { MetronomeSettings } from './MetronomeSettings'
import { usePreferences } from '../lib/preferences'

export function SettingsDialog({ onClose, metronomeActive = false, simulation = false, prepareCalibration, deviceId = '' }: { onClose: () => void; metronomeActive?: boolean; simulation?: boolean; prepareCalibration?: () => Promise<void>; deviceId?: string }) {
  const [stage, setStage] = useState<'settings' | 'instructions' | 'running' | 'complete' | 'error'>('settings')
  const [message, setMessage] = useState('')
  const controller = useRef<AbortController | null>(null)
  const calibration = usePreferences(s => s.audioCalibration)
  useEffect(() => () => controller.current?.abort(), [])
  async function startCalibration() {
    const run = new AbortController()
    controller.current = run
    setStage('running')
    try {
      await prepareCalibration?.()
      if (run.signal.aborted) return
      const result = await calibrateAudio(run.signal, deviceId)
      if (run.signal.aborted) return
      usePreferences.getState().setAudioCalibration(result)
      setStage('complete')
    } catch (error) {
      if (!run.signal.aborted) { setMessage(error instanceof Error ? error.message : 'Calibration failed.'); setStage('error') }
    }
  }
  useEffect(() => {
    if (stage !== 'running') return
    const main = document.querySelector('main')
    if (!main) return
    const previous = main.inert
    main.inert = true
    return () => { main.inert = previous }
  }, [stage])
  const dialog = useRef<HTMLDialogElement>(null)
  const { helpThresholdMs, setHelpThresholdMs } = usePreferences()
  useEffect(() => {
    const element = dialog.current!
    const trigger = document.activeElement
    if (stage !== 'running') element.showModal()
    return () => {
      element.close()
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [stage])

  return <>{stage === 'running' && createPortal(<div className="calibration-running" role="status"><p>Calibrating… Keep quiet while eight clicks play.</p><button onClick={() => { controller.current?.abort(); onClose() }}>Cancel calibration</button></div>, document.body)}<dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title"
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
    }}>
    <button className="icon-button close-dialog" aria-label="Close settings" onClick={onClose}><X size={20} /></button>
    <h2 id="settings-title">{stage === 'settings' ? 'Settings' : stage === 'complete' ? 'Calibration complete' : stage === 'error' ? 'Calibration could not finish' : 'Calibrate audio timing'}</h2>
    {stage === 'instructions' && <><p>Turn up your speaker volume so the microphone can hear it, then stay quiet while we play eight metronome clicks. Do not play along. Use speakers, not headphones.</p><p>Audio stays on this device and is discarded after measurement. Recalibrate after changing speakers, microphones, Bluetooth routes or their placement.</p><button className="primary-button" onClick={() => void startCalibration()}>Start calibration</button></>}
    {stage === 'complete' && <><p>Audio loopback delay: <strong>{Math.round((calibration?.seconds ?? 0) * 1000)} ms</strong></p><p>Saved on this device and applied to metronome output for this microphone and sample rate. This includes speaker output, sound travel and microphone input.</p><p>Measurement spread: {calibration?.spreadMs.toFixed(1)} ms. Recalibrate when your audio setup changes.</p><button className="primary-button" onClick={onClose}>Done</button></>}
    {stage === 'error' && <><p role="alert">{message}</p><p>Your previous calibration has been kept.</p><button className="primary-button" onClick={() => setStage('instructions')}>Try again</button></>}
    {stage === 'settings' && <>
    <button className="secondary-button" onClick={() => setStage('instructions')}>Calibrate</button>
    {calibration && <p className="setting-note">Audio loopback delay: {Math.round(calibration.seconds * 1000)} ms. Recalibrate after changing your audio setup. <button onClick={() => usePreferences.getState().setAudioCalibration(null)}>Reset calibration</button></p>}
    <MetronomeSettings active={metronomeActive} simulation={simulation} />
    <div className="sensitivity-setting help-threshold-setting">
      <div className="setting-label"><label htmlFor="help-threshold">Timing help threshold</label><output htmlFor="help-threshold">{helpThresholdMs} ms</output></div>
      <p id="help-threshold-description">In Need help mode, the click returns after four consecutive beats more than this far ahead or behind. It goes quiet after four beats back within the threshold.</p>
      <input id="help-threshold" type="range" min={20} max={200} step={5} value={helpThresholdMs}
        aria-describedby="help-threshold-description" aria-valuetext={`${helpThresholdMs} milliseconds`}
        onChange={event => setHelpThresholdMs(Number(event.target.value))} />
      <div className="sensitivity-scale" aria-hidden="true"><span>More help</span><span>More freedom</span></div>
      <p className="setting-note">Rests and unclear attacks break the streak. At fast tempos, use a smaller threshold.</p>
    </div>
    </>}
  </dialog></>
}
