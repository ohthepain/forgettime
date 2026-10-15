import Foundation

/// Port of src/audio/onset-detector.ts. Keep thresholds and fixtures in sync.
final class DrumOnsetDetector {
    struct Onset { let time: Double; let strength: Double; let confidence: Double }
    private let settingsLock = NSLock()
    private var settings: DetectorSettings
    private var diagnostics: [[String: Any]] = []
    private var diagnosticsDropped = 0
    private var nextCandidateId = 1
    func configure(_ value: DetectorSettings) {
        settingsLock.lock(); settings = value; settingsLock.unlock()
    }
    func drainDiagnostics() -> [String: Any] {
        let result: [String: Any] = ["candidates": diagnostics, "dropped": diagnosticsDropped]
        diagnostics = []; diagnosticsDropped = 0
        return result
    }
    private let sampleRate: Double
    private var window: [Double]
    private var filled = 0
    private var windowTime = 0.0
    private var previousRms = 0.0
    private var levelReference = 0.0
    private var levelHoldUntil = -Double.infinity
    private var lastOnsetTime = -Double.infinity
    private var lastClearAttackTime = -Double.infinity
    private var preAttackBackground = 0.0
    private var recentPeak = 0.0
    private var envelopeEnergy = 0.0
    private var armed = true
    private(set) var processedThrough = 0.0
    private var energyHistory = Array(repeating: 0.0, count: 12)
    private var historyIndex = 0
    private var historyCount = 0
    private var historyEnergy = 0.0

