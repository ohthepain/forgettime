import { DETECTOR_CONTROLS, type DetectorSettingKey, type DetectorSettings, type ReviewedCandidate } from '../audio/detector-contract'
export interface InspectableCandidate extends ReviewedCandidate { position?: number; uncertain?: boolean; iteration?: number }
const configuration = (settings: DetectorSettings) => `${settings.minimumRms} RMS · ${settings.contrastRatio}× contrast · ${settings.minSeparationMs} ms separation · ${settings.recoverySeconds} s recovery`
export function DetectionDetails({ open, toggle, settings, originalSettings, supported, configure, reset, candidates, selected, select, page, setPage, dropped, diagnosticsSupported, context }: {
  open: boolean; toggle: () => void; settings: DetectorSettings; originalSettings?: DetectorSettings; supported: boolean
  configure: (patch: Partial<DetectorSettings>) => void; reset: () => void
  candidates: InspectableCandidate[]; selected: InspectableCandidate | null; select: (candidate: InspectableCandidate) => void
  page: number; setPage: (page: number) => void; dropped: number; diagnosticsSupported: boolean; context: string
}) {
  const pageCount = Math.max(1, Math.ceil(candidates.length / 20))
  const activePage = Math.min(page, pageCount - 1)
  const visible = candidates.slice(activePage * 20, activePage * 20 + 20)
  const m = selected?.measurements
  return <section className="detection-details">
    <button className="detection-toggle" aria-expanded={open} aria-controls="detection-details-content" onClick={toggle}>Detection details</button>
    {open && <div id="detection-details-content">
      <p className="waveform-note">Start sensitivity only gates live acquisition. Dashed waveform guides show that start level, not the adaptive detector threshold.</p>
      <fieldset disabled={!supported} aria-label="Detector controls"><legend>Detector controls</legend>
        {(Object.keys(DETECTOR_CONTROLS) as DetectorSettingKey[]).map(key => {
          const control = DETECTOR_CONTROLS[key]
          return <label key={key}>{control.label}<span>{control.unit} · {control.min}–{control.max}</span>
            <input key={settings[key]} aria-label={control.label} type="number" min={control.min} max={control.max} step={control.step} defaultValue={settings[key]}
              onBlur={event => { const value = Number(event.currentTarget.value); if (event.currentTarget.value && Number.isFinite(value)) { const bounded = Math.min(control.max, Math.max(control.min, value)); event.currentTarget.value = String(bounded); configure({ [key]: bounded }) } else event.currentTarget.value = String(settings[key]) }}
              onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
          </label>
        })}
        <button type="button" onClick={reset}>Reset detector defaults</button>
      </fieldset>
      {!supported && <p className="capture-notice">Native detector tuning and diagnostics require an updated audio plugin.</p>}
      <p className="waveform-note">Current: {supported ? configuration(settings) : 'native settings unavailable'}.<br />Original: {originalSettings ? configuration(originalSettings) : 'configuration not available'}.</p>
      <p className="waveform-note">Apply an edit with Enter or by leaving the field. Replay starts fresh; live edits preserve the active beat and detector history. Original candidates retain the settings used for each decision.</p>
      <p className="small-label">{context}</p>
      {!diagnosticsSupported ? <p className="waveform-note">Candidate diagnostics were not supplied for this source.</p> : <>
        {dropped > 0 && <p className="capture-notice" role="status">Diagnostics incomplete · {dropped} candidates omitted at the storage limit.</p>}
        <p className="waveform-note">{candidates.length ? `Showing ${activePage * 20 + 1}–${Math.min(candidates.length, activePage * 20 + 20)} of ${candidates.length} candidates. Rejected markers follow this page.` : 'No attempted attacks in this segment.'}</p>
        <div className="candidate-list" aria-label="Candidate decisions">{visible.map(candidate => <button key={candidate.id} aria-label={`Inspect candidate ${candidate.id} at ${candidate.time.toFixed(3)} seconds`} aria-pressed={selected?.id === candidate.id}
          onClick={() => select(candidate)}><span>{candidate.time.toFixed(3)} s</span><span>{!candidate.accepted ? 'Rejected' : candidate.acquisition === 'below-start-level' || candidate.acquisition === 'low-confidence' ? 'Start gate' : candidate.uncertain ? 'Accepted · uncertain rhythm' : 'Accepted'}</span></button>)}</div>
        {pageCount > 1 && <div className="candidate-pages"><button disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>Previous candidates</button><button disabled={activePage + 1 === pageCount} onClick={() => setPage(activePage + 1)}>Next candidates</button></div>}
      </>}
      {selected && m && <div className="candidate-inspection" aria-live="polite"><h3>{!selected.accepted ? 'Detector rejected' : selected.acquisition === 'below-start-level' || selected.acquisition === 'low-confidence' ? 'Detector accepted · start gate rejected' : selected.uncertain ? 'Detector accepted · rhythmic interpretation uncertain' : 'Detector accepted'}</h3>
        <p>Candidate {selected.id} · {selected.time.toFixed(3)} source seconds{selected.iteration === undefined ? '' : ` · loop ${selected.iteration + 1}`}</p>
        <p>{selected.reasons.length ? selected.reasons.join(', ') : selected.acquisition === 'below-start-level' ? 'Below Start sensitivity level' : selected.acquisition === 'low-confidence' ? 'Insufficient confidence to start' : selected.uncertain ? 'No precise timing score for this attack' : selected.acquisition === 'started' ? 'Established beat 1; this reference hit has no timing score' : 'Passed detector checks'}</p>
        <table aria-label="Candidate measurements"><thead><tr><th>Measurement</th><th>Observed</th><th>Required</th></tr></thead><tbody>
          {selected.acquisitionGate && <><tr><th>Start peak</th><td>{selected.strength.toFixed(4)}</td><td>≥ {selected.acquisitionGate.minimumStrength.toFixed(4)}</td></tr><tr><th>Start confidence</th><td>{selected.confidence.toFixed(2)}</td><td>≥ {selected.acquisitionGate.minimumConfidence}</td></tr></>}
          <tr><th>RMS level</th><td>{m.rms.toFixed(4)}</td><td>≥ {m.minimumLevel.toFixed(4)}</td></tr>
          <tr><th>RMS rise</th><td>{m.rise.toFixed(4)}</td><td>≥ {m.minimumRise}</td></tr>
          <tr><th>Rise ratio</th><td>{m.ratio.toFixed(2)}×</td><td>≥ {m.minimumRatio}×</td></tr>
          <tr><th>Contrast</th><td>{m.contrast.toFixed(2)}×</td><td>≥ {m.minimumContrast}×</td></tr>
          <tr><th>Rearmed</th><td>{m.armed ? 'Yes' : 'No'}</td><td>or rise ≥ {m.rearmRatio}×</td></tr>
          <tr><th>Separation</th><td>{m.elapsedMs === null ? 'First attack' : `${m.elapsedMs.toFixed(1)} ms`}</td><td>≥ {m.minimumSeparationMs} ms</td></tr>
          <tr><th>Level reference</th><td>{m.levelReference.toFixed(4)}</td><td>5% contributes to level gate</td></tr>
          <tr><th>Background</th><td>{m.baselineRms.toFixed(4)}</td><td>Effective contrast baseline</td></tr>
        </tbody></table><p className="waveform-note">Decision settings: {configuration(selected.settings)}.</p>
      </div>}
    </div>}
  </section>
}
