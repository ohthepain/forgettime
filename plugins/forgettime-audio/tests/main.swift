import Foundation
let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let rate = Double(CommandLine.arguments[2])!
let settings = CommandLine.arguments.count >= 8
    ? try DetectorSettings(["version": 1, "minimumRms": Double(CommandLine.arguments[4])!,
        "contrastRatio": Double(CommandLine.arguments[5])!, "minSeparationMs": Double(CommandLine.arguments[6])!,
        "recoverySeconds": Double(CommandLine.arguments[7])!]) : DetectorSettings.defaults
let detector = DrumOnsetDetector(sampleRate: rate, settings: settings, frequencyBalance: CommandLine.arguments.count >= 9 ? Double(CommandLine.arguments[8])! : 0)
let waveform = WaveformEnvelopeCapture(sampleRate: rate)
let showWaveform = CommandLine.arguments.count > 3 && CommandLine.arguments[3] == "waveform"
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
