package app.forgettime.audio;

import android.Manifest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTimestamp;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.AudioEffect;
import android.media.audiofx.AutomaticGainControl;
import android.media.audiofx.NoiseSuppressor;
import android.os.Process;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@CapacitorPlugin(name = "ForgettimeAudio", permissions = {
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public class ForgettimeAudioPlugin extends Plugin {
    private volatile Session session;
    private PluginCall pendingStart;

    @PluginMethod
    public synchronized void start(PluginCall call) {
        if (session != null || pendingStart != null) {
            call.reject("Microphone capture is already starting or running.");
            return;
        }
        pendingStart = call;
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionResult");
        } else {
            begin(call);
        }
    }

    @PermissionCallback
    private synchronized void microphonePermissionResult(PluginCall call) {
        if (pendingStart != call) return; // stop/background invalidated this request.
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            pendingStart = null;
            call.reject("Microphone permission was denied. Enable it in Android app settings to listen.");
            return;
        }
        begin(call);
    }

    private synchronized void begin(PluginCall call) {
        if (pendingStart != call) return;
        AudioRecord record = null;
        try {
            AudioManager manager = (AudioManager) getContext().getSystemService(android.content.Context.AUDIO_SERVICE);
            boolean unprocessed = manager != null && "true".equals(manager.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED));
            int input = unprocessed ? MediaRecorder.AudioSource.UNPROCESSED : MediaRecorder.AudioSource.VOICE_RECOGNITION;
            int rate = 48000;
            for (int candidate : new int[] {48000, 44100}) {
                int minimum = AudioRecord.getMinBufferSize(candidate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                if (minimum <= 0) continue;
                record = new AudioRecord(input, candidate, AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum * 4, candidate / 5 * 2));
                if (record.getState() == AudioRecord.STATE_INITIALIZED) { rate = candidate; break; }
                record.release();
                record = null;
            }
            if (record == null) throw new IllegalStateException("No supported microphone capture format.");
            Session capture = new Session(record, rate);
            disableEffects(capture);
            record.startRecording();
            if (record.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                throw new IllegalStateException("The microphone could not start.");
            }
            try { capture.metronome = new MetronomeOutput(rate); } catch (RuntimeException ignored) { }
            session = capture;
            pendingStart = null;
            JSObject result = new JSObject();
            result.put("sampleRate", rate);
            result.put("sessionId", capture.id);
            result.put("timestampQuality", "sample-clock");
            call.resolve(result);
            capture.worker = new Thread(() -> readAudio(capture), "ForgettimeAudioCapture");
            capture.worker.start();
        } catch (Exception error) {
            pendingStart = null;
            if (record != null) record.release();
            call.reject("Unable to capture microphone audio: " + error.getMessage(), error);
        }
    }

    private void disableEffects(Session capture) {
        try {
            int id = capture.record.getAudioSessionId();
            if (AutomaticGainControl.isAvailable()) capture.effects.add(AutomaticGainControl.create(id));
            if (NoiseSuppressor.isAvailable()) capture.effects.add(NoiseSuppressor.create(id));
            if (AcousticEchoCanceler.isAvailable()) capture.effects.add(AcousticEchoCanceler.create(id));
            for (AudioEffect effect : capture.effects) if (effect != null) effect.setEnabled(false);
        } catch (RuntimeException ignored) {
            // Some devices deny effect control; this is documented as a capture limitation.
        }
    }

    private void readAudio(Session capture) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
        short[] buffer = new short[capture.sampleRate / 50];
        AudioTimestamp stamp = new AudioTimestamp();
        long frame = 0;
        long previousRead = System.nanoTime();
        int routeId = 0;
        try {
            while (capture.running) {
                int count = capture.record.read(buffer, 0, buffer.length, AudioRecord.READ_BLOCKING);
                if (!capture.running) break;
                if (count <= 0) throw new IllegalStateException("AudioRecord stopped delivering samples (" + count + ").");
                long now = System.nanoTime();
                // Never silently concatenate audio after a capture-thread stall/possible overrun.
                if (frame > 0 && (now - previousRead) / 1e9 > capture.record.getBufferSizeInFrames() / (double) capture.sampleRate) {
                    throw new IllegalStateException("Audio capture was interrupted; restart listening for a fresh timing reference.");
                }
                previousRead = now;
                android.media.AudioDeviceInfo route = capture.record.getRoutedDevice();
                if (route != null) {
                    if (routeId != 0 && routeId != route.getId()) throw new IllegalStateException("Microphone route changed; restart listening.");
                    routeId = route.getId();
                }
                if (capture.record.getSampleRate() != capture.sampleRate) {
                    throw new IllegalStateException("Microphone sample rate changed; restart listening.");
                }
                NativeCaptureStream.Batch batch = capture.stream.process(buffer, count);
                JSArray onsets = new JSArray();
                for (DrumOnsetDetector.Onset onset : batch.onsets) {
                    JSObject hit = new JSObject();
                    hit.put("time", onset.time);
                    hit.put("strength", onset.strength);
                    hit.put("confidence", onset.confidence);
                    onsets.put(hit);
                }
                JSArray waveform = new JSArray();
                for (WaveformEnvelopeCapture.Point point : batch.waveform) {
                    JSObject envelope = new JSObject();
                    envelope.put("time", point.time);
                    envelope.put("duration", point.duration);
                    envelope.put("min", point.min);
                    envelope.put("max", point.max);
                    waveform.put(envelope);
                }
                JSArray samples = new JSArray();
                for (double sample : batch.samples) samples.put(sample);
                JSObject pcm = new JSObject();
                pcm.put("startFrame", batch.startFrame);
                pcm.put("samples", samples);
                frame += count;
                double analyzedTime = batch.time;
                JSObject event = new JSObject();
                event.put("sessionId", capture.id);
                event.put("pcm", pcm);
                event.put("time", analyzedTime);
                event.put("sampleRate", capture.sampleRate);
                event.put("level", batch.level);
                event.put("onsets", onsets);
                event.put("waveform", waveform);
                if (capture.record.getTimestamp(stamp, AudioTimestamp.TIMEBASE_MONOTONIC) == AudioRecord.SUCCESS) {
                    event.put("timestampQuality", "hardware");
                    event.put("hardwareTime", stamp.nanoTime / 1e9 + analyzedTime - stamp.framePosition / (double) capture.sampleRate);
                    if (capture.metronome != null) capture.metronome.anchor(stamp.framePosition / (double) capture.sampleRate, stamp.nanoTime / 1e9);
                } else {
                    event.put("timestampQuality", "sample-clock");
                }
                event.put("metronomeAvailable", capture.metronome != null && capture.metronome.available());
                if (capture.running && session == capture) notifyListeners("audioFrame", event);
            }
        } catch (Exception error) {
            if (capture.running && session == capture) {
                JSObject event = new JSObject();
                event.put("message", error.getMessage());
                event.put("sessionId", capture.id);
                notifyListeners("captureError", event);
            }
        } finally {
            capture.running = false;
            if (capture.metronome != null) capture.metronome.stop();
            try { capture.record.stop(); } catch (RuntimeException ignored) { }
            capture.record.release();
            for (AudioEffect effect : capture.effects) if (effect != null) effect.release();
            synchronized (this) { if (session == capture) session = null; }
        }
    }

    @PluginMethod
    public void acknowledgeFrame(PluginCall call) {
        Session capture = session;
        if (capture != null && capture.id.equals(call.getString("sessionId"))) {
            Double endFrame = call.getDouble("endFrame");
            if (endFrame != null && Double.isFinite(endFrame) && endFrame >= 0 && endFrame == Math.floor(endFrame)) {
                capture.stream.acknowledge(endFrame.longValue());
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void setMetronome(PluginCall call) {
        Session capture = session;
        if (capture == null || capture.metronome == null) { call.resolve(); return; }
        JSObject value = call.getObject("plan");
        if (value == null) { capture.metronome.update(null); call.resolve(); return; }
        double origin = value.optDouble("origin", Double.NaN);
        double bpm = value.optDouble("bpm", Double.NaN);
        double untilTime = value.optDouble("untilTime", Double.NaN);
        int fromBeat = value.optInt("fromBeat", -1);
        if (!Double.isFinite(origin) || !Double.isFinite(bpm) || !Double.isFinite(untilTime) || bpm < 30 || bpm > 300 || fromBeat < 1) {
            capture.metronome.update(null);
            call.reject("Invalid metronome clock.");
            return;
        }
        capture.metronome.update(new MetronomeOutput.Plan(origin, bpm, fromBeat, untilTime));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopCapture("stopped");
        call.resolve();
    }

    private void stopCapture(String reason) {
        Session capture;
        synchronized (this) {
            if (pendingStart != null) {
                pendingStart.reject("Microphone start was cancelled.");
                pendingStart = null;
            }
            capture = session;
            if (capture != null) capture.running = false;
            session = null;
        }
        if (capture != null) {
            if (capture.metronome != null) capture.metronome.update(null);
            try { capture.record.stop(); } catch (RuntimeException ignored) { }
            if (capture.worker != null && capture.worker != Thread.currentThread()) {
                try { capture.worker.join(1000); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            }
            JSObject event = new JSObject();
            event.put("reason", reason);
            event.put("sessionId", capture.id);
            notifyListeners("captureStopped", event);
        }
    }

    @Override protected void handleOnPause() {
        // A runtime permission prompt can pause Activity; do not cancel its pending request.
        if (session != null) stopCapture("background");
    }
    @Override protected void handleOnStop() { stopCapture("background"); }
    @Override protected void handleOnDestroy() { stopCapture("destroyed"); }

    private static class Session {
        final AudioRecord record;
        final int sampleRate;
        final String id = UUID.randomUUID().toString();
        final NativeCaptureStream stream;
        MetronomeOutput metronome;
        final List<AudioEffect> effects = new ArrayList<>();
        volatile boolean running = true;
        Thread worker;
        Session(AudioRecord record, int sampleRate) {
            this.record = record;
            this.sampleRate = sampleRate;
            this.stream = new NativeCaptureStream(sampleRate);
        }
    }
}
