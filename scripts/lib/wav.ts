/** PCM WAV decoder for local recording validation; never modifies the source. */
export function decodeWav(buffer: Buffer): { samples: Float32Array; sampleRate: number; channels: number } {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Input must be a RIFF/WAVE file.');
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > buffer.length) throw new Error('Truncated WAV chunk.');
    if (id === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV format chunk.');
      format = buffer.readUInt16LE(start);
      channels = buffer.readUInt16LE(start + 2);
      sampleRate = buffer.readUInt32LE(start + 4);
      bits = buffer.readUInt16LE(start + 14);
      // macOS afconvert emits WAVE_FORMAT_EXTENSIBLE even for mono PCM16.
      if (format === 0xfffe) {
        if (size < 40 || buffer.readUInt16LE(start + 16) < 22) throw new Error('Truncated extensible WAV format.');
        const subtype = buffer.subarray(start + 24, start + 40).toString('hex');
        if (subtype === '0100000000001000800000aa00389b71') format = 1;
        else if (subtype === '0300000000001000800000aa00389b71') format = 3;
        else throw new Error('Unsupported extensible WAV subtype.');
        const validBits = buffer.readUInt16LE(start + 18);
        if (validBits !== 0 && validBits !== bits) throw new Error('Packed WAV sample bits are not supported.');
      }
    } else if (id === 'data') data = buffer.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (!data || channels < 1 || channels > 8 || sampleRate < 8000 || !((format === 1 && bits === 16) || (format === 3 && bits === 32))) {
    throw new Error('Supported WAV: PCM16 or float32, 1–8 channels, at least 8 kHz. Export a compatible WAV before validation.');
  }
  const bytes = bits / 8;
  if (data.length % (bytes * channels) !== 0) throw new Error('WAV ends with a partial sample frame.');
  const samples = new Float32Array(Math.floor(data.length / (bytes * channels)));
  for (let i = 0; i < samples.length; i += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const offset = (i * channels + channel) * bytes;
      samples[i] += (format === 1 ? data.readInt16LE(offset) / 32768 : data.readFloatLE(offset)) / channels;
    }
  }
  return { samples, sampleRate, channels };
}

