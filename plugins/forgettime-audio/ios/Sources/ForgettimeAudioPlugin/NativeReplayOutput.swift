import AVFoundation
import Foundation

/// Foreground output only: no input node, input tap or microphone permission request.
/// All public methods run on the plugin's main queue; audio rendering remains native.
final class NativeReplayOutput {
    let sessionId: String
    let stream: NativeReplayStream
    let engine = AVAudioEngine()
    let metronome = MetronomeOutput()
    private let player = AVAudioPlayerNode()
    private let clock: ReplaySourceClock
    private var buffer: AVAudioPCMBuffer?
    private var startedAt = 0.0
    private var lastProgressAt = 0.0
    private var lastRenderFrame: Int64 = 0
    private var stopped = false

    init(sessionId: String, sampleRate: Double, samples: [Float], settings: DetectorSettings, frequencyBalance: Double = 0) throws {
        self.sessionId = sessionId
        stream = try NativeReplayStream(sampleRate: sampleRate, samples: samples, settings: settings, frequencyBalance: frequencyBalance)
        clock = ReplaySourceClock(sourceRate: sampleRate)
    }
    func start() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default)
        try session.setActive(true)
        guard let format = AVAudioFormat(standardFormatWithSampleRate: stream.sampleRate, channels: 1),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(stream.samples.count)),
              let target = buffer.floatChannelData?[0] else { throw ReplayFailure.unavailable }
        buffer.frameLength = buffer.frameCapacity
        stream.samples.withUnsafeBufferPointer { source in target.update(from: source.baseAddress!, count: source.count) }
        self.buffer = buffer
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        let clicks = metronome.makeSource(format: format)
        engine.attach(clicks)
        engine.connect(clicks, to: engine.mainMixerNode, format: format)
        player.scheduleBuffer(buffer, at: nil, options: .loops)
        engine.prepare()
        try engine.start()
        player.play()
        startedAt = ProcessInfo.processInfo.systemUptime
        lastProgressAt = startedAt
    }
    func read() throws -> [String: Any] {
        guard !stopped, engine.isRunning, player.isPlaying else { throw ReplayFailure.unavailable }
        // Uptime only limits startup/stalls; it never measures source samples or attacks.
        let now = ProcessInfo.processInfo.systemUptime
        guard let nodeTime = player.lastRenderTime, let playerTime = player.playerTime(forNodeTime: nodeTime), playerTime.isSampleTimeValid else {
            guard now - startedAt < 1 else { throw ReplayFailure.unavailable }
            return packet(try stream.read(audibleFrame: 0))
        }
        if playerTime.sampleTime > lastRenderFrame { lastProgressAt = now }
        guard now - lastProgressAt < 1 else { throw ReplayFailure.unavailable }
        lastRenderFrame = playerTime.sampleTime
        let frame = try clock.frame(renderedFrame: playerTime.sampleTime, renderedRate: playerTime.sampleRate,
                                    latency: player.outputPresentationLatency)
        if nodeTime.isHostTimeValid {
            metronome.anchor(captureTime: Double(playerTime.sampleTime) / playerTime.sampleRate,
                             hostTime: AVAudioTime.seconds(forHostTime: nodeTime.hostTime))
        }
        return packet(try stream.read(audibleFrame: frame))
    }
    private func packet(_ fields: [String: Any]) -> [String: Any] {
        var result = fields
        result["sessionId"] = sessionId
        result["status"] = "playing"
        // Player render timestamps are native; downstream presentation latency is an estimate.
        result["clockQuality"] = "estimated"
        return result
    }
    func stop() {
        guard !stopped else { return }
        stopped = true
        metronome.update(nil)
        player.stop()
        engine.stop()
        buffer = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
