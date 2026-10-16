import { Volume2, VolumeX } from 'lucide-react'
import { usePreferences } from '../lib/preferences'
import type { MetronomeMode } from '../audio/metronome'

const METRONOME_MODES: { value: MetronomeMode; label: string }[] = [
  { value: 'first-bar', label: 'First bar' }, { value: 'always', label: 'Always' }, { value: 'need-help', label: 'Need help' },
]
export function MetronomeSettings({ active, simulation }: { active: boolean; simulation: boolean }) {
  const { metronomeEnabled, metronomeMode, helpThresholdMs, setMetronomeEnabled, setMetronomeMode } = usePreferences()
  return (
      <div className="metronome-control">
        <div className="metronome-heading"><span className="small-label">METRONOME</span>
          <button className={`metronome-toggle ${active ? 'is-playing' : ''}`} aria-label="Metronome sound" aria-pressed={metronomeEnabled}
            disabled={simulation} onClick={() => setMetronomeEnabled(!metronomeEnabled)}>
            {metronomeEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}{metronomeEnabled ? active ? 'Playing' : 'On' : 'Muted'}
          </button></div>
        <div className="mode-control" role="group" aria-label="Metronome mode">{METRONOME_MODES.map(item => <button key={item.value} aria-pressed={metronomeMode === item.value} onClick={() => setMetronomeMode(item.value)} disabled={simulation}>{item.label}</button>)}</div>
        <p className="metronome-note">{simulation ? 'Visual simulation · metronome is silent' : !metronomeEnabled ? 'Sound is muted' : metronomeMode === 'need-help'
          ? `First bar, then help after 4 beats beyond ±${helpThresholdMs} ms` : metronomeMode === 'always' ? 'Keeps the beat until you pause' : 'Your first hit sets beat 1; the click joins on beat 2'}</p>
        {metronomeEnabled && !simulation && <p className="metronome-note">Use headphones so the microphone hears your playing, not the click.</p>}
      </div>
  )
}
