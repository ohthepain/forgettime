import Foundation
import AVFoundation
import UIKit
import Capacitor

@objc(ForgettimeAudioPlugin)
public final class ForgettimeAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ForgettimeAudioPlugin"
    public let jsName = "ForgettimeAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMetronome", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]
    private var capture: AudioCaptureSession?
    private var pendingStart: CAPPluginCall?
    private var observers: [NSObjectProtocol] = []

    public override func load() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.stopCapture(reason: "background")
        })
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] event in
            guard let type = event.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  type == AVAudioSession.InterruptionType.began.rawValue else { return }
            self?.stopCapture(reason: "audio-interrupted")
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] event in
            guard let value = event.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  let reason = AVAudioSession.RouteChangeReason(rawValue: value),
                  [.oldDeviceUnavailable, .newDeviceAvailable, .noSuitableRouteForCategory].contains(reason) else { return }
            self?.stopCapture(reason: "microphone-route-changed")
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            self?.stopCapture(reason: "audio-service-reset")
        })
    }

    @objc public func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.capture == nil, self.pendingStart == nil else {
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
            let current = AudioCaptureSession(engine: engine, sampleRate: format.sampleRate)
            let outputFormat = AVAudioFormat(standardFormatWithSampleRate: format.sampleRate, channels: 1)!
            let clickSource = current.metronome.makeSource(format: outputFormat)
            engine.attach(clickSource)
            engine.connect(clickSource, to: engine.mainMixerNode, format: outputFormat)
            capture = current
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self, weak current] buffer, when in
                guard let current = current, current.isRunning else { return }
                guard when.isSampleTimeValid, let samples = buffer.floatChannelData?[0] else {
                    DispatchQueue.main.async { self?.captureFailed(current, message: "Microphone sample timestamps are unavailable. Restart listening.") }
                    return
                }
                let startFrame = when.sampleTime
                if let expected = current.nextSample, expected != startFrame {
                    DispatchQueue.main.async { self?.captureFailed(current, message: "Audio capture was interrupted. Restart listening for a fresh reference.") }
                    return
                }
                if current.originSample == nil { current.originSample = startFrame }
                let relativeFrame = startFrame - (current.originSample ?? startFrame)
                if when.isHostTimeValid {
                    current.metronome.anchor(captureTime: Double(relativeFrame) / format.sampleRate,
                        hostTime: AVAudioTime.seconds(forHostTime: when.hostTime))
                }
                let count = Int(buffer.frameLength)
                current.nextSample = startFrame + AVAudioFramePosition(count)
                var energy = 0.0
                var onsets: [[String: Any]] = []
                var waveform: [[String: Any]] = []
                for i in 0..<count {
                    let sample = Double(samples[i])
                    energy += sample * sample
                    if let point = current.waveform.process(sample: sample, time: Double(relativeFrame + Int64(i)) / format.sampleRate) {
                        waveform.append(["time": point.time, "duration": point.duration, "min": point.min, "max": point.max])
                    }
                    if let onset = current.detector.process(sample: sample, time: Double(relativeFrame + Int64(i)) / format.sampleRate) {
                        onsets.append(["time": onset.time, "strength": onset.strength, "confidence": onset.confidence])
                    }
                }
                var event: [String: Any] = [
                    "time": current.detector.processedThrough,
                    "sampleRate": format.sampleRate,
                    "level": min(1, sqrt(energy / Double(max(1, count)))),
                    "onsets": onsets,
                    "waveform": waveform,
                    "metronomeAvailable": current.metronome.available,
                    "timestampQuality": when.isHostTimeValid ? "hardware" : "sample-clock"
                ]
                if when.isHostTimeValid {
                    event["hardwareTime"] = AVAudioTime.seconds(forHostTime: when.hostTime)
                        + current.detector.processedThrough - Double(relativeFrame) / format.sampleRate
                }
                DispatchQueue.main.async {
                    guard let self = self, self.capture === current, current.isRunning else { return }
                    self.notifyListeners("audioFrame", data: event)
                }
            }
            current.tapInstalled = true
            engine.prepare()
            try engine.start()
            pendingStart = nil
            call.resolve(["sampleRate": format.sampleRate, "timestampQuality": "sample-clock"])
        } catch {
            pendingStart = nil
            stopCapture(reason: "error")
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            call.reject("Unable to capture microphone audio: \(error.localizedDescription)")
        }
    }

    private func captureFailed(_ current: AudioCaptureSession, message: String) {
        guard capture === current else { return }
        notifyListeners("captureError", data: ["message": message])
        stopCapture(reason: "error")
    }

    @objc public func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopCapture(reason: "stopped")
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
        notifyListeners("captureStopped", data: ["reason": reason])
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
        capture?.stop()
    }
}

private final class AudioCaptureSession {
    let engine: AVAudioEngine
    let detector: DrumOnsetDetector
    let waveform: WaveformEnvelopeCapture
    let metronome = MetronomeOutput()
    var originSample: AVAudioFramePosition?
    var nextSample: AVAudioFramePosition?
    var tapInstalled = false
    private let lock = NSLock()
    private var running = true
    var isRunning: Bool {
        lock.lock()
        defer { lock.unlock() }
        return running
    }
    init(engine: AVAudioEngine, sampleRate: Double) {
        self.engine = engine
        self.detector = DrumOnsetDetector(sampleRate: sampleRate)
        self.waveform = WaveformEnvelopeCapture(sampleRate: sampleRate)
    }
    func stop() {
        metronome.update(nil)
        lock.lock()
        running = false
        lock.unlock()
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
    }
}

private enum CaptureError: LocalizedError {
    case unavailableMicrophone
    var errorDescription: String? { "No microphone input is available." }
}
