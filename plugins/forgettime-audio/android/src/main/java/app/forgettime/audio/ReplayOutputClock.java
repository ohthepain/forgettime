package app.forgettime.audio;

/** Extends AudioTrack positions; written/queued samples are never the audible clock. */
public final class ReplayOutputClock {
    private final int sampleRate;
    private final long[] previous = {-1, -1}, wraps = {0, 0};
    private long last = 0;
    public ReplayOutputClock(int sampleRate) { this.sampleRate = sampleRate; }
    public synchronized long position(long raw, long stampNanos, long nowNanos, long written, boolean hardware) {
        int kind = hardware ? 1 : 0;
        long value = raw & 0xffffffffL;
        if (previous[kind] >= 0 && value < previous[kind]) {
            if (previous[kind] - value > 0x80000000L) wraps[kind]++;
            else throw new IllegalStateException("Native replay output clock reset. Play again to restart.");
        }
        previous[kind] = value;
        long extended = value + (wraps[kind] << 32);
        long audible = hardware ? extended + (long) Math.floor((nowNanos - stampNanos) / 1e9 * sampleRate) : extended;
        audible = Math.max(0, Math.min(written, audible));
        if (audible < last) throw new IllegalStateException("Native replay output clock regressed. Play again to restart.");
        last = audible;
        return audible;
    }
}
