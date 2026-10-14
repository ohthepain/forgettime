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
  // the angle, with maximum speed through the centre.
  const angle = locked ? -28 * Math.cos(Math.PI * (beats % 2)) : 0

  return <svg className="beat-pendulum" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
    <path className="pendulum-arc" d="M17 25 A92 92 0 0 1 103 25" />
    <path className="pendulum-ticks" d="M17 25 l3 5 M38 17 l1 5 M81 17 l-1 5 M103 25 l-3 5" />
    <line className="pendulum-centre" x1="60" y1="9" x2="60" y2="108" />
    <path className="pendulum-base" d="M44 110 H76" />
    <g className="pendulum-arm" transform={`rotate(${angle.toFixed(3)} 60 106)`}>
      <line className="pendulum-rod" x1="60" y1="106" x2="60" y2="17" />
      <rect className="pendulum-weight" x="49" y="29" width="22" height="15" rx="3" />
      <line className="pendulum-weight-detail" x1="54" y1="34" x2="66" y2="34" />
    </g>
    <circle className="pendulum-pivot" cx="60" cy="106" r="4" />
    <circle className="pendulum-pin" cx="60" cy="106" r="1.4" />
  </svg>
}
