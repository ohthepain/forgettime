import { describe, expect, it } from 'vite-plus/test';
import { decodeWav } from './wav';

function wav({ extended = false, float = false, channels = 1, payload = Buffer.from([0, 64, 0, 192]) } = {}) {
  const fmt = Buffer.alloc(extended ? 40 : 16);
  fmt.writeUInt16LE(extended ? 0xfffe : float ? 3 : 1, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(48000, 4);
  fmt.writeUInt32LE(48000 * channels * (float ? 4 : 2), 8);
  fmt.writeUInt16LE(channels * (float ? 4 : 2), 12);
  fmt.writeUInt16LE(float ? 32 : 16, 14);
  if (extended) {
    fmt.writeUInt16LE(22, 16);
    fmt.writeUInt16LE(float ? 32 : 16, 18);
    Buffer.from(float ? '0300000000001000800000aa00389b71' : '0100000000001000800000aa00389b71', 'hex').copy(fmt, 24);
  }
  const header = Buffer.alloc(20);
  header.write('RIFF'); header.writeUInt32LE(4 + 8 + fmt.length + 8 + payload.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(fmt.length, 16);
  const data = Buffer.alloc(8); data.write('data'); data.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, fmt, data, payload]);
}

describe('local recording WAV decoding', () => {
  it('decodes macOS extensible PCM16 identically to ordinary PCM16', () => {
    const ordinary = decodeWav(wav());
    const extended = decodeWav(wav({ extended: true }));
    expect(extended).toEqual(ordinary);
    expect(extended.sampleRate).toBe(48000);
    expect([...extended.samples]).toEqual([0.5, -0.5]);
  });
  it('averages stereo channels rather than treating them as consecutive time samples', () => {
    const result = decodeWav(wav({ extended: true, channels: 2 }));
    expect([...result.samples]).toEqual([0]);
  });
  it('accepts extensible float32 and rejects an unrelated subtype', () => {
    const payload = Buffer.alloc(8); payload.writeFloatLE(0.25); payload.writeFloatLE(-0.75, 4);
    expect([...decodeWav(wav({ extended: true, float: true, payload })).samples]).toEqual([0.25, -0.75]);
    const invalid = wav({ extended: true }); invalid[44] = 2;
    expect(() => decodeWav(invalid)).toThrow('Unsupported extensible WAV subtype');
  });
  it('rejects a partial frame or truncated audio instead of silently changing duration', () => {
    expect(() => decodeWav(wav({ payload: Buffer.from([0, 1, 2]) }))).toThrow('partial sample frame');
    expect(() => decodeWav(wav().subarray(0, -1))).toThrow('Truncated WAV chunk');
  });
});
