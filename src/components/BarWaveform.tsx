import { HIT_STRENGTH_COLORS, hitStrengthColor, WAVEFORM_COLUMNS, type BarWaveformSnapshot } from '../audio/bar-waveform'
import type { TrackingStatus } from '../audio/engine'
import { startingStrength } from '../audio/start-sensitivity'

export function BarWaveform({ waveform, source, status, startSensitivity }: {
  waveform: BarWaveformSnapshot
  source: 'off' | 'microphone' | 'simulation'
  status: TrackingStatus
  startSensitivity: number
}) {
  const playing = status === 'playing'
  const held = waveform.review !== null
  const hasReference = waveform.progress !== null
  const threshold = startingStrength(startSensitivity)
  const x = (position: number) => 4 + position * 504
  let current = ''
  let previous = ''
  for (let i = 0; i < waveform.min.length; i++) {
    if (waveform.min[i] === 0 && waveform.max[i] === 0) continue
    const position = (i + 0.5) / WAVEFORM_COLUMNS
    const segment = `M${x(position).toFixed(2)},${(56 - waveform.max[i] * 46).toFixed(2)}V${(56 - waveform.min[i] * 46).toFixed(2)}`
    if (held || position <= (waveform.progress ?? 0)) current += segment
    else previous += segment
  }
  const message = source === 'off' ? 'Play to see one bar of audio'
    : !hasReference ? 'Your first strong hit starts the bar'
    : !waveform.available ? 'Waveform unavailable · update the mobile app'
    : null
  return <section className="bar-waveform" aria-label="One-bar audio waveform">
    <div className="waveform-heading"><span className="small-label">{held ? waveform.review === 'complete' ? 'LAST PLAYED BAR' : 'PARTIAL BAR' : 'ONE BAR'}</span><span className={source === 'simulation' ? 'demo-label' : ''}>{source === 'simulation' ? held ? 'SIMULATION · HELD' : 'SIMULATED AUDIO' : held ? 'HELD FOR REVIEW' : source === 'microphone' ? 'LIVE AUDIO' : 'WAVEFORM'}</span></div>
    <div className="waveform-display">
      <div className="waveform-beats" aria-hidden="true">{[1, 2, 3, 4].map(beat => <span key={beat}>{beat}</span>)}</div>
      <svg className="waveform-plot" viewBox="0 0 512 112" preserveAspectRatio="none" role="img" aria-label={`${held ? 'Held audio from the playing section, aligned to beats 1 to 4.' : 'One bar from beat 1 to beat 4, overwritten from the left on each new bar.'} Colored markers show detected hits and their strength. Dashed lines show the current start level only.`}>
        {[0, 1, 2, 3].map(beat => <line className="waveform-beat-guide" key={beat} x1={x(beat / 4)} x2={x(beat / 4)} y1="0" y2="112" vectorEffect="non-scaling-stroke" />)}
        <line className="waveform-zero" x1="4" x2="508" y1="56" y2="56" vectorEffect="non-scaling-stroke" />
        {hasReference && [-1, 1].map(sign => <line key={sign} className="waveform-start-level" x1="4" x2="508" y1={56 + sign * threshold * 46} y2={56 + sign * threshold * 46} vectorEffect="non-scaling-stroke" />)}
        <path className="waveform-trace waveform-previous" d={previous} vectorEffect="non-scaling-stroke" />
        <path className="waveform-trace" d={current} vectorEffect="non-scaling-stroke" />
        {waveform.hits.map(hit => <g key={hit.time} className="waveform-hit" data-strength={hit.strength} data-position={hit.position}>
          <title>{`${Math.round(hit.strength * 100)}% input peak${hit.confidence < 0.55 ? ' · uncertain attack' : ''}`}</title>
          <line x1={x(hit.position)} x2={x(hit.position)} y1="12" y2="103" stroke={hitStrengthColor(hit.strength)} strokeDasharray={hit.confidence < 0.55 ? '3 3' : undefined} vectorEffect="non-scaling-stroke" />
          <circle cx={x(hit.position)} cy="9" r="3" fill={hitStrengthColor(hit.strength)} />
        </g>)}
        {playing && hasReference && <line className="waveform-playhead" x1={x(waveform.progress!)} x2={x(waveform.progress!)} y1="0" y2="112" vectorEffect="non-scaling-stroke" />}
      </svg>
      {message && <p className="waveform-placeholder">{message}</p>}
    </div>
    <div className="waveform-legend" aria-label="Detected hit strength from soft to hard">{HIT_STRENGTH_COLORS.map(band => <span key={band.label}><i style={{ background: band.color }} aria-hidden="true" />{band.label}</span>)}</div>
    <p className="waveform-note">Detected hits · colour shows input strength</p>
    {hasReference && <p className="waveform-note waveform-threshold-note">Dashed lines: start level · {Math.round(threshold * 100)}% input peak.<br />Only gates the first hit; transient checks also apply.</p>}
    {held && <p className="waveform-note">{waveform.review === 'complete' ? `${waveform.hits.length} detected hits · last complete bar before your final hit.` : 'Short take · play through a full bar for a complete review.'}</p>}
  </section>
}
