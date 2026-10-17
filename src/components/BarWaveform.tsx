import type { InspectableCandidate } from './DetectionDetails'
import { ChevronLeft, ChevronRight, Play, Pause } from 'lucide-react'
import { HIT_STRENGTH_COLORS, hitStrengthColor, WAVEFORM_COLUMNS, type BarWaveformSnapshot } from '../audio/bar-waveform'
import type { TrackingStatus } from '../audio/engine'

export function BarWaveform({ waveform, source, status, review, comparison, diagnostics }: {
  waveform: BarWaveformSnapshot
  source: 'off' | 'microphone' | 'simulation' | 'replay'
  status: TrackingStatus
  review?: { originalAvailable?: boolean; index: number; count: number; availableFraction: number; interrupted: boolean; previous: () => void; next: () => void; select: () => void; loop?: () => void; canLoop?: boolean }
  diagnostics?: { candidates: InspectableCandidate[]; selectedId?: number; select: (candidate: InspectableCandidate) => void }
  comparison?: { current: boolean; select: (current: boolean) => void }
}) {
  const playing = status === 'playing'
  const held = waveform.review !== null
  const hasReference = waveform.progress !== null
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
  const message = held ? null : source === 'off' ? 'Play to see one bar of audio'
    : !hasReference ? 'Your first strong hit starts the bar'
    : !waveform.available ? 'Waveform unavailable · update the mobile app'
    : null
  return <section className="bar-waveform" aria-label="One-bar audio waveform">
    {(review || held || source !== 'off') && <div className="waveform-heading">{(review || held) && <span className="small-label">{review ? waveform.review === 'complete' ? 'RECORDED BAR' : 'PARTIAL BAR' : held ? waveform.review === 'complete' ? 'LAST PLAYED BAR' : 'PARTIAL BAR' : null}</span>}<span className={source === 'simulation' ? 'demo-label' : ''}>{source === 'replay' ? 'REPLAY · MIC OFF' : review ? 'RECORDED AUDIO' : source === 'simulation' ? held ? 'SIMULATION · HELD' : 'SIMULATED AUDIO' : held ? 'HELD FOR REVIEW' : source === 'microphone' ? 'LIVE AUDIO' : 'WAVEFORM'}</span></div>}
    <div className="waveform-display">
      {review && <div className="waveform-review-controls" role="group" aria-label="Recorded bar navigation">
        <button aria-label="Previous bar" disabled={review.index === 0} onClick={review.previous}><ChevronLeft size={18} /></button>
        <button aria-label={`Review bar ${review.index + 1} of ${review.count}`} onClick={review.select}>Bar {review.index + 1} / {review.count}</button>
        {review.loop && <button aria-label={source === 'replay' ? 'Pause recorded bar' : 'Loop recorded bar'} disabled={!review.canLoop} onClick={review.loop}>{source === 'replay' ? <Pause size={18} /> : <Play size={18} />}</button>}
        <button aria-label="Next bar" disabled={review.index + 1 >= review.count} onClick={review.next}><ChevronRight size={18} /></button>
      </div>}
      <div className="waveform-beats" aria-hidden="true">{[1, 2, 3, 4].map(beat => <span key={beat}>{beat}</span>)}</div>
      <svg className="waveform-plot" viewBox="0 0 512 112" preserveAspectRatio="none" role="img" aria-label={`${held ? 'Held audio from the playing section, aligned to beats 1 to 4.' : 'One bar from beat 1 to beat 4, overwritten from the left on each new bar.'} Colored markers show detected hits and their strength.`}>
        {[0, 1, 2, 3].map(beat => <line className="waveform-beat-guide" key={beat} x1={x(beat / 4)} x2={x(beat / 4)} y1="0" y2="112" vectorEffect="non-scaling-stroke" />)}
        <line className="waveform-zero" x1="4" x2="508" y1="56" y2="56" vectorEffect="non-scaling-stroke" />
        <path className="waveform-trace waveform-previous" d={previous} vectorEffect="non-scaling-stroke" />
        <path className="waveform-trace" d={current} vectorEffect="non-scaling-stroke" />
        {waveform.hits.map(hit => <g key={hit.time} className="waveform-hit" data-strength={hit.strength} data-position={hit.position}>
          <title>{`${Math.round(hit.strength * 100)}% input peak${hit.confidence < 0.55 ? ' · uncertain attack' : ''}`}</title>
          <line x1={x(hit.position)} x2={x(hit.position)} y1="12" y2="103" stroke={hitStrengthColor(hit.strength)} strokeDasharray={hit.confidence < 0.55 ? '3 3' : undefined} vectorEffect="non-scaling-stroke" />
          <circle cx={x(hit.position)} cy="9" r="3" fill={hitStrengthColor(hit.strength)} />
        </g>)}
        {diagnostics?.candidates.filter(candidate => candidate.position !== undefined && candidate.position >= 0 && candidate.position <= 1 && (!candidate.accepted || candidate.acquisition === 'below-start-level' || candidate.acquisition === 'low-confidence')).map(candidate => <g key={`candidate-${candidate.id}`} className="waveform-candidate" role="button" tabIndex={0} aria-label={`Select rejected candidate ${candidate.id}`} onClick={() => diagnostics.select(candidate)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); diagnostics.select(candidate) } }}>
          <rect x={x(candidate.position!) - 8} width="16" height="112" fill="transparent" />
          <line x1={x(candidate.position!)} x2={x(candidate.position!)} y1="20" y2="102" stroke={diagnostics.selectedId === candidate.id ? '#bbc7cd' : '#61717c'} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
        </g>)}
        {review && review.availableFraction < 1 && <rect x={x(review.availableFraction)} y="0" width={504 * (1 - review.availableFraction)} height="112" fill="#10161ecc"><title>No recorded audio in this portion</title></rect>}
        {playing && hasReference && <line className="waveform-playhead" x1={x(waveform.progress!)} x2={x(waveform.progress!)} y1="0" y2="112" vectorEffect="non-scaling-stroke" />}
      </svg>
      {message && <p className="waveform-placeholder">{message}</p>}
    </div>
    {comparison && <div className="mode-control replay-comparison" role="group" aria-label="Waveform detection comparison"><button aria-pressed={!comparison.current} onClick={() => comparison.select(false)}>Original capture</button><button aria-pressed={comparison.current} onClick={() => comparison.select(true)}>Current loop</button></div>}
    <div className="waveform-legend" aria-label="Detected hit strength from soft to hard">{HIT_STRENGTH_COLORS.map(band => <span key={band.label}><i style={{ background: band.color }} aria-hidden="true" />{band.label}</span>)}</div>
    <p className="waveform-note">Detected hits · colour shows input strength</p>
    {review?.interrupted && <p className="waveform-note">Input interrupted · this take ends before the gap.</p>}
    {review && <p className="waveform-note">{!comparison?.current && review.originalAvailable === false ? 'Original detections unavailable' : `${waveform.hits.length} ${comparison?.current ? 'current-loop' : 'original'} detected hits`} · {waveform.review === 'partial' ? 'partial recorded bar' : 'complete recorded bar'}. {review.availableFraction < 1 ? 'Shaded area was not recorded. Looping needs a complete bar.' : ''}</p>}
    {held && !review && <p className="waveform-note">{waveform.review === 'complete' ? `${waveform.hits.length} detected hits · last complete bar before your final hit.` : 'Short take · play through a full bar for a complete review.'}</p>}
  </section>
}
