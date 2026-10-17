import app.forgettime.audio.DrumOnsetDetector;
import app.forgettime.audio.NativeReplayStream;
import app.forgettime.audio.ReplayOutputClock;

/** Host-only native contracts; synthetic PCM never establishes audible/device accuracy. */
public class AndroidReplayRunner {
    public static void main(String[] args) throws Exception {
        if (args.length > 0) { replayFile(args); return; }
        var detector = new DrumOnsetDetector(48000, new DrumOnsetDetector.Settings(1, 0.1, 4, 100, 12));
        for (int i = 0; i < 48000; i++) {
            double sample = i >= 4800 && i < 5056 ? (i % 2 == 0 ? 0.04 : -0.04) * Math.exp(-(i - 4800) / 100.0) : 0;
            if (detector.process(sample, i / 48000.0) != null) throw new AssertionError("High native threshold must reject quiet source");
        }
        var diagnostics = detector.drainDiagnostics();
        if (diagnostics.candidates.isEmpty()) throw new AssertionError("Actual rejected attacks must have native diagnostics");
        if (!diagnostics.candidates.get(0).toString().contains("level")) throw new AssertionError("Native rejection must explain level threshold");
        if (!detector.drainDiagnostics().candidates.isEmpty()) throw new AssertionError("Diagnostics are incremental");
        float[] source = new float[96000]; source[0] = -0.125f; source[500] = 0.5f;
        var replay = new NativeReplayStream(source, 48000, new DrumOnsetDetector.Settings());
        source[0] = 0;
        float[] output = new float[1000]; replay.copyOutput(95999, output, output.length);
        if (output[1] != -0.125f || output[501] != 0.5f) throw new AssertionError("Output must loop the immutable original PCM");
        var frame = replay.read(48000);
        if (frame.audibleFrame != 48000 || frame.analyzedThroughFrame > 48000) throw new AssertionError("Native analysis cannot lead audible source time");
        boolean failed = false;
        try { replay.read(144001); } catch (IllegalStateException expected) { failed = true; }
        if (!failed) throw new AssertionError("Catch-up is bounded without silently skipping source");
        failed = false;
        try { replay.read(47999); } catch (IllegalStateException expected) { failed = true; }
        if (!failed) throw new AssertionError("Regressed output time cannot join false continuity");
        var clock = new ReplayOutputClock(48000);
        if (clock.position(4800, 1000000000L, 1050000000L, 12000, true) != 7200)
            throw new AssertionError("Hardware frame/time mapping must subtract queued-ahead output");
        if (clock.position(7200, 1060000000L, 1060000000L, 12000, true) != 7200)
            throw new AssertionError("Queued count is not audible playback");
        var wrapping = new ReplayOutputClock(48000);
        wrapping.position(4294967290L, 0, 0, 4294967400L, false);
        if (wrapping.position(5, 0, 0, 4294967400L, false) != 4294967301L)
            throw new AssertionError("AudioTrack 32-bit position must extend monotonically");
        var capped = new DrumOnsetDetector(48000);
        var inspected = new DrumOnsetDetector(48000);
        int cappedHits = 0, inspectedHits = 0, candidates = 0;
        for (int i = 0; i < 12 * 48000; i++) {
            double sample = i / 128 % 2 == 0 ? 0 : (i % 2 == 0 ? 0.1f : -0.1f);
            if (capped.process(sample, i / 48000.0) != null) cappedHits++;
            if (inspected.process(sample, i / 48000.0) != null) inspectedHits++;
            if (i % 997 == 996) candidates += inspected.drainDiagnostics().candidates.size();
        }
        candidates += inspected.drainDiagnostics().candidates.size();
        var retained = capped.drainDiagnostics();
        if (cappedHits != inspectedHits || retained.candidates.size() != 2048 || retained.dropped != candidates - 2048 || retained.dropped <= 0)
            throw new AssertionError("Diagnostic cap/drain must preserve native detections and disclose omitted attempts");
        var live = new DrumOnsetDetector(48000);
        int liveHits = 0;
        for (int i = 0; i < 72000; i++) {
            if (i == 24000) live.configure(new DrumOnsetDetector.Settings(1, 0.1, 4, 100, 12));
            if (i == 48000) live.configure(new DrumOnsetDetector.Settings());
            int within = i % 24000 - 4800;
            double sample = within >= 0 && within < 256 ? (i % 2 == 0 ? 0.04 : -0.04) * Math.exp(-within / 100.0) : 0;
            if (live.process(sample, i / 48000.0) != null) liveHits++;
        }
        if (liveHits != 2 || live.getProcessedThrough() < 1.49) throw new AssertionError("Live settings apply without resetting sample history");
        System.out.println("Native configured detector, loop source and output clock contracts passed");
    }
    private static void replayFile(String[] args) throws Exception {
        java.nio.ByteBuffer bytes = java.nio.ByteBuffer.wrap(java.nio.file.Files.readAllBytes(java.nio.file.Path.of(args[0]))).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        float[] samples = new float[bytes.remaining() / 4]; for (int i = 0; i < samples.length; i++) samples[i] = bytes.getFloat();
        int rate = Integer.parseInt(args[1]), step = Integer.parseInt(args[6]), loops = Integer.parseInt(args[7]);
        var stream = new NativeReplayStream(samples, rate, new DrumOnsetDetector.Settings(1, Double.parseDouble(args[2]), Double.parseDouble(args[3]), Double.parseDouble(args[4]), Double.parseDouble(args[5])), args.length > 8 ? Double.parseDouble(args[8]) : 0);
        long end = (long) samples.length * loops;
        for (long cursor = 0; cursor < end;) {
            cursor = Math.min(end, cursor + step);
            var frame = stream.read(cursor);
            java.util.List<Object> onsets = new java.util.ArrayList<>();
            for (var hit : frame.onsets) onsets.add(DrumOnsetDetector.map("time", hit.time, "strength", hit.strength, "confidence", hit.confidence));
            System.out.println(json(DrumOnsetDetector.map("sessionId", "host-fixture", "sampleRate", rate, "status", "playing", "clockQuality", "estimated",
                "audibleFrame", frame.audibleFrame, "analyzedThroughFrame", frame.analyzedThroughFrame, "onsets", onsets, "diagnostics", frame.diagnostics.toMap())));
        }
    }
    private static String json(Object value) {
        if (value == null) return "null";
        if (value instanceof String) return "\"" + ((String) value).replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
        if (value instanceof java.util.Map<?, ?>) {
            var fields = new java.util.ArrayList<String>();
            for (var entry : ((java.util.Map<?, ?>) value).entrySet()) fields.add(json(entry.getKey()) + ":" + json(entry.getValue()));
            return "{" + String.join(",", fields) + "}";
        }
        if (value instanceof java.util.List<?>) {
            var fields = new java.util.ArrayList<String>();
            for (var element : (java.util.List<?>) value) fields.add(json(element));
            return "[" + String.join(",", fields) + "]";
        }
        return value.toString();
    }

}
