import Foundation

/// Native PCM boundary. Tap supplies its captured format and channel samples; analysis and
/// retained audio use exactly the same averaged mono Float32 source and relative sample clock.
final class NativeCaptureStream {
    struct Packet {
        let startFrame: Int64
        let samples: [Float]
        let time: Double
        let level: Double
        let onsets: [DrumOnsetDetector.Onset]
        let waveform: [WaveformEnvelopeCapture.Point]
        let diagnostics: [String: Any]
    }
    let sessionId: String
    let sampleRate: Double
    private let detector: DrumOnsetDetector
    private let waveform: WaveformEnvelopeCapture
    private var originSample: Int64?
    private var nextSample: Int64?
    private let deliveryLock = NSLock()
    private var acknowledgedFrame: Int64 = 0
    private var sentEndFrame: Int64 = 0

    init(sampleRate: Double, sessionId: String = UUID().uuidString, settings: DetectorSettings = .defaults) {
        self.sampleRate = sampleRate
        self.sessionId = sessionId
        detector = DrumOnsetDetector(sampleRate: sampleRate, settings: settings)
        waveform = WaveformEnvelopeCapture(sampleRate: sampleRate)
    }

    func configure(_ settings: DetectorSettings) { detector.configure(settings) }

    func acknowledge(sessionId: String, endFrame: Int64) {
        guard sessionId == self.sessionId else { return }
        deliveryLock.lock()
        if endFrame <= sentEndFrame { acknowledgedFrame = max(acknowledgedFrame, endFrame) }
        deliveryLock.unlock()
    }

    func process(frameCount: Int, sampleTime: Int64, sampleRate: Double, channelCount: Int,
                 sampleAt: (Int, Int) -> Float) throws -> Packet {
        guard sampleRate == self.sampleRate, sampleRate.isFinite, sampleRate > 0,
              frameCount > 0, frameCount <= 16384, channelCount > 0, channelCount <= 32,
              nextSample == nil || nextSample == sampleTime else { throw CaptureFailure.discontinuity }
        nextSample = sampleTime + Int64(frameCount)
        if originSample == nil { originSample = sampleTime }
        let start = sampleTime - originSample!
        deliveryLock.lock()
        let endFrame = start + Int64(frameCount)
        let overflow = endFrame - acknowledgedFrame > Int64(self.sampleRate * 0.5)
        if !overflow { sentEndFrame = endFrame }
        deliveryLock.unlock()
        guard !overflow else { throw CaptureFailure.slowConsumer }
        var pcm = [Float]()
        pcm.reserveCapacity(frameCount)
        var onsets: [DrumOnsetDetector.Onset] = []
        var points: [WaveformEnvelopeCapture.Point] = []
        var energy = 0.0
        for frame in 0..<frameCount {
            var sum = 0.0
            for channel in 0..<channelCount { sum += Double(sampleAt(channel, frame)) }
            let mono = Float(sum / Double(channelCount))
            guard mono.isFinite else { throw CaptureFailure.discontinuity }
            pcm.append(mono)
            let sample = Double(mono)
            let time = Double(start + Int64(frame)) / sampleRate
            energy += sample * sample
            if let onset = detector.process(sample: sample, time: time) { onsets.append(onset) }
            if let point = waveform.process(sample: sample, time: time) { points.append(point) }
        }
        return Packet(startFrame: start, samples: pcm, time: detector.processedThrough,
                      level: min(1, sqrt(energy / Double(max(1, frameCount)))), onsets: onsets, waveform: points, diagnostics: detector.drainDiagnostics())
    }
}

enum CaptureFailure: LocalizedError {
    case slowConsumer, discontinuity
    var errorDescription: String? {
        switch self {
        case .slowConsumer:
            return "Audio delivery could not keep up. Your captured material is preserved; restart listening."
        case .discontinuity:
            return "Audio capture was interrupted or changed format. Your captured material is preserved; restart listening."
        }
    }
}
