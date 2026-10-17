package app.forgettime.audio;

import java.util.ArrayList;
import java.util.List;

/** Immutable selected PCM, looped output and continuous native analysis on source frames. */
public final class NativeReplayStream {
    public static final class Frame {
        public final long audibleFrame, analyzedThroughFrame;
        public final List<DrumOnsetDetector.Onset> onsets;
        public final DrumOnsetDetector.Diagnostics diagnostics;
        Frame(long audible, long analyzed, List<DrumOnsetDetector.Onset> onsets, DrumOnsetDetector.Diagnostics diagnostics) {
            audibleFrame = audible; analyzedThroughFrame = analyzed; this.onsets = onsets; this.diagnostics = diagnostics;
        }
    }
    private final float[] samples;
    public final int sampleRate;
    private final DrumOnsetDetector detector;
    private long cursor = 0;
    public NativeReplayStream(float[] source, int sampleRate, DrumOnsetDetector.Settings settings) { this(source, sampleRate, settings, 0); }
    public NativeReplayStream(float[] source, int sampleRate, DrumOnsetDetector.Settings settings, double frequencyBalance) {
        if (sampleRate < 8000 || sampleRate > 192000 || source.length < 1 || source.length > Math.min(8 * sampleRate, 1536000))
            throw new IllegalArgumentException("Unsupported native replay format or size.");
        for (float value : source) if (!Float.isFinite(value)) throw new IllegalArgumentException("Replay samples must be finite.");
        this.samples = source.clone();
        this.sampleRate = sampleRate;
        this.detector = new DrumOnsetDetector(sampleRate, settings, frequencyBalance);
    }
    public int frameCount() { return samples.length; }
    /** AudioTrack receives this exact source before separate metronome synthesis. */
    public void copyOutput(long startFrame, float[] output, int count) {
        if (startFrame < 0 || count < 0 || count > output.length) throw new IllegalArgumentException("Invalid output frame range.");
        for (int i = 0; i < count; i++) output[i] = samples[(int) ((startFrame + i) % samples.length)];
    }
    public synchronized Frame read(long audibleFrame) {
        if (audibleFrame < cursor || audibleFrame - cursor > 2L * sampleRate)
            throw new IllegalStateException("Native replay output clock interrupted or analysis could not keep up. Play again to restart.");
        List<DrumOnsetDetector.Onset> onsets = new ArrayList<>();
        while (cursor < audibleFrame) {
            var onset = detector.process(samples[(int) (cursor % samples.length)], cursor / (double) sampleRate);
            cursor++;
            if (onset != null) {
                if (onsets.size() >= 2048) throw new IllegalStateException("Native replay attack limit reached.");
                onsets.add(onset);
            }
        }
        return new Frame(audibleFrame, Math.round(detector.getProcessedThrough() * sampleRate), onsets, detector.drainDiagnostics());
    }
}
