import Foundation
import AVFoundation
func check(_ value: Bool, _ message: String) { if !value { fatalError(message) } }
let root = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
for rate in [44100.0, 48000.0] {
    let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 2, interleaved: false)!
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 8192)!
    buffer.frameLength = 8192
    for frame in 0..<8192 {
        let wave = Float(sin(Double(frame) * 2 * .pi * 440 / rate))
        buffer.floatChannelData![0][frame] = wave * 0.4
        buffer.floatChannelData![1][frame] = wave * 0.2
    }
    for ext in ["wav", "m4a"] {
        let source = root.appendingPathComponent("source-\(Int(rate)).\(ext)")
        let settings: [String: Any] = ext == "wav" ? [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: rate, AVNumberOfChannelsKey: 2, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false] : [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: rate, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 192000]
        do { let writer = try AVAudioFile(forWriting: source, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false); try writer.write(from: buffer) }
        fputs("Decode \(source.path)\n", stderr)
        let output = root.appendingPathComponent("decoded.f32")
        let result = try NativeAudioFileDecoder.decode(source: source, output: output)
        check(result.sampleRate == rate && result.channels == 2, "Native decode keeps actual rate and original channels")
        let bytes = try Data(contentsOf: output)
        check(bytes.count == result.frames * 4 && result.frames >= 8192, "Actual decoded frame count describes output")
        let values = bytes.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
        let rms = sqrt(values.prefix(8192).reduce(0.0) { $0 + Double($1 * $1) } / 8192)
        check(abs(rms - 0.212) < 0.015, "Stereo decoding uses arithmetic mean, without channel duplication")
        if ext == "wav" { for frame in 0..<8192 { check(abs(values[frame] - Float(sin(Double(frame) * 2 * .pi * 440 / rate)) * 0.3) < 1e-7, "WAV host fixture has exact known mono PCM") } }
        try FileManager.default.removeItem(at: output)
    }
}
print("AVAudioFile host decode: real stereo WAV/AAC M4A, mono averaging and source rates pass")
