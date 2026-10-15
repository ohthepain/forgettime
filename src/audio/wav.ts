/** Bounded WAV codec shared by browser and native file adapters. No device resampling. */
export const MAX_AUDIO_FILE_BYTES = 64 * 1024 * 1024
export const MAX_PCM_BYTES = 32 * 1024 * 1024
export function encodeFloatWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || samples.byteLength > MAX_PCM_BYTES || samples.length > sampleRate * 120 || !samples.length) throw new Error('Audio exceeds supported limits.')
  const bytes = new ArrayBuffer(44 + samples.byteLength), view = new DataView(bytes)
  const word = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  word(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); word(8, 'WAVE'); word(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 3, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 32, true)
  word(36, 'data'); view.setUint32(40, samples.byteLength, true)
  samples.forEach((sample, i) => { if (!Number.isFinite(sample)) throw new Error('Audio contains nonfinite samples.'); view.setFloat32(44 + i * 4, sample, true) })
  return bytes
}
export function decodeWav(bytes: ArrayBuffer) {
  if (bytes.byteLength < 44 || bytes.byteLength > MAX_AUDIO_FILE_BYTES) throw new Error('WAV size is outside supported limits.')
  const view = new DataView(bytes)
  const word = (at: number) => String.fromCharCode(...new Uint8Array(bytes, at, 4))
  if (word(0) !== 'RIFF' || word(8) !== 'WAVE' || view.getUint32(4, true) !== bytes.byteLength - 8) throw new Error('Invalid WAV container.')
  let format = 0, channels = 0, sampleRate = 0, bits = 0, align = 0, data = -1, length = 0, fmt = false
  for (let at = 12; at < bytes.byteLength;) {
    if (at + 8 > bytes.byteLength) throw new Error('Truncated WAV chunk.')
    const name = word(at), size = view.getUint32(at + 4, true), start = at + 8, end = start + size
    if (end + (size % 2) > bytes.byteLength) throw new Error('Truncated WAV chunk.')
    if (name === 'fmt ') {
      if (fmt || size < 16) throw new Error('Invalid WAV format.')
      fmt = true; format = view.getUint16(start, true); channels = view.getUint16(start + 2, true); sampleRate = view.getUint32(start + 4, true); align = view.getUint16(start + 12, true); bits = view.getUint16(start + 14, true)
      if (format === 65534) {
        if (size < 40 || view.getUint16(start + 16, true) < 22 || view.getUint16(start + 18, true) !== bits) throw new Error('Invalid extensible WAV.')
        format = view.getUint32(start + 24, true)
        const tail = [...new Uint8Array(bytes, start + 28, 12)].join(',')
        if (tail !== '0,0,16,0,128,0,0,170,0,56,155,113') throw new Error('Unsupported WAV subtype.')
      }
      if (!((format === 1 && [16, 24, 32].includes(bits)) || (format === 3 && bits === 32)) || channels < 1 || channels > 8 || sampleRate < 8000 || sampleRate > 192000 || align !== channels * bits / 8 || view.getUint32(start + 8, true) !== sampleRate * align) throw new Error('Unsupported WAV format.')
    } else if (name === 'data') {
      if (data !== -1) throw new Error('Multiple WAV data chunks are unsupported.')
      data = start; length = size
    }
    at = end + size % 2
  }
  if (!fmt || data < 0 || !length || length % align) throw new Error('Incomplete WAV samples.')
  const frames = length / align
  if (frames * 4 > MAX_PCM_BYTES || frames > sampleRate * 120) throw new Error('Decoded audio exceeds supported limits.')
  const samples = new Float32Array(frames)
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0
    for (let channel = 0; channel < channels; channel++) {
      const at = data + frame * align + channel * bits / 8
      const sample = format === 3 ? view.getFloat32(at, true) : bits === 16 ? view.getInt16(at, true) / 32768 : bits === 32 ? view.getInt32(at, true) / 2147483648 : ((view.getUint16(at, true) | (view.getInt8(at + 2) << 16)) / 8388608)
      if (!Number.isFinite(sample)) throw new Error('Audio contains nonfinite samples.')
      sum = channel === 0 ? sample / channels : sum + sample / channels
    }
    samples[frame] = sum
    if (!Number.isFinite(samples[frame])) throw new Error('Audio contains nonfinite samples.')
  }
  return { samples, sampleRate, channels, encoding: format === 3 ? 'float32' as const : bits === 16 ? 'pcm16' as const : bits === 24 ? 'pcm24' as const : 'pcm32' as const }
}
