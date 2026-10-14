import Foundation
import AVFoundation

/// File decoding only; never configures an audio session, microphone or output device.
enum NativeAudioFileDecoder {
    struct Result { let frames: Int; let sampleRate: Double; let channels: Int }
    static func decode(source: URL, output: URL) throws -> Result {
        let file = try AVAudioFile(forReading: source, commonFormat: .pcmFormatFloat32, interleaved: false)
        let format = file.processingFormat, rate = format.sampleRate, channels = Int(format.channelCount)
        guard rate.isFinite, rate.rounded() == rate, (8000...192000).contains(rate), (1...8).contains(channels),
              file.length > 0, file.length <= Int64(rate * 120), file.length <= Int64(NativeBarFiles.pcmLimit / 4),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096) else { throw FileFailure.invalid("Decoded audio exceeds 120 seconds / 32 MiB or has an unsupported format.") }
        try Data().write(to: output)
        let target = try FileHandle(forWritingTo: output)
        var completed = false
        defer { try? target.close(); if !completed { try? FileManager.default.removeItem(at: output) } }
        var frames = 0
        while file.framePosition < file.length {
            try file.read(into: buffer, frameCount: 4096)
            let count = Int(buffer.frameLength)
            guard count > 0 else { throw FileFailure.invalid("Audio file ended before its declared duration.") }
            guard frames + count <= Int(rate * 120), frames + count <= NativeBarFiles.pcmLimit / 4,
                  let channelData = buffer.floatChannelData else { throw FileFailure.invalid("Decoded audio exceeds supported limits.") }
            var bytes = Data(capacity: count * 4)
            for frame in 0..<count {
                var value = Double(channelData[0][frame]) / Double(channels)
                for channel in 1..<channels { value += Double(channelData[channel][frame]) / Double(channels) }
                let mono = Float(value)
                guard mono.isFinite else { throw FileFailure.invalid("Decoded audio contains invalid samples.") }
                var word = mono.bitPattern.littleEndian
                withUnsafeBytes(of: &word) { bytes.append(contentsOf: $0) }
            }
            try target.write(contentsOf: bytes); frames += count
        }
        guard frames > 0 else { throw FileFailure.invalid("Audio decoder returned no samples.") }
        completed = true
        return Result(frames: frames, sampleRate: rate, channels: channels)
    }
}
