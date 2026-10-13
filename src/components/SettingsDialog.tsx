import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { usePreferences } from '../lib/preferences'

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const { startSensitivity, setStartSensitivity } = usePreferences()
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
  </dialog>
}
