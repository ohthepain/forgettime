package app.forgettime.audio;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.LinkedHashMap;

/** Port of src/audio/onset-detector.ts. Keep thresholds and fixtures in sync. */
public final class DrumOnsetDetector {
    public static Map<String, Object> map(Object... entries) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int i = 0; i < entries.length; i += 2) result.put((String) entries[i], entries[i + 1]);
        return result;
    }
    public static final class Settings {
        public final double minimumRms, contrastRatio, minSeparationMs, recoverySeconds;
        public Settings() { this(1, 0.006, 1.8, 18, 4); }
        public Settings(int version, double level, double contrast, double separation, double recovery) {
            if (version != 1 || !Double.isFinite(level) || !Double.isFinite(contrast) || !Double.isFinite(separation) || !Double.isFinite(recovery))
                throw new IllegalArgumentException("Invalid detector settings version or values.");
            minimumRms = Math.max(0.001, Math.min(0.1, level));
            contrastRatio = Math.max(1.1, Math.min(4, contrast));
            minSeparationMs = Math.max(8, Math.min(100, separation));
            recoverySeconds = Math.max(0.25, Math.min(12, recovery));
        }
        public Map<String, Object> toMap() { return map("version", 1, "minimumRms", minimumRms, "contrastRatio", contrastRatio,
            "minSeparationMs", minSeparationMs, "recoverySeconds", recoverySeconds); }
    }
    public static final class Diagnostics {
        public final List<Map<String, Object>> candidates;
        public final int dropped;
        Diagnostics(List<Map<String, Object>> candidates, int dropped) { this.candidates = candidates; this.dropped = dropped; }
        public Map<String, Object> toMap() { return map("candidates", candidates, "dropped", dropped); }
    }
    private Settings settings;
    private List<Map<String, Object>> candidates = new ArrayList<>();
    private int dropped = 0;
    private long nextCandidateId = 1;
    public void configure(Settings value) { settings = value; }
    public Diagnostics drainDiagnostics() {
        Diagnostics result = new Diagnostics(candidates, dropped);
        candidates = new ArrayList<>(); dropped = 0;
        return result;
    }
    public static final class Onset {
        public final double time, strength, confidence;
        Onset(double time, double strength, double confidence) {
            this.time = time; this.strength = strength; this.confidence = confidence;
        }
    }
    private final double sampleRate;
    private final double[] window;
    private int filled = 0;
    private double windowTime = 0, previousRms = 0, levelReference = 0;
    private double levelHoldUntil = Double.NEGATIVE_INFINITY;
    private double lastOnsetTime = Double.NEGATIVE_INFINITY, recentPeak = 0, envelopeEnergy = 0;
    private double lastClearAttackTime = Double.NEGATIVE_INFINITY, preAttackBackground = 0;
    private boolean armed = true;
    private double processedThrough = 0;
    private final double[] energyHistory = new double[12];
    private int historyIndex = 0, historyCount = 0;
    private double historyEnergy = 0;

    public double getProcessedThrough() { return processedThrough; }

    public DrumOnsetDetector(double sampleRate) { this(sampleRate, new Settings()); }
    public DrumOnsetDetector(double sampleRate, Settings settings) {
        this.settings = settings;
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
        double shortEnergy = 0;
        for (int i = 1; i <= 3; i++) shortEnergy += energyHistory[(historyIndex + energyHistory.length - i) % energyHistory.length];
        double shortRms = Math.sqrt(shortEnergy / 3);
        boolean backgroundReady = historyCount == energyHistory.length;
        historyEnergy += meanEnergy - energyHistory[historyIndex];
        energyHistory[historyIndex] = meanEnergy;
        historyIndex = (historyIndex + 1) % energyHistory.length;
        historyCount = Math.min(historyCount + 1, energyHistory.length);
        double previous = previousRms;
        // Fast level attack, 1 s hold, 4 s release. Never apply gain to PCM.
        if (windowTime >= levelHoldUntil) levelReference *= Math.exp(-window.length / sampleRate / settings.recoverySeconds);
        if (rms >= levelReference * 0.7) levelHoldUntil = windowTime + 1;
        levelReference = Math.max(rms, levelReference);
        double floor = settings.minimumRms;
        double minimumLevel = Math.max(floor, Math.min(levelReference * 0.05, floor * 2));
        double rise = rms - previous;
        double ratio = rms / Math.max(previous, floor);
        double elapsed = windowTime - lastOnsetTime;
        double fullContrast = rms / Math.max(backgroundRms, floor);
        double baseline = windowTime - lastClearAttackTime < 0.09
            ? Math.min(backgroundRms, Math.max(shortRms, preAttackBackground)) : backgroundRms;
        double effectiveBaseline = fullContrast < settings.contrastRatio && ratio < 2.5 ? backgroundRms : baseline;
        double contrast = rms / Math.max(effectiveBaseline, floor);
        envelopeEnergy += (meanEnergy - envelopeEnergy) * (1 - Math.exp(-window.length / sampleRate / 0.01));
        double envelopeRms = Math.sqrt(envelopeEnergy);
        if (envelopeRms < recentPeak * 0.7) armed = true;
        previousRms = rms;
        recentPeak = Math.max(envelopeRms, recentPeak * 0.99);
        List<String> reasons = new ArrayList<>();
        if (!backgroundReady) reasons.add("warming-up");
        if (elapsed < settings.minSeparationMs / 1000) reasons.add("separation");
        if (!armed && ratio < 2.5) reasons.add("rearming");
        if (rms < minimumLevel) reasons.add("level");
        if (rise < 0.002 || ratio < 1.55) reasons.add("rise");
        if (contrast < settings.contrastRatio) reasons.add("contrast");
        int offset = 0;
        double attackThreshold = Math.max(peak * 0.25, previous * 2);
        while (offset < window.length - 1 && Math.abs(window[offset]) < attackThreshold) offset++;
        double onsetTime = windowTime + offset / sampleRate;
        double confidence = Math.min(0.98, Math.max(0.35, 0.45 + Math.log(Math.max(ratio, 1e-12)) / Math.log(2) * 0.15 + Math.min(0.2, rise * 2)));
        if (reasons.isEmpty() || (peak >= 0.001 && rise > 0.0001 && rms / Math.max(previous, 0.0001) >= 1.1)) {
            Map<String, Object> measurements = new LinkedHashMap<>();
            measurements.put("rms", rms); measurements.put("minimumLevel", minimumLevel); measurements.put("levelReference", levelReference);
            measurements.put("rise", rise); measurements.put("minimumRise", 0.002); measurements.put("ratio", ratio); measurements.put("minimumRatio", 1.55);
            measurements.put("contrast", contrast); measurements.put("minimumContrast", settings.contrastRatio);
            measurements.put("backgroundRms", backgroundRms); measurements.put("baselineRms", effectiveBaseline);
            measurements.put("armed", armed); measurements.put("rearmRatio", 2.5);
            measurements.put("elapsedMs", Double.isFinite(elapsed) ? elapsed * 1000 : null);
            measurements.put("minimumSeparationMs", settings.minSeparationMs);
            Map<String, Object> candidate = new LinkedHashMap<>();
            candidate.put("version", 1); candidate.put("id", nextCandidateId++); candidate.put("time", onsetTime);
            candidate.put("strength", Math.min(1, peak)); candidate.put("confidence", confidence); candidate.put("accepted", reasons.isEmpty());
            candidate.put("reasons", reasons); candidate.put("settings", settings.toMap()); candidate.put("measurements", measurements);
            if (candidates.size() < 2048) candidates.add(candidate); else dropped++;
        }
        if (!reasons.isEmpty()) return null;
        lastOnsetTime = onsetTime;
        if (fullContrast >= settings.contrastRatio) {
            lastClearAttackTime = onsetTime;
            preAttackBackground = backgroundRms;
        }
        armed = false;
        recentPeak = envelopeRms;
        return new Onset(onsetTime, Math.min(1, peak),
            confidence);
    }
}
