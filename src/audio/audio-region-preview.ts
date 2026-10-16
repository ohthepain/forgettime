import type { DecodedImportAudio } from './audio-import'

/** One-shot audition of source PCM. No microphone, detector or musical reference. */
export class AudioRegionPreview {
  private context: AudioContext | null = null
  private output: AudioBufferSourceNode | null = null
  private generation = 0

  stop() {
    this.generation++
    const output = this.output, context = this.context
    this.output = null
    this.context = null
    if (output) {
      output.onended = null
      try { output.stop() } catch { /* Already ended or not yet started. */ }
      output.disconnect()
    }
    if (context && context.state !== 'closed') void context.close().catch(() => undefined)
  }

  async play(audio: DecodedImportAudio, start: number, end: number, ended: () => void): Promise<boolean> {
    this.stop()
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error('Choose a marker inside the visible audio.')
    const first = Math.max(0, Math.min(audio.samples.length, Math.round(start * audio.sampleRate)))
    const last = Math.max(first, Math.min(audio.samples.length, Math.round(end * audio.sampleRate)))
    if (last === first) throw new Error('No audio remains after this marker in the visible passage.')
    const token = this.generation
    try {
      const context = this.context = new AudioContext()
      // Resume immediately within the play-button gesture, before any await.
      await context.resume()
      if (token !== this.generation) return false
      if (context.state !== 'running') throw new Error('Audio output could not start. Press play to try again.')
      const buffer = context.createBuffer(1, last - first, audio.sampleRate)
      buffer.copyToChannel(audio.samples.slice(first, last), 0)
      const output = this.output = context.createBufferSource()
      output.buffer = buffer
      output.loop = false
      output.connect(context.destination)
      output.onended = () => {
        if (token !== this.generation) return
        this.stop()
        ended()
      }
      context.onstatechange = () => {
        if (token === this.generation && context.state !== 'running') { this.stop(); ended() }
      }
      output.start(context.currentTime)
      return true
    } catch (error) {
      if (token !== this.generation) return false
      this.stop()
      throw error
    }
  }
}
