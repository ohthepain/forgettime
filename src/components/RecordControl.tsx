import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { usePreferences } from '../lib/preferences'

export function RecordControl({ active, auto, busy, disabled, stopLabel, listen, stop }: {
  active: boolean; auto: boolean; busy: boolean; disabled: boolean; stopLabel: string
  listen: (mode?: 'single' | 'auto') => Promise<void>; stop: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const { startSensitivity, setStartSensitivity } = usePreferences()
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
      <div className="setting-label"><label htmlFor="record-sensitivity">Start sensitivity</label><output htmlFor="record-sensitivity">{startSensitivity}%</output></div>
      <input id="record-sensitivity" type="range" min={0} max={100} value={startSensitivity} onChange={event => setStartSensitivity(Number(event.target.value))} aria-describedby="record-sensitivity-note" />
      <div className="sensitivity-scale"><span>Firmer hit</span><span>Softer hit</span></div>
      <p id="record-sensitivity-note">Lower to avoid background noise starting a take. Only affects starting and restarting; quieter hits still count while playing.</p>
      <button className="capture-auto" aria-label="Auto capture" aria-pressed={auto} disabled={busy || disabled || (active && !auto)} onClick={() => void (auto ? stop() : listen('auto'))}>Auto capture</button>
      <p>Hold the record button for Auto. Press to stop.</p>
    </div>}
  </div>
}
