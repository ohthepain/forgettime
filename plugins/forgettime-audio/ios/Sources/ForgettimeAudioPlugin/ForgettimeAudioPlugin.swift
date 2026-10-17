import Foundation
import AVFoundation
import UIKit
import Capacitor

@objc(ForgettimeAudioPlugin)
public final class ForgettimeAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ForgettimeAudioPlugin"
    public let jsName = "ForgettimeAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "listSavedBars", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginBarSave", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendFileChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "commitBarSave", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abortFileTransfer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readSavedBar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickAudioFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFileChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "releaseFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginAudioDecode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishAudioDecode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportSavedBar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startReplay", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readReplay", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopReplay", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setReplayMetronome", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setInputGain", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDetectorSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledgeFrame", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMetronome", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]
    let fileController = NativeFilesController()
    private var capture: AudioCaptureSession?
    private var replay: NativeReplayOutput?
    private var replayTerminal: [String: Any]?
    private var cancelledReplays: [String] = []
    private var pendingStart: CAPPluginCall?
    private var observers: [NSObjectProtocol] = []

    public override func load() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.stopAll(reason: "background")
        })
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] event in
            guard let type = event.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  type == AVAudioSession.InterruptionType.began.rawValue else { return }
            self?.stopAll(reason: "audio-interrupted")
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] event in
            guard let value = event.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  let reason = AVAudioSession.RouteChangeReason(rawValue: value),
                  [.oldDeviceUnavailable, .newDeviceAvailable, .noSuitableRouteForCategory, .routeConfigurationChange, .override].contains(reason) else { return }
            self?.stopAll(reason: "microphone-route-changed")
        })
        observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main) { [weak self] event in
            guard let self = self, let output = self.replay, let engine = event.object as? AVAudioEngine,
                  engine === output.engine, !engine.isRunning else { return }
            self.stopReplayOutput(reason: "Audio output configuration changed. Play again for a fresh run.")
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            self?.stopAll(reason: "audio-service-reset")
        })
    }

    @objc public func startReplay(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let id = call.getString("sessionId"), !id.isEmpty, id.count <= 128,
                  !self.cancelledReplays.contains(id), self.replay == nil, self.capture == nil, self.pendingStart == nil,
                  UIApplication.shared.applicationState != .background else {
                call.reject("Replay was cancelled, the app is in background, or another audio session is active.")
                return
            }
            do {
                guard let rate = call.getDouble("sampleRate"), let values = call.getArray("samples", Double.self),
                      values.count <= 1536000 else { throw ReplayFailure.invalidSource }
                let output = try NativeReplayOutput(sessionId: id, sampleRate: rate, samples: values.map(Float.init),
                    settings: try DetectorSettings(call.getObject("detectorSettings") ?? [:]))
                self.replay = output
                self.replayTerminal = nil
                try output.start()
                call.resolve(["sessionId": id, "sampleRate": rate, "frameCount": values.count, "diagnosticsSupported": true])
            } catch {
                self.stopReplayOutput(reason: error.localizedDescription, error: true)
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func readReplay(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let id = call.getString("sessionId") ?? ""
            guard let output = self.replay, output.sessionId == id else {
                if self.replayTerminal?["sessionId"] as? String == id { call.resolve(self.replayTerminal!); return }
                call.reject("This native replay session is no longer active.")
                return
            }
            do { call.resolve(try output.read()) }
            catch {
                self.stopReplayOutput(reason: error.localizedDescription, error: true)
                call.resolve(self.replayTerminal!)
            }
        }
    }

    @objc public func stopReplay(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let id = call.getString("sessionId") {
                self.cancelledReplays.append(id)
                self.cancelledReplays = Array(self.cancelledReplays.suffix(32))
                if self.replay?.sessionId == id { self.stopReplayOutput(reason: "Playback paused.") }
            }
            call.resolve()
        }
    }

    @objc public func setReplayMetronome(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let output = self.replay, output.sessionId == call.getString("sessionId") else { call.resolve(); return }
            do { output.metronome.update(try self.metronomePlan(call)); call.resolve() }
            catch { call.reject(error.localizedDescription) }
        }
    }

    @objc public func setInputGain(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let current = self.capture, current.stream.sessionId == call.getString("sessionId") else { call.resolve(); return }
            do { try current.stream.setInputGain(call.getDouble("inputGain") ?? 1); call.resolve() }
            catch { call.reject(error.localizedDescription) }
        }
    }

    @objc public func setDetectorSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let current = self.capture, current.stream.sessionId == call.getString("sessionId") else { call.resolve(); return }
            do { current.stream.configure(try DetectorSettings(call.getObject("detectorSettings") ?? [:])); call.resolve() }
            catch { call.reject(error.localizedDescription) }
        }
    }

    private func metronomePlan(_ call: CAPPluginCall) throws -> MetronomeOutput.Plan? {
        guard let value = call.getObject("plan") else { return nil }
        guard let origin = value["origin"] as? Double, let bpm = value["bpm"] as? Double,
              let fromBeat = value["fromBeat"] as? Int, let untilTime = value["untilTime"] as? Double,
              origin.isFinite, bpm.isFinite, untilTime.isFinite, bpm >= 30, bpm <= 300, fromBeat >= 1 else { throw ReplayFailure.invalidSource }
        return .init(origin: origin, bpm: bpm, fromBeat: fromBeat, untilTime: untilTime)
    }

    private func stopReplayOutput(reason: String, error: Bool = false) {
        guard let output = replay else { return }
        replay = nil
        output.stop()
        replayTerminal = ["sessionId": output.sessionId, "status": error ? "error" : "stopped", "reason": reason,
            "sampleRate": output.stream.sampleRate, "audibleFrame": 0, "analyzedThroughFrame": 0,
            "clockQuality": "estimated", "onsets": [], "diagnostics": ["candidates": [], "dropped": 0]]
    }

    private func stopAll(reason: String) {
        stopCapture(reason: reason)
        stopReplayOutput(reason: "Playback interrupted: \(reason). Play again for a fresh run.")
    }

    @objc public func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.capture == nil, self.pendingStart == nil, self.replay == nil else {
                call.reject("Microphone capture is already starting or running.")
                return
            }
            guard UIApplication.shared.applicationState != .background else {
                call.reject("Open the app before starting the microphone.")
                return
            }
            self.pendingStart = call
            let permission: (Bool) -> Void = { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self = self, self.pendingStart === call else { return }
                    if granted { self.begin(call) }
                    else {
                        self.pendingStart = nil
                        call.reject("Microphone permission was denied. Enable it in iOS Settings to listen.")
                    }
                }
            }
            if #available(iOS 17.0, *) { AVAudioApplication.requestRecordPermission(completionHandler: permission) }
            else { AVAudioSession.sharedInstance().requestRecordPermission(permission) }
        }
    }

    private func begin(_ call: CAPPluginCall) {
        guard pendingStart === call else { return }
        let session = AVAudioSession.sharedInstance()
        let engine = AVAudioEngine()
        do {
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker])
            try session.setPreferredSampleRate(48000)
            try session.setPreferredIOBufferDuration(0.01)
            try session.setActive(true)
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                throw CaptureError.unavailableMicrophone
            }
            let current = AudioCaptureSession(engine: engine, sampleRate: format.sampleRate, settings: try DetectorSettings(call.getObject("detectorSettings") ?? [:]))
            try current.stream.setInputGain(call.getDouble("inputGain") ?? 1)
            let outputFormat = AVAudioFormat(standardFormatWithSampleRate: format.sampleRate, channels: 1)!
            let clickSource = current.metronome.makeSource(format: outputFormat)
            engine.attach(clickSource)
            engine.connect(clickSource, to: engine.mainMixerNode, format: outputFormat)
            capture = current
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self, weak current] buffer, when in
                guard let current = current, current.isRunning else { return }
                guard when.isSampleTimeValid, buffer.format.commonFormat == .pcmFormatFloat32,
                      let channels = buffer.floatChannelData else {
                    current.cancel()
                    DispatchQueue.main.async { self?.captureFailed(current, message: "Microphone sample timestamps or Float32 input are unavailable. Restart listening.") }
                    return
                }
                do {
                    let packet = try current.stream.process(frameCount: Int(buffer.frameLength), sampleTime: when.sampleTime,
                        sampleRate: buffer.format.sampleRate, channelCount: Int(buffer.format.channelCount)) { channel, frame in
                        buffer.format.isInterleaved ? channels[0][frame * buffer.stride + channel] : channels[channel][frame * buffer.stride]
                    }
                    let hardwareStart = when.isHostTimeValid ? AVAudioTime.seconds(forHostTime: when.hostTime) : nil
                    if let hardwareStart = hardwareStart {
                        current.metronome.anchor(captureTime: Double(packet.startFrame) / format.sampleRate, hostTime: hardwareStart)
                    }
                    // Serialization and bridge delivery occur off the realtime tap. NativeCaptureStream
                    // bounds unacknowledged source audio even if the web view stops consuming events.
                    DispatchQueue.main.async {
                        guard let self = self, self.capture === current, current.isRunning else { return }
                        var event: [String: Any] = [
                            "sessionId": current.stream.sessionId,
                            "time": packet.time,
                            "sampleRate": format.sampleRate,
                            "pcm": ["startFrame": packet.startFrame, "samples": packet.samples],
                            "level": packet.level,
                            "inputGain": packet.inputGain,
                            "diagnostics": packet.diagnostics,
                            "analysis": ["implementation": "forgettime-swift-onset", "version": "1"],
                            "onsets": packet.onsets.map { ["time": $0.time, "strength": $0.strength, "confidence": $0.confidence] },
                            "waveform": packet.waveform.map { ["time": $0.time, "duration": $0.duration, "min": $0.min, "max": $0.max] },
                            "metronomeAvailable": current.metronome.available,
                            "timestampQuality": hardwareStart != nil ? "hardware" : "sample-clock"
                        ]
                        if let hardwareStart = hardwareStart {
                            event["hardwareTime"] = hardwareStart + packet.time - Double(packet.startFrame) / format.sampleRate
                        }
                        self.notifyListeners("audioFrame", data: event)
                    }
                } catch {
                    // Invalidate immediately: a stalled main queue must not accumulate repeated errors.
                    current.cancel()
                    DispatchQueue.main.async { self?.captureFailed(current, message: error.localizedDescription) }
                }
            }
            current.tapInstalled = true
            engine.prepare()
            try engine.start()
            pendingStart = nil
            call.resolve(["sessionId": current.stream.sessionId, "sampleRate": format.sampleRate, "timestampQuality": "sample-clock", "inputGainSupported": true, "diagnosticsSupported": true,
                          "analysis": ["implementation": "forgettime-swift-onset", "version": "1"]])
        } catch {
            pendingStart = nil
            stopCapture(reason: "error")
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            call.reject("Unable to capture microphone audio: \(error.localizedDescription)")
        }
    }

    private func captureFailed(_ current: AudioCaptureSession, message: String) {
        guard capture === current else { return }
        notifyListeners("captureError", data: ["message": message, "sessionId": current.stream.sessionId])
        stopCapture(reason: "error")
    }

    @objc public func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopCapture(reason: "stopped")
            call.resolve()
        }
    }

    @objc public func acknowledgeFrame(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let sessionId = call.getString("sessionId"), let endFrame = call.getInt("endFrame") {
                self.capture?.stream.acknowledge(sessionId: sessionId, endFrame: Int64(endFrame))
            }
            call.resolve()
        }
    }

    @objc public func setMetronome(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let current = self.capture else { call.resolve(); return }
            guard let value = call.getObject("plan") else { current.metronome.update(nil); call.resolve(); return }
            guard let origin = value["origin"] as? Double, let bpm = value["bpm"] as? Double,
                  let fromBeat = value["fromBeat"] as? Int, let untilTime = value["untilTime"] as? Double,
                  origin.isFinite, bpm.isFinite, untilTime.isFinite, bpm >= 30, bpm <= 300, fromBeat >= 1 else {
                current.metronome.update(nil)
                call.reject("Invalid metronome clock.")
                return
            }
            current.metronome.update(.init(origin: origin, bpm: bpm, fromBeat: fromBeat, untilTime: untilTime))
            call.resolve()
        }
    }

    private func stopCapture(reason: String) {
        pendingStart?.reject("Microphone start was cancelled.")
        pendingStart = nil
        guard let current = capture else { return }
        capture = nil
        current.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        notifyListeners("captureStopped", data: ["reason": reason, "sessionId": current.stream.sessionId])
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
        capture?.stop()
        replay?.stop()
    }
}

private final class AudioCaptureSession {
    let engine: AVAudioEngine
    let stream: NativeCaptureStream
    let metronome = MetronomeOutput()
    var tapInstalled = false
    private let lock = NSLock()
    private var running = true
    var isRunning: Bool {
        lock.lock()
        defer { lock.unlock() }
        return running
    }
    init(engine: AVAudioEngine, sampleRate: Double, settings: DetectorSettings) {
        self.engine = engine
        self.stream = NativeCaptureStream(sampleRate: sampleRate, settings: settings)
    }
    func cancel() {
        lock.lock()
        running = false
        lock.unlock()
    }
    func stop() {
        metronome.update(nil)
        cancel()
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
    }
}

private enum CaptureError: LocalizedError {
    case unavailableMicrophone
    var errorDescription: String? { "No microphone input is available." }
}
