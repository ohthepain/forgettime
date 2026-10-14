import Foundation

if CommandLine.arguments.count > 1 {
    let input = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
    let rate = Double(CommandLine.arguments[2])!
    let capture = NativeCaptureStream(sampleRate: rate, sessionId: "pcm-fixture")
    let count = input.count / 4
    var retained = Data()
    var onsets: [[String: Double]] = []
    var packets: [[String: Double]] = []
    var frame = 0
    var chunk = 0
    while frame < count {
        let size = min([127, 1024, 256, 381][chunk % 4], count - frame)
        let packet = try capture.process(frameCount: size, sampleTime: Int64(999000 + frame), sampleRate: rate, channelCount: 1) { _, offset in
            input.withUnsafeBytes { bytes in Float(bitPattern: UInt32(littleEndian: bytes.loadUnaligned(fromByteOffset: (frame + offset) * 4, as: UInt32.self))) }
        }
        for sample in packet.samples {
            var bits = sample.bitPattern.littleEndian
            withUnsafeBytes(of: &bits) { retained.append(contentsOf: $0) }
        }
        onsets.append(contentsOf: packet.onsets.map { ["time": $0.time, "strength": $0.strength, "confidence": $0.confidence] })
        packets.append(["startFrame": Double(packet.startFrame), "count": Double(packet.samples.count), "time": packet.time])
        capture.acknowledge(sessionId: "pcm-fixture", endFrame: packet.startFrame + Int64(packet.samples.count))
        frame += size
        chunk += 1
    }
    try retained.write(to: URL(fileURLWithPath: CommandLine.arguments[3]))
    let result = try JSONSerialization.data(withJSONObject: ["onsets": onsets, "packets": packets], options: [.sortedKeys])
    print(String(data: result, encoding: .utf8)!)
    exit(0)
}

// Actual native capture seam with a synthetic hardware boundary; no microphone/device claims.
for rate in [44100.0, 48000.0] {
    let capture = NativeCaptureStream(sampleRate: rate, sessionId: "fixture")
    let left: [Float] = [0, 0.75, -0.5, 0.25]
    let right: [Float] = [0, 0.25, -0.5, -0.25]
    let packet = try capture.process(frameCount: 4, sampleTime: 987654, sampleRate: rate, channelCount: 2) { channel, frame in
        (channel == 0 ? left : right)[frame]
    }
    precondition(packet.startFrame == 0)
    precondition(packet.samples == [0, 0.5, -0.5, 0])
    capture.acknowledge(sessionId: "fixture", endFrame: 4)
    let next = try capture.process(frameCount: 3, sampleTime: 987658, sampleRate: rate, channelCount: 1) { _, _ in 0.25 }
    precondition(next.startFrame == 4 && next.samples == [0.25, 0.25, 0.25])
}
print("Swift native capture retains original mono PCM at 44.1/48 kHz with contiguous source frames")

func mustReject(_ action: () throws -> Void) {
    do { try action() } catch { return }
    fatalError("Capture should reject discontinuous or unbounded audio")
}
let stalled = NativeCaptureStream(sampleRate: 48000, sessionId: "stalled")
for packet in 0..<20 {
    _ = try stalled.process(frameCount: 1200, sampleTime: Int64(packet * 1200), sampleRate: 48000, channelCount: 1) { _, _ in 0 }
}
// Old-generation and impossible acknowledgements cannot evade the 0.5 second limit.
stalled.acknowledge(sessionId: "prior-session", endFrame: 24000)
stalled.acknowledge(sessionId: "stalled", endFrame: 48000)
mustReject {
    _ = try stalled.process(frameCount: 1200, sampleTime: 24000, sampleRate: 48000, channelCount: 1) { _, _ in 0 }
}
print("Swift stalled consumer stops at 0.5 seconds without silently dropping PCM")

for problem in ["gap", "rate", "invalid", "oversized"] {
    let capture = NativeCaptureStream(sampleRate: 48000)
    _ = try capture.process(frameCount: 1024, sampleTime: 1000, sampleRate: 48000, channelCount: 1) { _, _ in 0 }
    mustReject {
        _ = try capture.process(frameCount: problem == "oversized" ? 16385 : 1024,
            sampleTime: problem == "gap" ? 4096 : 2024,
            sampleRate: problem == "rate" ? 44100 : 48000, channelCount: 1) { _, _ in
                problem == "invalid" ? Float.nan : 0
            }
    }
}
print("Swift capture rejects missing frames, format changes, invalid PCM and oversized input")
