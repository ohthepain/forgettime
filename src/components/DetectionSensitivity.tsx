import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
export function DetectionSensitivity({ value, change, disabled }: { value: number | null; change: (value: number) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])
  return <div className="import-sensitivity" ref={root} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector('button')?.focus() } }}>
    <button aria-expanded={open} aria-controls="import-sensitivity-options" onClick={() => setOpen(!open)}>Detection sensitivity <ChevronDown size={16} /></button>
    {open && <div className="record-popover" id="import-sensitivity-options">
      <div className="setting-label"><label htmlFor="detection-sensitivity">Detection sensitivity</label><output htmlFor="detection-sensitivity">{value ?? 'Custom'}</output></div>
      <input id="detection-sensitivity" type="range" min={0} max={100} value={value ?? 50} disabled={disabled} onChange={event => change(Number(event.target.value))} />
      <div className="sensitivity-scale"><span>Fewer detections</span><span>More detections</span></div>
      <button disabled={disabled} onClick={() => change(50)}>Reset detection sensitivity</button>
      <p>Default: 50. Tunes import and replay only. Higher settings favor quieter attacks and may add false detections.</p>
      {disabled && <p>Stop microphone capture before tuning recorded audio.</p>}
    </div>}
  </div>
}
