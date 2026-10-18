/** Experimental review-only causal mel-flux family. Keep Java/Swift mirrors aligned. */
export const MEL_DETECTOR_VERSION = "mel-flux-v1";
export interface MelSettings {
  windowMs: 10 | 20 | 40;
  bands: 24 | 48 | 96;
  neighbor: 1 | 3 | 5;
  confirmation: 0 | 1 | 2;
  rearming: boolean;
  threshold: number;
}
export const DEFAULT_MEL_SETTINGS: Readonly<MelSettings> = Object.freeze({
  windowMs: 20,
  bands: 48,
  neighbor: 5,
  confirmation: 1,
  rearming: true,
  threshold: 2,
});
export interface MelOnset {
  sourceFrame: number;
  analyzedThroughFrame: number;
  flux: number;
  threshold: number;
}
interface Row {
  center: number;
  through: number;
  flux: number;
  threshold: number;
  ready: boolean;
}
const mel = (f: number) =>
  f < 1000 ? f / (200 / 3) : 15 + Math.log(f / 1000) / (Math.log(6.4) / 27);
const hz = (m: number) =>
  m < 15 ? m * (200 / 3) : 1000 * Math.exp((m - 15) * (Math.log(6.4) / 27));
export class MelDetector {
  readonly settings: Readonly<MelSettings>;
  private rate = 0;
  private n = 0;
  private hop = 0;
  private first = 0;
  private expected: number | null = null;
  private seen = 0;
  private cursor = 0;
  private pcm = new Float64Array(0);
  private window = new Float64Array(0);
  private real = new Float64Array(0);
  private imaginary = new Float64Array(0);
  private cosine = new Float64Array(0);
  private sine = new Float64Array(0);
  private power = new Float64Array(0);
  private norm = 0;
  private filters: { bins: number[]; weights: number[] }[] = [];
  private previous: Float64Array | null = null;
  private bands = new Float64Array(0);
  private history: number[] = [];
  private historyLimit = 0;
  private rows: Row[] = [];
  private armed = true;
  private last = -Infinity;
  private watermark = 0;
  constructor(settings: MelSettings = { ...DEFAULT_MEL_SETTINGS }) {
    if (
      Object.keys(settings).sort().join(",") !==
        "bands,confirmation,neighbor,rearming,threshold,windowMs" ||
      ![10, 20, 40].includes(settings.windowMs) ||
      ![24, 48, 96].includes(settings.bands) ||
      ![1, 3, 5].includes(settings.neighbor) ||
      ![0, 1, 2].includes(settings.confirmation) ||
      typeof settings.rearming !== "boolean" ||
      !Number.isFinite(settings.threshold) ||
      settings.threshold < 0.5 ||
      settings.threshold > 4
    )
      throw new Error("Invalid mel settings");
    this.settings = Object.freeze({ ...settings });
  }
  reset() {
    this.n = 0;
    this.hop = 0;
    this.first = 0;
    this.cursor = 0;
    this.historyLimit = 0;
    this.pcm = new Float64Array(0);
    this.window = new Float64Array(0);
    this.real = new Float64Array(0);
    this.imaginary = new Float64Array(0);
    this.cosine = new Float64Array(0);
    this.sine = new Float64Array(0);
    this.power = new Float64Array(0);
    this.bands = new Float64Array(0);
    this.filters = [];
    this.rate = 0;
    this.expected = null;
    this.seen = 0;
    this.previous = null;
    this.history = [];
    this.rows = [];
    this.armed = true;
    this.last = -Infinity;
    this.watermark = 0;
  }
  private configure(rate: number, start: number) {
    this.reset();
    this.rate = rate;
    this.first = start;
    this.expected = start;
    this.watermark = start;
    this.n = Math.max(
      128,
      Math.min(8192, 2 ** Math.round(Math.log2((rate * this.settings.windowMs) / 1000))),
    );
    this.hop = Math.max(1, Math.round(rate * 0.0025));
    this.historyLimit = Math.ceil((rate * 0.1) / this.hop);
    this.cursor = 0;
    this.pcm = new Float64Array(this.n);
    this.window = Float64Array.from(
      { length: this.n },
      (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.n - 1)),
    );
    this.norm = this.window.reduce((a, b) => a + b, 0) ** 2;
    this.real = new Float64Array(this.n);
    this.imaginary = new Float64Array(this.n);
    this.power = new Float64Array(this.n / 2 + 1);
    this.cosine = Float64Array.from({ length: this.n / 2 }, (_, i) =>
      Math.cos((-2 * Math.PI * i) / this.n),
    );
    this.sine = Float64Array.from({ length: this.n / 2 }, (_, i) =>
      Math.sin((-2 * Math.PI * i) / this.n),
    );
    const edges = Array.from({ length: this.settings.bands + 2 }, (_, i) =>
      hz(mel(30) + ((mel(Math.min(16000, rate / 2)) - mel(30)) * i) / (this.settings.bands + 1)),
    );
    this.filters = Array.from({ length: this.settings.bands }, (_, b) => {
      const bins: number[] = [],
        weights: number[] = [];
      for (let j = 0; j <= this.n / 2; j++) {
        const f = (j * rate) / this.n,
          w =
            (Math.max(
              0,
              Math.min(
                (f - edges[b]) / (edges[b + 1] - edges[b]),
                (edges[b + 2] - f) / (edges[b + 2] - edges[b + 1]),
              ),
            ) *
              2) /
            (edges[b + 2] - edges[b]);
        if (w > 0) {
          bins.push(j);
          weights.push(w);
        }
      }
      if (!bins.length) {
        this.reset();
        throw new Error("Mel filter has no spectral bins at this rate/window");
      }
      return { bins, weights };
    });
    this.bands = new Float64Array(this.settings.bands);
  }
  /** Source frames must be consecutive; a gap or rate change begins real new history. */
  process(sample: number, frame: number, sampleRate: number): MelOnset | null {
    if (
      !Number.isFinite(sample) ||
      Math.abs(sample) > 3.4028234663852886e38 ||
      !Number.isSafeInteger(frame) ||
      frame < 0 ||
      frame >= Number.MAX_SAFE_INTEGER ||
      !Number.isInteger(sampleRate) ||
      sampleRate < 8000 ||
      sampleRate > 192000
    )
      throw new Error("Invalid mel PCM clock or sample");
    if (this.rate !== sampleRate || this.expected !== frame) this.configure(sampleRate, frame);
    this.expected = frame + 1;
    this.pcm[this.cursor] = Math.fround(sample);
    this.cursor = (this.cursor + 1) % this.n;
    this.seen++;
    if (this.seen < this.n || (this.seen - this.n) % this.hop !== 0) return null;
    for (let i = 0; i < this.n; i++) {
      this.real[i] = this.pcm[(this.cursor + i) % this.n] * this.window[i];
      this.imaginary[i] = 0;
    }
    this.fft();
    for (let j = 0; j < this.power.length; j++)
      this.power[j] = (this.real[j] ** 2 + this.imaginary[j] ** 2) / this.norm;
    let flux = 0;
    for (let b = 0; b < this.filters.length; b++) {
      const f = this.filters[b];
      let energy = 0;
      for (let j = 0; j < f.bins.length; j++) energy += f.weights[j] * this.power[f.bins[j]];
      const value = Math.log1p(energy / 1e-8);
      this.bands[b] = value;
      if (this.previous) {
        let reference = 0;
        const half = Math.floor(this.settings.neighbor / 2);
        for (let k = Math.max(0, b - half); k <= Math.min(this.settings.bands - 1, b + half); k++)
          reference = Math.max(reference, this.previous[k]);
        flux += Math.max(0, value - reference);
      }
    }
    flux /= this.settings.bands;
    this.previous = this.bands.slice();
    let mean = 0,
      variance = 0;
    for (const v of this.history) mean += v;
    mean /= Math.max(1, this.history.length);
    for (const v of this.history) variance += (v - mean) ** 2;
    variance /= Math.max(1, this.history.length);
    const row: Row = {
      center: frame - this.n + 1 + (this.n - 1) / 2,
      through: frame + 1,
      flux,
      threshold: mean + this.settings.threshold * Math.sqrt(variance) + 0.005,
      ready: this.history.length === this.historyLimit,
    };
    this.history.push(flux);
    if (this.history.length > this.historyLimit) this.history.shift();
    this.rows.push(row);
    if (this.rows.length > this.settings.confirmation + 2) this.rows.shift();
    this.watermark = Math.max(
      this.first,
      Math.floor(row.center + (1 - this.settings.confirmation) * this.hop),
    );
    const index = this.rows.length - 1 - this.settings.confirmation;
    if (index < 1) return null;
    const candidate = this.rows[index];
    if (candidate.ready && candidate.flux <= candidate.threshold) this.armed = true;
    if (
      candidate.ready &&
      (!this.settings.rearming || this.armed) &&
      candidate.flux > candidate.threshold &&
      candidate.flux > this.rows[index - 1].flux &&
      this.rows.slice(index + 1).every((r) => candidate.flux > r.flux) &&
      candidate.center - this.last >= this.rate * 0.018
    ) {
      this.last = candidate.center;
      this.armed = false;
      return {
        sourceFrame: candidate.center,
        analyzedThroughFrame: row.through,
        flux: candidate.flux,
        threshold: candidate.threshold,
      };
    }
    return null;
  }
  private fft() {
    for (let i = 1, j = 0; i < this.n; i++) {
      let bit = this.n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const t = this.real[i];
        this.real[i] = this.real[j];
        this.real[j] = t;
      }
    }
    for (let length = 2; length <= this.n; length *= 2)
      for (let base = 0; base < this.n; base += length)
        for (let j = 0; j < length / 2; j++) {
          const at = (j * this.n) / length,
            c = this.cosine[at],
            s = this.sine[at],
            u = base + j,
            v = u + length / 2,
            tr = this.real[v] * c - this.imaginary[v] * s,
            ti = this.real[v] * s + this.imaginary[v] * c;
          this.real[v] = this.real[u] - tr;
          this.imaginary[v] = this.imaginary[u] - ti;
          this.real[u] += tr;
          this.imaginary[u] += ti;
        }
  }
  get state() {
    return {
      version: MEL_DETECTOR_VERSION,
      sampleRate: this.rate,
      windowFrames: this.n,
      hopFrames: this.hop,
      historyFrames: this.historyLimit,
      segmentStartFrame: this.first,
      receivedThroughFrame: this.expected ?? 0,
      reliableFromFrame: this.rate
        ? Math.floor(this.first + (this.n - 1) / 2 + this.historyLimit * this.hop)
        : 0,
      processedThroughFrame: this.watermark,
      pendingSamples: this.seen < this.n ? this.seen : (this.seen - this.n) % this.hop,
    };
  }
  /** Caller-requested bounded snapshot; no ever-growing diagnostics array. */
  get diagnostic() {
    return {
      power: this.power.slice(),
      logMel: this.bands.slice(),
      row: this.rows.length ? { ...this.rows[this.rows.length - 1] } : null,
    };
  }
}
