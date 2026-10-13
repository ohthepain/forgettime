import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { usePreferences } from '../lib/preferences'

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const { startSensitivity, setStartSensitivity, helpThresholdMs, setHelpThresholdMs } = usePreferences()
  useEffect(() => {
    const element = dialog.current!
    const trigger = document.activeElement
    element.showModal()
    return () => {
      element.close()
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [])

  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title"
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
    }}>
    <button className="icon-button close-dialog" aria-label="Close settings" onClick={onClose}><X size={20} /></button>
    <h2 id="settings-title">Settings</h2>
    <div className="sensitivity-setting">
      <div className="setting-label"><label htmlFor="start-sensitivity">Start sensitivity</label><output htmlFor="start-sensitivity">{startSensitivity}%</output></div>
      <p id="sensitivity-description">Your first strong hit starts beat 1. Lower the sensitivity to avoid accidental starts; raise it for softer hits.</p>
      <input id="start-sensitivity" type="range" min={0} max={100} step={1} value={startSensitivity}
        aria-describedby="sensitivity-description sensitivity-scope" aria-valuetext={`${startSensitivity} percent`}
        onChange={event => setStartSensitivity(Number(event.target.value))} />
      <div className="sensitivity-scale" aria-hidden="true"><span>Firmer hit</span><span>Softer hit</span></div>
      <p id="sensitivity-scope" className="setting-note">Only affects starting and restarting. Quieter hits still count once you’re playing.</p>
    </div>
    <div className="sensitivity-setting help-threshold-setting">
      <div className="setting-label"><label htmlFor="help-threshold">Timing help threshold</label><output htmlFor="help-threshold">{helpThresholdMs} ms</output></div>
      <p id="help-threshold-description">In Need help mode, the click returns after four consecutive beats more than this far ahead or behind. It goes quiet after four beats back within the threshold.</p>
      <input id="help-threshold" type="range" min={20} max={200} step={5} value={helpThresholdMs}
        aria-describedby="help-threshold-description" aria-valuetext={`${helpThresholdMs} milliseconds`}
        onChange={event => setHelpThresholdMs(Number(event.target.value))} />
      <div className="sensitivity-scale" aria-hidden="true"><span>More help</span><span>More freedom</span></div>
      <p className="setting-note">Rests and unclear attacks break the streak. At fast tempos, use a smaller threshold.</p>
    </div>
  </dialog>
}
