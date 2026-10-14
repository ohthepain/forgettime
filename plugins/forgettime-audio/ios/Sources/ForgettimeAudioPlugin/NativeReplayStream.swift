import Foundation

/// Native analysis follows the output's monotonic source-frame cursor. It never re-acquires
/// beat one, resets at a loop boundary, or analyzes metronome/output-mixer samples.
final class NativeReplayStream {
    let sampleRate: Double
    let samples: [Float]
    private let detector: DrumOnsetDetector
    private var cursor: Int64 = 0

    init(sampleRate: Double, samples: [Float], settings: DetectorSettings) throws {
        guard sampleRate.isFinite, sampleRate.rounded() == sampleRate, sampleRate >= 8000, sampleRate <= 192000,
              !samples.isEmpty, samples.count <= min(Int(sampleRate * 8), 1536000), samples.allSatisfy({ $0.isFinite })
        else { throw ReplayFailure.invalidSource }
        self.sampleRate = sampleRate
        self.samples = samples
        self.detector = DrumOnsetDetector(sampleRate: sampleRate, settings: settings)
    }

    func read(audibleFrame: Int64) throws -> [String: Any] {
        guard audibleFrame >= cursor, audibleFrame - cursor <= Int64(sampleRate * 2) else { throw ReplayFailure.discontinuity }
        var onsets: [[String: Double]] = []
        while cursor < audibleFrame {
            let sample = samples[Int(cursor % Int64(samples.count))]
            if let hit = detector.process(sample: Double(sample), time: Double(cursor) / sampleRate) {
                guard onsets.count < 2048 else { throw ReplayFailure.discontinuity }
                onsets.append(["time": hit.time, "strength": hit.strength, "confidence": hit.confidence])
            }
            cursor += 1
        }
        return ["sampleRate": sampleRate, "audibleFrame": audibleFrame,
                "analyzedThroughFrame": Int64((detector.processedThrough * sampleRate).rounded()),
                "onsets": onsets, "diagnostics": detector.drainDiagnostics()]
    }
}

enum ReplayFailure: LocalizedError {
    case invalidSource, discontinuity, unavailable
    var errorDescription: String? {
        switch self {
        case .invalidSource: return "Replay requires a finite complete mono bar of at most 8 seconds at 8–192 kHz."
        case .discontinuity: return "Replay output or analysis was interrupted. Play again for a fresh run."
        case .unavailable: return "Native audio output could not start or stopped. Play again to retry."
        }
    }
}

/// Maps a player/render sample clock to source coordinates. Presentation latency is
/// a platform estimate; this never substitutes polling or JavaScript callback time.
final class ReplaySourceClock {
    private let sourceRate: Double
    private var previousRenderSeconds = 0.0
    private var previousFrame: Int64 = 0
    init(sourceRate: Double) { self.sourceRate = sourceRate }
    func frame(renderedFrame: Int64, renderedRate: Double, latency: Double) throws -> Int64 {
        guard renderedRate.isFinite, renderedRate > 0, renderedFrame >= 0, latency.isFinite, latency >= 0 else { throw ReplayFailure.discontinuity }
        let seconds = Double(renderedFrame) / renderedRate
        guard seconds >= previousRenderSeconds else { throw ReplayFailure.discontinuity }
        previousRenderSeconds = seconds
        let value = max(0, (seconds - latency) * sourceRate)
        guard value < Double(Int64.max) else { throw ReplayFailure.discontinuity }
        // A changing latency estimate cannot move an already displayed source frame backwards.
        previousFrame = max(previousFrame, Int64(floor(value + 1e-7)))
        return previousFrame
    }
}
