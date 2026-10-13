package app.forgettime.audio;

/** Min/max captured PCM windows for display, not normalized or stored audio. */
public final class WaveformEnvelopeCapture {
    public static final class Point {
        public final double time, duration, min, max;
        Point(double time, double duration, double min, double max) {
            this.time = time; this.duration = duration; this.min = min; this.max = max;
        }
    }
    private final int size;
    private final double sampleRate;
    private int count = 0;
    private double start = 0, min = Double.POSITIVE_INFINITY, max = Double.NEGATIVE_INFINITY;
    public WaveformEnvelopeCapture(double sampleRate) {
        this.sampleRate = sampleRate;
        this.size = Math.max(1, (int) Math.round(sampleRate * 0.002));
    }
    public Point process(double sample, double time) {
        if (count == 0) start = time;
        double value = Double.isFinite(sample) ? sample : 0;
        min = Math.min(min, value);
        max = Math.max(max, value);
        if (++count < size) return null;
        Point point = new Point(start, size / sampleRate, min, max);
        count = 0; min = Double.POSITIVE_INFINITY; max = Double.NEGATIVE_INFINITY;
        return point;
    }
}
