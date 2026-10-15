package app.forgettime.audio;
import android.media.*;
import android.os.SystemClock;
import java.io.*;
import java.nio.*;
/** Decode only; no output device, microphone or sample-rate conversion. */
final class AndroidAudioDecoder {
    static final class Result {
        final int sampleRate, channels; final long frames;
        Result(int sampleRate, int channels, long frames) { this.sampleRate = sampleRate; this.channels = channels; this.frames = frames; }
    }
    static Result decode(File source, File destination, java.util.function.BooleanSupplier cancelled) throws IOException {
        MediaExtractor extractor = new MediaExtractor(); MediaCodec codec = null; PcmFileWriter writer = null;
        try {
            extractor.setDataSource(source.getAbsolutePath());
            MediaFormat selected = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat format = extractor.getTrackFormat(i); String mime = format.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) { selected = format; extractor.selectTrack(i); break; }
            }
            if (selected == null) throw new IOException("M4A contains no supported audio track.");
            if (selected.containsKey(MediaFormat.KEY_DURATION) && selected.getLong(MediaFormat.KEY_DURATION) > 120_000_000L) throw new IOException("Audio must be no longer than 120 seconds.");
            int rate = selected.getInteger(MediaFormat.KEY_SAMPLE_RATE), channels = selected.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            if (rate < 8000 || rate > 192000 || channels < 1 || channels > 8) throw new IOException("Unsupported M4A audio format.");
            codec = MediaCodec.createDecoderByType(selected.getString(MediaFormat.KEY_MIME));
            codec.configure(selected, null, null, 0); codec.start();
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo(); boolean inputEnded = false, ended = false, floating = false;
            long progress = SystemClock.elapsedRealtime();
            while (!ended) {
                if (cancelled.getAsBoolean() || Thread.currentThread().isInterrupted()) throw new IOException("Audio decoding cancelled.");
                if (SystemClock.elapsedRealtime() - progress > 10000) throw new IOException("Audio decoder stopped making progress.");
                if (!inputEnded) {
                    int index = codec.dequeueInputBuffer(10000);
                    if (index >= 0) {
                        ByteBuffer buffer = codec.getInputBuffer(index); if (buffer == null) throw new IOException("Audio decoder input unavailable.");
                        buffer.clear(); int count = extractor.readSampleData(buffer, 0);
                        if (count < 0) { codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputEnded = true; }
                        else { codec.queueInputBuffer(index, 0, count, extractor.getSampleTime(), 0); extractor.advance(); }
                        progress = SystemClock.elapsedRealtime();
                    }
                }
                int index = codec.dequeueOutputBuffer(info, 10000);
                if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat output = codec.getOutputFormat(); int actualRate = output.getInteger(MediaFormat.KEY_SAMPLE_RATE), actualChannels = output.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    if (writer != null && (actualRate != rate || actualChannels != channels)) throw new IOException("M4A source format changed during decode.");
                    rate = actualRate; channels = actualChannels;
                    int encoding = output.containsKey(MediaFormat.KEY_PCM_ENCODING) ? output.getInteger(MediaFormat.KEY_PCM_ENCODING) : AudioFormat.ENCODING_PCM_16BIT;
                    if (encoding != AudioFormat.ENCODING_PCM_FLOAT && encoding != AudioFormat.ENCODING_PCM_16BIT) throw new IOException("Unsupported decoder PCM encoding.");
                    floating = encoding == AudioFormat.ENCODING_PCM_FLOAT;
                    if (writer == null) writer = new PcmFileWriter(destination, rate, channels);
                    progress = SystemClock.elapsedRealtime();
                } else if (index >= 0) {
                    try {
                        if (info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                            if (writer == null) throw new IOException("Decoder did not report its output format.");
                            ByteBuffer buffer = codec.getOutputBuffer(index); if (buffer == null || info.offset < 0 || info.size < 0 || (long) info.offset + info.size > buffer.capacity()) throw new IOException("Invalid decoder buffer.");
                            buffer.position(info.offset); buffer.limit(info.offset + info.size); writer.append(buffer, floating);
                        }
                        ended = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                    } finally { codec.releaseOutputBuffer(index, false); }
                    progress = SystemClock.elapsedRealtime();
                }
            }
            if (writer == null || writer.frames() == 0) throw new IOException("M4A decoded no audio samples.");
            return new Result(rate, channels, writer.frames());
        } catch (RuntimeException error) { throw new IOException("M4A decoding failed: " + error.getMessage(), error); }
        finally {
            try { if (writer != null) writer.close(); }
            finally { try { if (codec != null) { try { codec.stop(); } finally { codec.release(); } } } finally { extractor.release(); } }
        }
    }
}
