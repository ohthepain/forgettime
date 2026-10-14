import Foundation
let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let rate = Double(CommandLine.arguments[2])!
let values = try JSONSerialization.jsonObject(with: Data(CommandLine.arguments[3].utf8)) as! [String: Any]
let detector = DrumOnsetDetector(sampleRate: rate, settings: try DetectorSettings(values))
var onsets: [[String: Double]] = []
for frame in 0..<(data.count / 4) {
    let sample = data.withUnsafeBytes { bytes in Float(bitPattern: UInt32(littleEndian: bytes.loadUnaligned(fromByteOffset: frame * 4, as: UInt32.self))) }
    if let hit = detector.process(sample: Double(sample), time: Double(frame) / rate) {
        onsets.append(["time": hit.time, "strength": hit.strength, "confidence": hit.confidence])
    }
}
let result: [String: Any] = ["onsets": onsets, "diagnostics": detector.drainDiagnostics()]
print(String(data: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), encoding: .utf8)!)
