package app.forgettime.audio;

import java.util.ArrayList;
import java.util.List;

/** Source PCM and native analysis share one monotonically advancing sample clock. */
public final class NativeCaptureStream {
    public static final class Batch {
        public final long startFrame;
        public final double[] samples;
        public final List<DrumOnsetDetector.Onset> onsets = new ArrayList<>();
        public final List<WaveformEnvelopeCapture.Point> waveform = new ArrayList<>();
        public double time;
        public double level;
        Batch(long startFrame, int count) { this.startFrame = startFrame; this.samples = new double[count]; }
    }
    private final int sampleRate;
    private final DrumOnsetDetector detector;
    private final WaveformEnvelopeCapture waveform;
    private long frame;
    private long acknowledgedFrame;

    public NativeCaptureStream(int sampleRate) {
        this.sampleRate = sampleRate;
        detector = new DrumOnsetDetector(sampleRate);
        waveform = new WaveformEnvelopeCapture(sampleRate);
    }
    public synchronized Batch process(short[] input, int count) {
        if (count <= 0 || count > input.length || count > sampleRate / 50) {
            throw new IllegalArgumentException("Invalid microphone PCM batch.");
        }
        // Bound Capacitor's pending event queue even when JavaScript stops consuming it.
        if (frame + count - acknowledgedFrame > sampleRate / 2) {
            throw new IllegalStateException("Audio review is not keeping up; recording stopped. Restart listening.");
        }
        Batch batch = new Batch(frame, count);
        double energy = 0;
        for (int i = 0; i < count; i++) {
            double sample = input[i] / 32768.0;
            batch.samples[i] = sample;
            energy += sample * sample;
            double time = (frame + i) / (double) sampleRate;
            WaveformEnvelopeCapture.Point point = waveform.process(sample, time);
            if (point != null) batch.waveform.add(point);
            DrumOnsetDetector.Onset onset = detector.process(sample, time);
            if (onset != null) batch.onsets.add(onset);
        }
        frame += count;
        batch.time = detector.getProcessedThrough();
        batch.level = Math.min(1, Math.sqrt(energy / count));
        return batch;
    }
    public synchronized void acknowledge(long endFrame) {
        if (endFrame > acknowledgedFrame && endFrame <= frame) acknowledgedFrame = endFrame;
    }
}
