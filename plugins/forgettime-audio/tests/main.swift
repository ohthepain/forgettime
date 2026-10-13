import Foundation
let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let rate = Double(CommandLine.arguments[2])!
let detector = DrumOnsetDetector(sampleRate: rate)
for frame in 0..<(data.count / 4) {
    let sample = data.withUnsafeBytes { bytes in
        Float(bitPattern: UInt32(littleEndian: bytes.loadUnaligned(fromByteOffset: frame * 4, as: UInt32.self)))
    }
    if let onset = detector.process(sample: Double(sample), time: Double(frame) / rate) {
        print("\(onset.time),\(onset.strength),\(onset.confidence)")
    }
}