    init(sampleRate: Double, settings: DetectorSettings = .defaults) {
        self.settings = settings
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
        settingsLock.lock(); let settings = self.settings; settingsLock.unlock()
        var energy = 0.0
        var peak = 0.0
        for value in window { energy += value * value; peak = max(peak, abs(value)) }
        let meanEnergy = energy / Double(window.count)
        let rms = sqrt(meanEnergy)
        let backgroundRms = sqrt(max(0, historyEnergy) / Double(max(1, historyCount)))
        var shortEnergy = 0.0
        for i in 1...3 { shortEnergy += energyHistory[(historyIndex + energyHistory.count - i) % energyHistory.count] }
        let shortRms = sqrt(shortEnergy / 3)
        let backgroundReady = historyCount == energyHistory.count
        historyEnergy += meanEnergy - energyHistory[historyIndex]
        energyHistory[historyIndex] = meanEnergy
        historyIndex = (historyIndex + 1) % energyHistory.count
        historyCount = min(historyCount + 1, energyHistory.count)
        let previous = previousRms
        // Fast level attack, 1 s hold, 4 s release. Never apply gain to PCM.
        if windowTime >= levelHoldUntil { levelReference *= exp(-Double(window.count) / sampleRate / settings.recoverySeconds) }
        if rms >= levelReference * 0.7 { levelHoldUntil = windowTime + 1 }
        levelReference = max(rms, levelReference)
        let floor = settings.minimumRms
        let minimumLevel = max(floor, min(levelReference * 0.05, floor * 2))
        let rise = rms - previous
        let ratio = rms / max(previous, floor)
        let elapsed = windowTime - lastOnsetTime
        let fullContrast = rms / max(backgroundRms, floor)
        let baseline = windowTime - lastClearAttackTime < 0.09
            ? min(backgroundRms, max(shortRms, preAttackBackground)) : backgroundRms
        let effectiveBaseline = fullContrast < settings.contrastRatio && ratio < 2.5 ? backgroundRms : baseline
        let contrast = rms / max(effectiveBaseline, floor)
        envelopeEnergy += (meanEnergy - envelopeEnergy) * (1 - exp(-Double(window.count) / sampleRate / 0.01))
        let envelopeRms = sqrt(envelopeEnergy)
        if envelopeRms < recentPeak * 0.7 { armed = true }
        previousRms = rms
        recentPeak = max(envelopeRms, recentPeak * 0.99)
        var reasons: [String] = []
        if !backgroundReady { reasons.append("warming-up") }
        if elapsed < settings.minSeparationMs / 1000 { reasons.append("separation") }
        if !armed && ratio < 2.5 { reasons.append("rearming") }
        if rms < minimumLevel { reasons.append("level") }
        if rise < 0.002 || ratio < 1.55 { reasons.append("rise") }
        if contrast < settings.contrastRatio { reasons.append("contrast") }
        var offset = 0
        let attackThreshold = max(peak * 0.25, previous * 2)
        while offset < window.count - 1 && abs(window[offset]) < attackThreshold { offset += 1 }
        let onsetTime = windowTime + Double(offset) / sampleRate
        let confidence = min(0.98, max(0.35, 0.45 + log2(max(ratio, 1e-12)) * 0.15 + min(0.2, rise * 2)))
        if reasons.isEmpty || (peak >= 0.001 && rise > 0.0001 && rms / max(previous, 0.0001) >= 1.1) {
            let measurements: [String: Any] = [
                "rms": rms, "minimumLevel": minimumLevel, "levelReference": levelReference,
                "rise": rise, "minimumRise": 0.002, "ratio": ratio, "minimumRatio": 1.55,
                "contrast": contrast, "minimumContrast": settings.contrastRatio,
                "backgroundRms": backgroundRms, "baselineRms": effectiveBaseline, "armed": armed, "rearmRatio": 2.5,
                "elapsedMs": elapsed.isFinite ? elapsed * 1000 : NSNull(), "minimumSeparationMs": settings.minSeparationMs
            ]
            let candidate: [String: Any] = ["version": 1, "id": nextCandidateId, "time": onsetTime,
                "strength": min(1, peak), "confidence": confidence, "accepted": reasons.isEmpty,
                "reasons": reasons, "settings": settings.dictionary, "measurements": measurements]
            nextCandidateId += 1
            if diagnostics.count < 2048 { diagnostics.append(candidate) } else { diagnosticsDropped += 1 }
        }
        if !reasons.isEmpty { return nil }
        lastOnsetTime = onsetTime
        if fullContrast >= settings.contrastRatio {
            lastClearAttackTime = onsetTime
            preAttackBackground = backgroundRms
        }
        armed = false
        recentPeak = envelopeRms
        return Onset(time: onsetTime, strength: min(1, peak), confidence: confidence)
    }
}


/// Versioned mirror of src/audio/detector-contract.ts. Preserve defaults and clamps.
struct DetectorSettings {
    let minimumRms: Double
    let contrastRatio: Double
    let minSeparationMs: Double
    let recoverySeconds: Double
    static let defaults = try! DetectorSettings([:])
    init(_ values: [String: Any]) throws {
        if let version = values["version"], (version as? Int) != 1 { throw DetectorSettingsError.invalid }
        func value(_ key: String, _ fallback: Double, _ lower: Double, _ upper: Double) throws -> Double {
            guard let supplied = values[key] else { return fallback }
            guard let number = supplied as? Double, number.isFinite else { throw DetectorSettingsError.invalid }
            return min(upper, max(lower, number))
        }
        minimumRms = try value("minimumRms", 0.006, 0.001, 0.1)
        contrastRatio = try value("contrastRatio", 1.8, 1.1, 4)
        minSeparationMs = try value("minSeparationMs", 18, 8, 100)
        recoverySeconds = try value("recoverySeconds", 4, 0.25, 12)
    }
    var dictionary: [String: Any] {
        ["version": 1, "minimumRms": minimumRms, "contrastRatio": contrastRatio,
         "minSeparationMs": minSeparationMs, "recoverySeconds": recoverySeconds]
    }
}
enum DetectorSettingsError: LocalizedError {
    case invalid
    var errorDescription: String? { "Unsupported or invalid detector settings." }
}
