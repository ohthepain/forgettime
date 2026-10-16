import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { usePreferences } from '../lib/preferences'

export function RecordControl({ active, auto, busy, disabled, stopLabel, listen, stop, microphone }: {
  active: boolean; auto: boolean; busy: boolean; disabled: boolean; stopLabel: string
  microphone?: { devices: Pick<MediaDeviceInfo, 'deviceId' | 'label'>[]; deviceId: string; select: (deviceId: string) => void }
  listen: (mode?: 'single' | 'auto') => Promise<void>; stop: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const { inputGain, setInputGain } = usePreferences()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const held = useRef(false)
  const root = useRef<HTMLDivElement>(null)
  function cancelHold() { if (timer.current !== null) clearTimeout(timer.current); timer.current = null }
  useEffect(() => () => cancelHold(), [])
  useEffect(() => {
    if (!open) return
    function dismiss(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])
  return <div ref={root} className="record-control" onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLButtonElement>('.record-options')?.focus() } }}>
    <button className={`record-button ${active ? 'is-recording' : ''} ${auto && active ? 'is-auto' : ''}`}
      aria-label={active || busy ? stopLabel : 'Enable microphone'} aria-pressed={active}
      aria-describedby="record-hint" disabled={disabled && !active && !busy}
      onPointerDown={event => {
        if (event.button !== 0 || busy) return
        held.current = false
        event.currentTarget.setPointerCapture?.(event.pointerId)
        timer.current = setTimeout(() => { held.current = true; timer.current = null; void listen('auto') }, 600)
      }}
      onPointerUp={cancelHold} onPointerCancel={() => { cancelHold(); held.current = true }}
      onLostPointerCapture={cancelHold} onContextMenu={event => event.preventDefault()}
      onClick={() => { cancelHold(); if (held.current) { held.current = false; return } void (active || busy ? stop() : listen()) }}>
      <span className="record-circle" aria-hidden="true" />
    </button>
    <button className="record-options" aria-label="Recording options" aria-expanded={open} aria-controls="recording-options" onClick={() => setOpen(!open)}><ChevronDown size={18} /></button>
    <span id="record-hint" className="sr-only">Press to start or stop. Hold to enable Auto capture.</span>
    {open && <div id="recording-options" className="record-popover">
      {microphone && <div className="microphone-control"><label className="small-label" htmlFor="microphone-input">MICROPHONE</label><select id="microphone-input" value={microphone.deviceId} disabled={busy || active} onChange={event => microphone.select(event.target.value)}>
        <option value="">Browser default</option>
        {microphone.devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
        {microphone.deviceId && !microphone.devices.some(device => device.deviceId === microphone.deviceId) && <option value={microphone.deviceId}>Selected microphone (unavailable)</option>}
      </select>{active && <span className="microphone-hint">Stop listening to change input</span>}</div>}

      <div className="setting-label"><label htmlFor="record-input-gain">Input gain</label><output htmlFor="record-input-gain">{inputGain.toFixed(2)}×</output></div>
      <input id="record-input-gain" type="range" min={0.25} max={8} step={0.05} value={inputGain} onChange={event => setInputGain(Number(event.target.value))} aria-describedby="record-input-gain-note" />
      <div className="sensitivity-scale"><span>Quieter mic</span><span>Louder mic</span></div>
      <p id="record-input-gain-note">Multiplies incoming microphone audio before detection and recording. Does not change imported audio, beat or tempo.</p>
      <button className="capture-auto" aria-label="Auto capture" aria-pressed={auto} disabled={busy || disabled || (active && !auto)} onClick={() => void (auto ? stop() : listen('auto'))}>Auto capture</button>
      <p>Hold the record button for Auto. Press to stop.</p>
    </div>}
  </div>
}
