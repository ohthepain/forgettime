import Foundation

/// Min/max captured PCM windows for display, not normalized or stored audio.
final class WaveformEnvelopeCapture {
    struct Point { let time: Double; let duration: Double; let min: Double; let max: Double }
    private let size: Int
    private let sampleRate: Double
    private var count = 0
    private var start = 0.0
    private var minimum = Double.infinity
    private var maximum = -Double.infinity
    init(sampleRate: Double) {
        self.sampleRate = sampleRate
        self.size = max(1, Int((sampleRate * 0.002).rounded()))
    }
    func process(sample: Double, time: Double) -> Point? {
        if count == 0 { start = time }
        let value = sample.isFinite ? sample : 0
        minimum = min(minimum, value)
        maximum = max(maximum, value)
        count += 1
        guard count == size else { return nil }
        let point = Point(time: start, duration: Double(size) / sampleRate, min: minimum, max: maximum)
        count = 0; minimum = .infinity; maximum = -.infinity
        return point
    }
}
