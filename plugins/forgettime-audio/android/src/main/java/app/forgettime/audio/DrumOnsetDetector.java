package app.forgettime.audio;

/** Port of src/audio/onset-detector.ts. Keep thresholds and fixtures in sync. */
public final class DrumOnsetDetector {
    public static final class Onset {
        public final double time, strength, confidence;
        Onset(double time, double strength, double confidence) {
            this.time = time; this.strength = strength; this.confidence = confidence;
        }
    }
    private final double sampleRate;
    private final double[] window;
    private int filled = 0;
    private double windowTime = 0, previousRms = 0, noiseFloor = 0.0005;
    private double lastOnsetTime = Double.NEGATIVE_INFINITY, recentPeak = 0;
    private boolean armed = true;
    private double processedThrough = 0;
    private final double[] energyHistory = new double[12];
    private int historyIndex = 0, historyCount = 0;
    private double historyEnergy = 0;

    public double getProcessedThrough() { return processedThrough; }

    public DrumOnsetDetector(double sampleRate) {
        this.sampleRate = sampleRate;
        this.window = new double[Math.max(32, (int) Math.round(sampleRate * 0.002667))];
    }
    public Onset process(double sample, double time) {
        if (filled == 0) windowTime = time;
        window[filled++] = Double.isFinite(sample) ? sample : 0;
        if (filled < window.length) return null;
        filled = 0;
        processedThrough = windowTime + window.length / sampleRate;
        double energy = 0, peak = 0;
        for (double value : window) { energy += value * value; peak = Math.max(peak, Math.abs(value)); }
        double meanEnergy = energy / window.length;
        double rms = Math.sqrt(meanEnergy);
        double backgroundRms = Math.sqrt(Math.max(0, historyEnergy) / Math.max(1, historyCount));
        boolean backgroundReady = historyCount == energyHistory.length;
        historyEnergy += meanEnergy - energyHistory[historyIndex];
        energyHistory[historyIndex] = meanEnergy;
        historyIndex = (historyIndex + 1) % energyHistory.length;
        historyCount = Math.min(historyCount + 1, energyHistory.length);
        double previous = previousRms;
        double floor = Math.max(0.006, noiseFloor * 2.5);
        double rise = rms - previous;
        double ratio = rms / Math.max(previous, floor);
        double contrast = rms / Math.max(backgroundRms, floor);
        if (rms < recentPeak * 0.7) armed = true;
        noiseFloor += (rms - noiseFloor) * (rms < noiseFloor ? 0.03 : 0.0005);
        previousRms = rms;
        recentPeak = Math.max(rms, recentPeak * 0.99);
        double elapsed = windowTime - lastOnsetTime;
        if (!backgroundReady || elapsed < 0.018 || (!armed && ratio < 2.5) || rms < floor || rise < 0.002 || ratio < 1.55 || contrast < 1.8) return null;
        int offset = 0;
        double attackThreshold = Math.max(peak * 0.25, previous * 2);
        while (offset < window.length - 1 && Math.abs(window[offset]) < attackThreshold) offset++;
        double onsetTime = windowTime + offset / sampleRate;
        lastOnsetTime = onsetTime;
        armed = false;
        recentPeak = Math.max(recentPeak, rms);
        return new Onset(onsetTime, Math.min(1, peak),
            Math.min(0.98, Math.max(0.35, 0.45 + Math.log(ratio) / Math.log(2) * 0.15 + Math.min(0.2, rise * 2))));
    }
}
