import Foundation

/// Port of src/audio/onset-detector.ts. Keep thresholds and fixtures in sync.
final class DrumOnsetDetector {
    struct Onset { let time: Double; let strength: Double; let confidence: Double }
    private let sampleRate: Double
    private var window: [Double]
    private var filled = 0
    private var windowTime = 0.0
    private var previousRms = 0.0
    private var noiseFloor = 0.0005
    private var lastOnsetTime = -Double.infinity
    private var recentPeak = 0.0
    private var armed = true
    private(set) var processedThrough = 0.0
    private var energyHistory = Array(repeating: 0.0, count: 12)
    private var historyIndex = 0
    private var historyCount = 0
    private var historyEnergy = 0.0

    init(sampleRate: Double) {
        self.sampleRate = sampleRate
        self.window = Array(repeating: 0, count: max(32, Int((sampleRate * 0.002667).rounded())))
    }
    func process(sample: Double, time: Double) -> Onset? {
        if filled == 0 { windowTime = time }
        window[filled] = sample.isFinite ? sample : 0
        filled += 1
        guard filled == window.count else { return nil }
        filled = 0
        processedThrough = windowTime + Double(window.count) / sampleRate
        var energy = 0.0
        var peak = 0.0
        for value in window { energy += value * value; peak = max(peak, abs(value)) }
        let meanEnergy = energy / Double(window.count)
        let rms = sqrt(meanEnergy)
        let backgroundRms = sqrt(max(0, historyEnergy) / Double(max(1, historyCount)))
        let backgroundReady = historyCount == energyHistory.count
        historyEnergy += meanEnergy - energyHistory[historyIndex]
        energyHistory[historyIndex] = meanEnergy
        historyIndex = (historyIndex + 1) % energyHistory.count
        historyCount = min(historyCount + 1, energyHistory.count)
        let previous = previousRms
        let floor = max(0.006, noiseFloor * 2.5)
        let rise = rms - previous
        let ratio = rms / max(previous, floor)
        let contrast = rms / max(backgroundRms, floor)
        if rms < recentPeak * 0.7 { armed = true }
        noiseFloor += (rms - noiseFloor) * (rms < noiseFloor ? 0.03 : 0.0005)
        previousRms = rms
        recentPeak = max(rms, recentPeak * 0.99)
        let elapsed = windowTime - lastOnsetTime
        if !backgroundReady || elapsed < 0.018 || (!armed && ratio < 2.5) || rms < floor || rise < 0.002 || ratio < 1.55 || contrast < 1.8 { return nil }
        var offset = 0
        let attackThreshold = max(peak * 0.25, previous * 2)
        while offset < window.count - 1 && abs(window[offset]) < attackThreshold { offset += 1 }
        let onsetTime = windowTime + Double(offset) / sampleRate
        lastOnsetTime = onsetTime
        armed = false
        recentPeak = max(recentPeak, rms)
        return Onset(time: onsetTime, strength: min(1, peak), confidence:
            min(0.98, max(0.35, 0.45 + log2(ratio) * 0.15 + min(0.2, rise * 2))))
    }
}
