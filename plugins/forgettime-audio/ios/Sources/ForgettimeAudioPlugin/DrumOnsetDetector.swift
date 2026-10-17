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
    private let frequency: FrequencyEvidence?
    private let frequencyBalance: Double
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

    init(sampleRate: Double, settings: DetectorSettings = .defaults, frequencyBalance: Double = 0) {
        self.frequencyBalance = min(100, max(0, frequencyBalance.isFinite ? frequencyBalance : 0))
        self.frequency = self.frequencyBalance > 0 ? FrequencyEvidence(sampleRate: sampleRate) : nil
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
        let spectral = frequency?.analyze(samples: window, sampleRate: sampleRate, minimumRms: floor, contrastRatio: settings.contrastRatio)
        let energyScore = max(0, min(2, rise / 0.002, ratio / 1.55, contrast / settings.contrastRatio, armed ? 2 : ratio / 4))
        let weight = frequencyBalance / 100
        let blendedScore = spectral.map { (1 - weight) * energyScore + weight * $0.score } ?? energyScore
        var reasons: [String] = []
        if !backgroundReady { reasons.append("warming-up") }
        if elapsed < settings.minSeparationMs / 1000 { reasons.append("separation") }
        if spectral == nil && !armed && ratio < 4 { reasons.append("rearming") }
        if rms < minimumLevel { reasons.append("level") }
        if spectral != nil ? blendedScore < 1 : (rise < 0.002 || ratio < 1.55) { reasons.append("rise") }
        if spectral == nil && contrast < settings.contrastRatio { reasons.append("contrast") }
        var offset = 0
        let attackThreshold = max(peak * 0.25, previous * 2)
        while offset < window.count - 1 && abs(window[offset]) < attackThreshold { offset += 1 }
        if let spectral = spectral, weight >= 0.5 { offset = spectral.offset }
        let onsetTime = windowTime + Double(offset) / sampleRate
        let confidence = min(0.98, max(0.35, 0.45 + log2(max(spectral == nil ? ratio : 1 + blendedScore, 1e-12)) * 0.15 + min(0.2, rise * 2)))
        if reasons.isEmpty || (spectral != nil && spectral!.score > 0.1) || (peak >= 0.001 && rise > 0.0001 && rms / max(previous, 0.0001) >= 1.1) {
            let measurements: [String: Any] = [
                "rms": rms, "minimumLevel": minimumLevel, "levelReference": levelReference,
                "rise": rise, "minimumRise": 0.002, "ratio": ratio, "minimumRatio": 1.55,
                "contrast": contrast, "minimumContrast": settings.contrastRatio,
                "backgroundRms": backgroundRms, "baselineRms": effectiveBaseline, "armed": armed, "rearmRatio": 4,
                "elapsedMs": elapsed.isFinite ? elapsed * 1000 : NSNull(), "minimumSeparationMs": settings.minSeparationMs
            ]
            var candidate: [String: Any] = ["version": 1, "id": nextCandidateId, "time": onsetTime,
                "strength": min(1, peak), "confidence": confidence, "accepted": reasons.isEmpty,
                "reasons": reasons, "settings": settings.dictionary, "measurements": measurements]
            if let spectral = spectral { candidate["evidence"] = ["version": 1, "frequencyBalance": frequencyBalance,
                "energyScore": energyScore, "frequencyScore": spectral.score, "blendedScore": blendedScore, "bandHz": spectral.bandHz] }
            nextCandidateId += 1
            if diagnostics.count < 2048 { diagnostics.append(candidate) } else { diagnosticsDropped += 1 }
        }
        if !reasons.isEmpty { return nil }
        frequency?.accept(contrastRatio: settings.contrastRatio)
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
        minimumRms = try value("minimumRms", 0.002, 0.001, 0.1)
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

/// Octave band energy-growth evidence; mirror of frequency-evidence.ts.
private final class FrequencyEvidence {
    private final class Band {
        let hz: Double, b: Double, a1: Double, a2: Double
        var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0, energy = 0.0, previous = 0.0, peak = 0.0, sum = 0.0
        var rawPrevious = 0.0, rearmEnergy = 0.0, rearmRms = 0.0
        var preBackground = 0.0, background = 0.0, fullContrast = 0.0
        var clearWindow = -1000000
        var armed = true
        var history = Array(repeating: 0.0, count: 12)
        init(hz: Double, rate: Double) {
            self.hz = hz
            let omega = 2 * Double.pi * hz / rate, alpha = sin(omega) / (2 * sqrt(0.5))
            b = alpha / (1 + alpha); a1 = -2 * cos(omega) / (1 + alpha); a2 = (1 - alpha) / (1 + alpha)
        }
    }
    struct Evidence { var score = 0.0; var bandHz = 0.0; var offset = 0 }
    private var bands: [Band]
    private var index = 0, count = 0, windowIndex = 0
    private var filtered: [Double] = []
    init(sampleRate: Double) {
        bands = [80.0, 160, 320, 640, 1280, 2560, 5120, 10240].filter { $0 < sampleRate * 0.45 }.map { Band(hz: $0, rate: sampleRate) }
    }
    func analyze(samples: [Double], sampleRate: Double, minimumRms: Double, contrastRatio: Double) -> Evidence {
        var result = Evidence()
        let floor = minimumRms * 0.25, smoothing = 1 - exp(-Double(samples.count) / sampleRate / 0.003)
        if filtered.count != samples.count { filtered = Array(repeating: 0, count: samples.count) }
        for band in bands {
            var energy = 0.0, peak = 0.0
            var peakOffset = 0
            for i in samples.indices {
                let x = samples[i], y = band.b * (x - band.x2) - band.a1 * band.y1 - band.a2 * band.y2
                band.x2 = band.x1; band.x1 = x; band.y2 = band.y1; band.y1 = y
                filtered[i] = y; energy += y * y
                if abs(y) > peak { peak = abs(y); peakOffset = i }
            }
            let rawRms = sqrt(energy / Double(samples.count))
            let rawRatio = rawRms / max(band.rawPrevious, floor)
            band.rawPrevious = rawRms
            band.energy += (energy / Double(samples.count) - band.energy) * smoothing
            band.rearmEnergy += (energy / Double(samples.count) - band.rearmEnergy) * (1 - exp(-Double(samples.count) / sampleRate / 0.01))
            band.rearmRms = sqrt(max(0, band.rearmEnergy))
            let rms = sqrt(max(0, band.energy)), background = sqrt(max(0, band.sum) / Double(max(1, count)))
            if band.rearmRms < band.peak * 0.7 { band.armed = true }
            let ratio = rms / max(band.previous, floor)
            var shortEnergy = 0.0
            for i in 1...3 { shortEnergy += band.history[(index + 12 - i) % 12] }
            band.background = background; band.fullContrast = rms / max(background, floor)
            let baseline = Double((windowIndex - band.clearWindow) * samples.count) / sampleRate < 0.09 && rawRatio >= 2.5
                ? min(background, max(sqrt(max(0, shortEnergy) / 3), band.preBackground)) : background
            let score = max(0, min(2, (rms - band.previous) / 0.0005, ratio / 1.55, rms / max(baseline, floor) / contrastRatio, band.armed ? 2 : ratio / 4))
            if score > result.score {
                result.score = score; result.bandHz = band.hz
                let threshold = max(peak * 0.25, band.previous * 2)
                var crossing = 0
                while crossing < peakOffset && abs(filtered[crossing]) < threshold { crossing += 1 }
                result.offset = crossing
            }
            band.sum += band.energy - band.history[index]; band.history[index] = band.energy
            band.previous = rms; band.peak = max(band.rearmRms, band.peak * 0.99)
        }
        windowIndex += 1
        index = (index + 1) % 12; count = min(count + 1, 12)
        return result
    }
    func accept(contrastRatio: Double) {
        for band in bands {
            band.armed = false; band.peak = band.rearmRms
            if band.fullContrast >= contrastRatio { band.clearWindow = windowIndex - 1; band.preBackground = band.background }
        }
    }
}
