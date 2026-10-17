/** A new high-band attack over a stationary low tone, synthetic rather than
 * acoustic-kit evidence. Broadband energy barely changes at the new attack. */
export function frequencyOverlapFixture(rate: number) {
  const samples = new Float32Array(rate)
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate
    samples[i] = .3 * Math.sin(2 * Math.PI * 80 * t)
    if (t >= .4 && t < .42) samples[i] += .025 * Math.sin(2 * Math.PI * Math.min(5000, rate * .3) * (t - .4)) * Math.exp(-(t - .4) / .008)
  }
  return { samples, expectedTimes: [.4] }
}
