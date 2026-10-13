import Foundation
let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let rate = Double(CommandLine.arguments[2])!
let detector = DrumOnsetDetector(sampleRate: rate)
let waveform = WaveformEnvelopeCapture(sampleRate: rate)
let showWaveform = CommandLine.arguments.count > 3
for frame in 0..<(data.count / 4) {
    let sample = data.withUnsafeBytes { bytes in
        Float(bitPattern: UInt32(littleEndian: bytes.loadUnaligned(fromByteOffset: frame * 4, as: UInt32.self)))
    }
    let onset = detector.process(sample: Double(sample), time: Double(frame) / rate)
    let point = waveform.process(sample: Double(sample), time: Double(frame) / rate)
    if showWaveform, let point = point {
        print("\(point.time),\(point.duration),\(point.min),\(point.max)")
    }
    if !showWaveform, let onset = onset {
        print("\(onset.time),\(onset.strength),\(onset.confidence)")
    }
}
