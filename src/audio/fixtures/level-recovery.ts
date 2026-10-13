/** Deterministic synthetic PCM, not recordings of drums or room movement. */
export function levelRecoveryFixture(rate: number) {
  const duration = 9;
  const attacks = [
    { time: 0.1, amplitude: 0.8 },
    { time: 0.6, amplitude: 0.8 },
    { time: 0.85, amplitude: 0.08 }, // Intentional ghost note after the accent.
    { time: 1.1, amplitude: 0.8 },
    // Faint transient probes during the waiting period must not extend the bar.
    ...[1.5, 2, 2.5, 3].map(time => ({ time, amplitude: 0.03 })),
    { time: 8, amplitude: 0.04 }, // Sensitivity eventually recovers for quiet playing.
  ];
  return {
    samples: synthesizeAttacks(rate, duration, attacks),
    expectedTimes: [0.1, 0.6, 0.85, 1.1, 8],
  };
}

export function accentFollowUpFixture(rate: number) {
  const expectedTimes = [0.1, 0.14, 0.4, 0.44];
  return {
    samples: synthesizeAttacks(rate, 1, expectedTimes.map((time, i) => ({
      time, amplitude: i % 2 ? 0.1 : 0.8, decay: 0.01,
    }))),
    expectedTimes,
  };
}

export function roomNoiseAfterAccentFixture(rate: number) {
  const samples = synthesizeAttacks(rate, 3, [{ time: 0.1, amplitude: 0.8, decay: 0.008 }]);
  let seed = 97;
  for (let i = 0; i < samples.length; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    samples[i] += 0.08 * (0.8 * Math.sin(2 * Math.PI * 25 * i / rate) + 0.2 * (seed / 2 ** 31 - 1));
  }
  return { samples, expectedTimes: [0.1] };
}

function synthesizeAttacks(rate: number, duration: number, attacks: { time: number; amplitude: number; decay?: number }[]) {
  const samples = new Float32Array(Math.round(duration * rate));
  let seed = 17;
  for (const attack of attacks) {
    const start = Math.round(attack.time * rate);
    const decay = attack.decay ?? 0.025;
    for (let n = 0; n < decay * rate * 10 && start + n < samples.length; n += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const t = n / rate;
      samples[start + n] += attack.amplitude * Math.exp(-t / decay)
        * (0.6 * (seed / 2 ** 31 - 1) + 0.4 * Math.cos(2 * Math.PI * 120 * t));
    }
  }
  return samples;
}
