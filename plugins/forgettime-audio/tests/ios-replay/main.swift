import Foundation
if CommandLine.arguments.count == 1 {
    func reject(_ action: () throws -> Void) {
        do { try action() } catch { return }
        fatalError("Invalid or discontinuous replay must fail visibly")
    }
    reject { _ = try NativeReplayStream(sampleRate: 48000, samples: [], settings: .defaults) }
    reject { _ = try NativeReplayStream(sampleRate: 7999, samples: [0], settings: .defaults) }
    reject { _ = try NativeReplayStream(sampleRate: 192001, samples: [0], settings: .defaults) }
    reject { _ = try NativeReplayStream(sampleRate: 48000, samples: [.nan], settings: .defaults) }
    reject { _ = try NativeReplayStream(sampleRate: 48000, samples: Array(repeating: 0, count: 384001), settings: .defaults) }
    let replay = try NativeReplayStream(sampleRate: 48000, samples: [0], settings: .defaults)
    _ = try replay.read(audibleFrame: 100)
    reject { _ = try replay.read(audibleFrame: 99) }
    reject { _ = try replay.read(audibleFrame: 96101) }
    let clock = ReplaySourceClock(sourceRate: 44100)
    let firstFrame = try clock.frame(renderedFrame: 4800, renderedRate: 48000, latency: 0.01)
    precondition(firstFrame == 3969)
    let nextFrame = try clock.frame(renderedFrame: 9600, renderedRate: 48000, latency: 0.01)
    precondition(nextFrame == 8379)
    reject { _ = try clock.frame(renderedFrame: 100, renderedRate: 48000, latency: 0.01) }
    print("Swift replay rejects invalid source, clock regression and excessive catch-up")
    exit(0)
}
let input = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let rate = Double(CommandLine.arguments[2])!
let settings = try DetectorSettings(JSONSerialization.jsonObject(with: Data(CommandLine.arguments[3].utf8)) as! [String: Any])
let samples: [Float] = (0..<(input.count / 4)).map { frame in
    input.withUnsafeBytes { bytes in Float(bitPattern: UInt32(littleEndian: bytes.loadUnaligned(fromByteOffset: frame * 4, as: UInt32.self))) }
}
let replay = try NativeReplayStream(sampleRate: rate, samples: samples, settings: settings)
for frame in CommandLine.arguments[4].split(separator: ",").map({ Int64($0)! }) {
    let result = try replay.read(audibleFrame: frame)
    print(String(data: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), encoding: .utf8)!)
}
