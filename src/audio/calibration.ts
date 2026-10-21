import { Capacitor } from '@capacitor/core'

export interface AudioCalibration { seconds: number; spreadMs: number; deviceId: string; sampleRate: number; measuredAt: number }
export function calibrationClick(rate: number): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(Math.round(rate * .025))
  for (let i = 0; i < samples.length; i++) {
    // Same unaccented click, attack and decay as capture-worklet.js.
    const t = i / rate
    samples[i] = .22 * Math.sin(2 * Math.PI * 1000 * t)
      * Math.min(1, t / .001) * Math.exp(-t * 180) * Math.min(1, (.025 - t) / .004)
  }
  return samples
}
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
/** Match our known click in captured PCM, independently of drum onset detection. */
export function measureCalibration(pcm: Float32Array, rate: number, clicks: number[]): { seconds: number; spreadMs: number } {
  const template = calibrationClick(rate)
  const stride = 4
  let templateEnergy = 0
  for (let j = 0; j < template.length; j += stride) templateEnergy += template[j] ** 2
  const delays: number[] = []
  for (const click of clicks) {
    let best = 0, bestFrame = 0
    const start = Math.round(click * rate)
    for (let frame = start; frame < Math.min(pcm.length - template.length, start + rate * .5); frame++) {
      let dot = 0, energy = 0
      for (let j = 0; j < template.length; j += stride) { dot += pcm[frame + j] * template[j]; energy += pcm[frame + j] ** 2 }
      const score = energy > 1e-7 ? Math.abs(dot) / Math.sqrt(energy * templateEnergy) : 0
      if (score > best) { best = score; bestFrame = frame }
    }
    if (best > .6) delays.push((bestFrame - start) / rate)
  }
  if (delays.length < 6) throw new Error('Could not hear enough clear clicks. Turn up the speaker volume, move the microphone closer, and try again.')
  const seconds = median(delays)
  const consistent = delays.filter(delay => Math.abs(delay - seconds) <= .008)
  if (consistent.length < 6) throw new Error('The measured delay was inconsistent. Keep the room quiet and try again.')
  return { seconds: median(consistent), spreadMs: (Math.max(...consistent) - Math.min(...consistent)) * 1000 }
}

export async function calibrateAudio(signal: AbortSignal, deviceId = ''): Promise<AudioCalibration> {
  if (Capacitor.isNativePlatform()) throw new Error('Audio calibration is currently available in the browser. Native calibration needs hardware clock support.')
  const context = new AudioContext({ latencyHint: 'interactive' })
  let stream: MediaStream | undefined
  let node: AudioWorkletNode | undefined
  const sources: AudioBufferSourceNode[] = []
  const abort = () => { sources.forEach(source => { try { source.stop() } catch {} }); stream?.getTracks().forEach(track => track.stop()); void context.close().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  const hidden = () => { if (document.hidden) abort() }
  document.addEventListener('visibilitychange', hidden)
  const ensureActive = () => { if (signal.aborted || document.hidden) throw new Error('Calibration cancelled.') }
  try {
    ensureActive()
    await context.resume()
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } })
    ensureActive()
    const track = stream.getAudioTracks()[0]
    const settings = track.getSettings()
    if (!settings.deviceId) throw new Error('This browser cannot identify the microphone for a saved calibration.')
    if (settings.echoCancellation || settings.noiseSuppression || settings.autoGainControl) throw new Error('This microphone has sound processing enabled. Choose another microphone for calibration.')
    await context.audioWorklet.addModule('/audio/calibration-worklet.js')
    ensureActive()
    const rate = context.sampleRate
    const baseFrame = Math.floor(context.currentTime * rate)
    const pcm = new Float32Array(Math.ceil(8 * rate))
    const coverage = new Uint8Array(Math.ceil(pcm.length / 128))
    node = new AudioWorkletNode(context, 'calibration-capture')
    node.port.onmessage = event => {
      const { frame: absoluteFrame, samples } = event.data as { frame: number; samples: Float32Array }
      const frame = absoluteFrame - baseFrame
      if (frame >= 0 && frame + samples.length <= pcm.length) { pcm.set(samples, frame); coverage[Math.floor(frame / 128)] = 1 }
    }
    context.createMediaStreamSource(stream).connect(node)
    node.connect(context.destination)
    const first = context.currentTime + .6
    const clicks = Array.from({ length: 8 }, (_, i) => first + i * .7)
    const buffer = context.createBuffer(1, Math.round(rate * .025), rate)
    buffer.copyToChannel(calibrationClick(rate), 0)
    for (const time of clicks) {
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start(time); sources.push(source)
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(done, (clicks.at(-1)! + .65 - context.currentTime) * 1000)
      function cancelled() { clearTimeout(timer); signal.removeEventListener('abort', cancelled); reject(new Error('Calibration cancelled.')) }
      function done() { signal.removeEventListener('abort', cancelled); resolve() }
      signal.addEventListener('abort', cancelled, { once: true })
    })
    ensureActive()
    if (context.state !== 'running' || track.readyState !== 'live' || track.muted) throw new Error('Audio was interrupted. Please try calibration again.')
    for (let frame = Math.ceil((first * rate - baseFrame) / 128); frame < Math.floor(((clicks.at(-1)! + .5) * rate - baseFrame) / 128); frame++) {
      if (!coverage[frame]) throw new Error('Microphone audio was interrupted. Please try again.')
    }
    return { ...measureCalibration(pcm, rate, clicks.map(time => time - baseFrame / rate)), deviceId: settings.deviceId ?? '', sampleRate: rate, measuredAt: Date.now() }
  } finally {
    signal.removeEventListener('abort', abort)
    document.removeEventListener('visibilitychange', hidden)
    if (node) { node.port.onmessage = null; node.disconnect() }
    stream?.getTracks().forEach(track => track.stop())
    sources.forEach(source => { try { source.stop() } catch {}; source.disconnect() })
    if (context.state !== 'closed') await context.close()
  }
}
