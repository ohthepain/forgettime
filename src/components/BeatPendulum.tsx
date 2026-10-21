/** Always-visible tempo cue; a performance uses the captured beat clock. */
export function BeatPendulum({ time, origin, bpm, active }: {
  time: number
  origin: number | null
  bpm: number
  active: boolean
}) {
  const beats = origin === null ? 0 : Math.max(0, (time - origin) * bpm / 60)
  const locked = active && origin !== null
  // Rest upright until playing. Once locked, the captured clock controls
  // the angle, crossing the centre on each beat.
  const angle = locked ? -28 * Math.sin(Math.PI * (beats % 2)) : 0

  // A short source-clock pulse: incoming attacks cannot retrigger or rephase it.
  const sinceBeat = (beats - Math.floor(beats)) * 60 / bpm
  const pulse = locked ? Math.max(0, 1 - sinceBeat / 0.09) : 0

  return <div className="meter-metronome" aria-hidden="true">
    <div className="meter-beat-pulse" style={{ opacity: pulse }} />
    <svg className="beat-pendulum" viewBox="0 0 120 120" focusable="false">
      <g className="pendulum-arm" transform={`rotate(${angle.toFixed(3)} 60 106)`}>
        <line className="pendulum-rod" x1="60" y1="106" x2="60" y2="14" />
        <circle className="pendulum-weight" cx="60" cy="16" r="4" />
      </g>
      <circle className="pendulum-pivot" cx="60" cy="106" r="2.5" />
    </svg>
  </div>
}
