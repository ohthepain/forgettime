import AVFoundation
import Foundation

/// Render the click against the input's hardware clock, never bridge arrival time.
final class MetronomeOutput {
    struct Plan {
        let origin: Double
        let bpm: Double
        let fromBeat: Int
        let untilTime: Double
    }
    private let lock = NSLock()
    private var plan: Plan?
    private var captureHostOrigin: Double?
    private var rendered = false

    var available: Bool {
        lock.lock(); defer { lock.unlock() }
        return captureHostOrigin != nil && rendered
    }

    func anchor(captureTime: Double, hostTime: Double) {
        lock.lock(); defer { lock.unlock() }
        captureHostOrigin = hostTime - captureTime
    }

    func update(_ value: Plan?) {
        lock.lock(); defer { lock.unlock() }
        plan = value
    }

    func makeSource(format: AVAudioFormat) -> AVAudioSourceNode {
        let rate = format.sampleRate
        return AVAudioSourceNode(format: format) { [weak self] _, timestamp, frameCount, audioBufferList -> OSStatus in
            let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
            guard let self = self else {
                for buffer in buffers {
                    buffer.mData?.initializeMemory(as: UInt8.self, repeating: 0, count: Int(buffer.mDataByteSize))
                }
                return noErr
            }
            self.lock.lock()
            let plan = self.plan
            let anchor = self.captureHostOrigin
            self.rendered = timestamp.pointee.mHostTime != 0
            self.lock.unlock()
            let host = AVAudioTime.seconds(forHostTime: timestamp.pointee.mHostTime)
            for buffer in buffers {
                guard let data = buffer.mData?.assumingMemoryBound(to: Float.self) else { continue }
                for i in 0..<Int(frameCount) {
                    var value = 0.0
                    if timestamp.pointee.mHostTime != 0, let plan = plan, let anchor = anchor {
                        let time = host + Double(i) / rate - anchor
                        let beat = 60 / plan.bpm
                        let index = Int(floor((time - plan.origin) / beat + 1e-9))
                        let age = time - (plan.origin + Double(index) * beat)
                        if index >= plan.fromBeat && time < plan.untilTime && age >= 0 && age < 0.025 {
                            let accent = index % 4 == 0
                            value = (accent ? 0.3 : 0.22) * sin(2 * .pi * (accent ? 1500 : 1000) * age)
                                * min(1, age / 0.001) * exp(-age * 180) * min(1, (0.025 - age) / 0.004)
                        }
                    }
                    data[i] = Float(value)
                }
            }
            return noErr
        }
    }
}
