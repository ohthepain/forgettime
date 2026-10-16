import app.forgettime.audio.NativeCaptureStream;

/** Host contract checks; no Android microphone or acoustic accuracy claims. */
public class AndroidCaptureRunner {
    public static void main(String[] args) {
        if (args.length > 0) { fixture(Integer.parseInt(args[0])); return; }
        NativeCaptureStream capture = new NativeCaptureStream(48000);
        short[] input = {Short.MIN_VALUE, -16384, 0, 16384, Short.MAX_VALUE};
        NativeCaptureStream.Batch batch = capture.process(input, input.length);
        require(batch.startFrame == 0 && batch.samples.length == 5, "Exact source frame range");
        require(batch.samples[0] == -1 && batch.samples[1] == -0.5 && batch.samples[3] == 0.5
            && batch.samples[4] == 32767 / 32768.0, "Signed PCM16 source retained without normalization");
        input[0] = 0;
        require(batch.samples[0] == -1, "Retained PCM owns samples after AudioRecord buffer reuse");
        capture.acknowledge(5);
        NativeCaptureStream.Batch next = capture.process(new short[127], 127);
        require(next.startFrame == 5 && next.time <= 132 / 48000.0, "Partial detector windows keep sample watermark");
        for (int rate : new int[] {44100, 48000}) {
            NativeCaptureStream stalled = new NativeCaptureStream(rate);
            short[] block = new short[rate / 50];
            for (int i = 0; i < 25; i++) stalled.process(block, block.length);
            stalled.acknowledge(rate); // A future acknowledgement cannot erase outstanding data.
            boolean rejected = false;
            try { stalled.process(block, block.length); }
            catch (IllegalStateException expected) { rejected = expected.getMessage().contains("keeping up"); }
            require(rejected, "A stalled consumer must stop after half a second, not queue unlimited PCM");
            stalled.acknowledge(block.length);
            require(stalled.process(block, block.length).startFrame == rate / 2, "Acknowledgement releases capacity without moving the sample clock");
        }
        NativeCaptureStream amplified = new NativeCaptureStream(48000);
        amplified.setInputGain(2);
        NativeCaptureStream.Batch loud = amplified.process(new short[] {16384, -16384, 30000}, 3);
        require(loud.samples[0] == 1 && loud.samples[1] == -1 && loud.samples[2] > 1, "Gain is multiplied into retained Float32 PCM without clipping");
        amplified.acknowledge(3);
        amplified.setInputGain(0.5);
        NativeCaptureStream.Batch quiet = amplified.process(new short[] {16384}, 1);
        require(quiet.startFrame == 3 && quiet.samples[0] == 0.25 && loud.samples[0] == 1, "Gain changes only future PCM without resetting the clock");
        System.out.println("Android PCM source, sample clock and bounded bridge contracts passed");
    }
    private static void fixture(int rate) {
        NativeCaptureStream stream = new NativeCaptureStream(rate);
        short[] pcm = new short[rate * 9];
        for (double time : new double[] {0.1, 0.6, 1.1, 1.6, 2.1, 2.6, 3.1, 3.6, 6.4}) {
            for (int i = 0; i < 256; i++) pcm[(int) Math.round(time * rate) + i] =
                (short) Math.round((i % 2 == 0 ? 26000 : -26000) * Math.exp(-i / 100.0));
        }
        int cursor = 0, iteration = 0;
        int[] sizes = {127, rate / 50, 256, 381};
        while (cursor < pcm.length) {
            int count = Math.min(sizes[iteration++ % sizes.length], pcm.length - cursor);
            short[] input = java.util.Arrays.copyOfRange(pcm, cursor, cursor + count);
            NativeCaptureStream.Batch batch = stream.process(input, count);
            StringBuilder line = new StringBuilder("{\"sessionId\":\"android-host\",\"sampleRate\":").append(rate)
                .append(",\"timestampQuality\":\"sample-clock\",\"time\":").append(batch.time)
                .append(",\"level\":").append(batch.level)
                .append(",\"pcm\":{\"startFrame\":").append(batch.startFrame).append(",\"samples\":[");
            for (int i = 0; i < count; i++) { if (i > 0) line.append(','); line.append(batch.samples[i]); }
            line.append("]},\"onsets\":[");
            for (int i = 0; i < batch.onsets.size(); i++) {
                if (i > 0) line.append(',');
                var onset = batch.onsets.get(i);
                line.append("{\"time\":").append(onset.time).append(",\"strength\":").append(onset.strength)
                    .append(",\"confidence\":").append(onset.confidence).append('}');
            }
            line.append("],\"waveform\":[");
            for (int i = 0; i < batch.waveform.size(); i++) {
                if (i > 0) line.append(',');
                var point = batch.waveform.get(i);
                line.append("{\"time\":").append(point.time).append(",\"duration\":").append(point.duration)
                    .append(",\"min\":").append(point.min).append(",\"max\":").append(point.max).append('}');
            }
            line.append("],\"analysis\":{\"implementation\":\"forgettime-java-onset\",\"version\":\"1\"},\"diagnostics\":").append(json(batch.diagnostics.toMap())).append("}");
            System.out.println(line);
            cursor += count;
            stream.acknowledge(cursor);
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

    private static void require(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
}
