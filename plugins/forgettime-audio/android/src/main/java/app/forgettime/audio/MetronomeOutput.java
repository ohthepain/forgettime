package app.forgettime.audio;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTimestamp;
import android.media.AudioTrack;
import android.os.Process;

/** Native PCM output mapped to the microphone's monotonic hardware timestamps. */
final class MetronomeOutput {
    static final class Plan {
        final double origin, bpm, untilTime;
        final int fromBeat;
        Plan(double origin, double bpm, int fromBeat, double untilTime) {
            this.origin = origin; this.bpm = bpm; this.fromBeat = fromBeat; this.untilTime = untilTime;
        }
    }
    private final AudioTrack track;
    private final int rate;
    private final Thread worker;
    private volatile boolean running = true;
    private volatile boolean timestampAvailable = false;
    private volatile double captureHostOrigin = Double.NaN;
    private volatile Plan plan;

    MetronomeOutput(int rate) {
        this.rate = rate;
        int minimum = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (minimum <= 0) throw new IllegalStateException("No metronome output format.");
        track = new AudioTrack.Builder()
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setAudioFormat(new AudioFormat.Builder().setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
            .setBufferSizeInBytes(Math.max(minimum, rate / 20 * 2))
            .setTransferMode(AudioTrack.MODE_STREAM).build();
        worker = new Thread(this::render, "ForgettimeMetronome");
        worker.start();
    }

    void anchor(double captureTime, double hostTime) { captureHostOrigin = hostTime - captureTime; }
    void update(Plan value) { plan = value; }
    boolean available() { return running && timestampAvailable && Double.isFinite(captureHostOrigin); }

    private void render() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
        short[] buffer = new short[rate / 100];
        AudioTimestamp stamp = new AudioTimestamp();
        long written = 0;
        try {
            track.play();
            while (running) {
                boolean valid = track.getTimestamp(stamp) && System.nanoTime() - stamp.nanoTime < 500_000_000L;
                timestampAvailable = valid;
                double anchor = captureHostOrigin;
                Plan current = plan;
                for (int i = 0; i < buffer.length; i++) {
                    double value = 0;
                    if (valid && current != null && Double.isFinite(anchor)) {
                        double time = stamp.nanoTime / 1e9 + (written + i - stamp.framePosition) / (double) rate - anchor;
                        double beat = 60 / current.bpm;
                        long index = (long) Math.floor((time - current.origin) / beat + 1e-9);
                        double age = time - (current.origin + index * beat);
                        if (index >= current.fromBeat && time < current.untilTime && age >= 0 && age < 0.025) {
                            boolean accent = index % 4 == 0;
                            value = (accent ? 0.3 : 0.22) * Math.sin(2 * Math.PI * (accent ? 1500 : 1000) * age)
                                * Math.min(1, age / 0.001) * Math.exp(-age * 180) * Math.min(1, (0.025 - age) / 0.004);
                        }
                    }
                    buffer[i] = (short) Math.round(value * 32767);
                }
                int offset = 0;
                while (running && offset < buffer.length) {
                    int count = track.write(buffer, offset, buffer.length - offset, AudioTrack.WRITE_BLOCKING);
                    if (count <= 0) throw new IllegalStateException("Metronome output stopped.");
                    offset += count;
                    written += count;
                }
            }
        } catch (RuntimeException ignored) {
            // Capture remains usable; frame metadata reports output unavailable.
        } finally {
            running = false;
            timestampAvailable = false;
            try { track.stop(); } catch (RuntimeException ignored) { }
            track.release();
        }
    }

    void stop() {
        plan = null;
        running = false;
        try { track.pause(); track.flush(); } catch (RuntimeException ignored) { }
        if (Thread.currentThread() != worker) {
            try { worker.join(1000); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        }
    }
}
