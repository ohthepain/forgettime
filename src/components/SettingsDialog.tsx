import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { MetronomeSettings } from './MetronomeSettings'
import { usePreferences } from '../lib/preferences'

export function SettingsDialog({ onClose, metronomeActive = false, simulation = false }: { onClose: () => void; metronomeActive?: boolean; simulation?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const { helpThresholdMs, setHelpThresholdMs } = usePreferences()
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
  </dialog>
}
