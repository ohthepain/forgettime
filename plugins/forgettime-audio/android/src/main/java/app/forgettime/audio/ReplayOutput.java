package app.forgettime.audio;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTimestamp;
import android.media.AudioTrack;
import android.os.Process;

/** Foreground-only float PCM playback; detector reads the unmodified same source. */
final class ReplayOutput {
    static final class Plan {
        final double origin, bpm, untilTime;
        final int fromBeat;
        Plan(double origin, double bpm, int fromBeat, double untilTime) {
            this.origin = origin; this.bpm = bpm; this.fromBeat = fromBeat; this.untilTime = untilTime;
        }
    }
    final NativeReplayStream stream;
    private final AudioTrack track;
    private final AudioManager manager;
    private final AudioManager.OnAudioFocusChangeListener focus;
    private final Thread worker;
    private final ReplayOutputClock clock;
    private final AudioTimestamp timestamp = new AudioTimestamp();
    private volatile boolean running = true;
    private volatile String failure;
    private volatile long written = 0;
    private volatile long lastRead = System.nanoTime();
    private volatile Plan plan;
    private long lastTimestampQuery = 0;
    private boolean hardware = false;
    private long lastAudible = 0, lastProgress = System.nanoTime();
    private int routeId = 0;

    ReplayOutput(float[] samples, int rate, DrumOnsetDetector.Settings settings, double frequencyBalance, AudioManager manager) {
        this.stream = new NativeReplayStream(samples, rate, settings, frequencyBalance);
        this.clock = new ReplayOutputClock(rate);
        this.manager = manager;
        int minimum = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT);
        if (minimum <= 0) throw new IllegalStateException("This device does not support the selected replay sample rate.");
        track = new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setAudioFormat(new AudioFormat.Builder().setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .setEncoding(AudioFormat.ENCODING_PCM_FLOAT).build())
            .setTransferMode(AudioTrack.MODE_STREAM).setBufferSizeInBytes(Math.max(minimum, rate / 20 * 4)).build();
        if (track.getState() != AudioTrack.STATE_INITIALIZED || track.getSampleRate() != rate) {
            track.release(); throw new IllegalStateException("Native replay output format is unavailable.");
        }
        worker = new Thread(this::render, "ForgettimeReplay");
        focus = change -> { if (change <= 0) stop("Audio output interrupted. Play again to restart."); };
        if (manager == null || manager.requestAudioFocus(focus, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            track.release(); throw new IllegalStateException("Audio output focus was denied. Play again to restart.");
        }
        worker.start();
    }
    void setPlan(Plan value) { plan = value; }
    boolean running() { return running; }
    String failure() { return failure; }
    String clockQuality() { return hardware ? "hardware" : "estimated"; }

    synchronized NativeReplayStream.Frame read() {
        if (!running) throw new IllegalStateException(failure == null ? "Playback stopped." : failure);
        long now = System.nanoTime();
        lastRead = now;
        // Warm-up probing, then infrequent timestamp refresh per AudioTrack guidance.
        if (now - lastTimestampQuery >= (hardware ? 10_000_000_000L : 100_000_000L)) {
            lastTimestampQuery = now;
            AudioTimestamp fresh = new AudioTimestamp();
            if (track.getTimestamp(fresh) && fresh.nanoTime > 0) {
                timestamp.framePosition = fresh.framePosition; timestamp.nanoTime = fresh.nanoTime; hardware = true;
            } else if (hardware) throw new IllegalStateException("Native replay hardware clock became unavailable.");
        }
        long audible = hardware
            ? clock.position(timestamp.framePosition, timestamp.nanoTime, now, written, true)
            : clock.position(Integer.toUnsignedLong(track.getPlaybackHeadPosition()), 0, now, written, false);
        if (audible > lastAudible) { lastAudible = audible; lastProgress = now; }
        else if (now - lastProgress > 1_000_000_000L) throw new IllegalStateException("Native replay output clock stalled.");
        return stream.read(audible);
    }
    private void fill(float[] buffer) {
        stream.copyOutput(written, buffer, buffer.length);
        Plan current = plan;
        if (current == null) return;
        // Click synthesis is separate from the immutable PCM analyzed by the detector.
        for (int i = 0; i < buffer.length; i++) {
            double time = (written + i) / (double) stream.sampleRate, beat = 60 / current.bpm;
            long index = (long) Math.floor((time - current.origin) / beat + 1e-9);
            double age = time - (current.origin + index * beat);
            if (index >= current.fromBeat && time < current.untilTime && age >= 0 && age < 0.025) {
                boolean accent = index % 4 == 0;
                buffer[i] += (float) ((accent ? 0.3 : 0.22) * Math.sin(2 * Math.PI * (accent ? 1500 : 1000) * age)
                    * Math.min(1, age / 0.001) * Math.exp(-age * 180) * Math.min(1, (0.025 - age) / 0.004));
            }
        }
    }
    private void write(float[] buffer) {
        int offset = 0;
        while (running && offset < buffer.length) {
            int count = track.write(buffer, offset, buffer.length - offset, AudioTrack.WRITE_BLOCKING);
            if (count <= 0) throw new IllegalStateException("Native replay output stopped accepting samples.");
            offset += count; written += count;
        }
    }
    private void render() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
        try {
            float[] initial = new float[track.getBufferSizeInFrames()];
            fill(initial); write(initial);
            if (!running) return;
            track.play();
            int underruns = track.getUnderrunCount();
            float[] buffer = new float[Math.max(32, stream.sampleRate / 100)];
            while (running) {
                if (System.nanoTime() - lastRead > 2_000_000_000L) throw new IllegalStateException("Native replay analysis could not keep up. Play again to restart.");
                if (track.getPlayState() != AudioTrack.PLAYSTATE_PLAYING || track.getUnderrunCount() > underruns)
                    throw new IllegalStateException("Native replay output was interrupted.");
                var route = track.getRoutedDevice();
                if (route != null) {
                    if (routeId != 0 && routeId != route.getId()) throw new IllegalStateException("Audio output route changed. Play again to restart.");
                    routeId = route.getId();
                }
                fill(buffer); write(buffer);
            }
        } catch (RuntimeException error) {
            if (running) failure = error.getMessage();
        } finally {
            running = false; plan = null;
            try { track.pause(); track.flush(); track.stop(); } catch (RuntimeException ignored) { }
            track.release();
            manager.abandonAudioFocus(focus);
        }
    }
    void stop(String reason) {
        if (reason != null && failure == null) failure = reason;
        running = false; plan = null;
        try { track.pause(); track.flush(); } catch (RuntimeException ignored) { }
        if (Thread.currentThread() != worker) {
            try { worker.join(1000); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        }
    }
}
