package app.forgettime.audio;
import java.io.*;
import java.nio.*;
/** Bounded decoder output conversion, preserving source rate and unclipped channel mean. */
public final class PcmFileWriter implements Closeable {
    private final FileOutputStream output;
    public final int sampleRate, channels;
    private long frames;
    public PcmFileWriter(File file, int sampleRate, int channels) throws IOException {
        if (sampleRate < 8000 || sampleRate > 192000 || channels < 1 || channels > 8) throw new IOException("Unsupported decoded audio format.");
        this.sampleRate = sampleRate; this.channels = channels; output = new FileOutputStream(file);
    }
    public long frames() { return frames; }
    public void append(ByteBuffer input, boolean floating) throws IOException {
        int stride = channels * (floating ? 4 : 2);
        if (input.remaining() % stride != 0) throw new IOException("Decoded PCM frame is incomplete.");
        int count = input.remaining() / stride;
        if (frames + count > 120L * sampleRate || (frames + count) * 4 > 32L * 1024 * 1024) throw new IOException("Decoded audio exceeds 120 seconds or 32 MiB.");
        byte[] block = new byte[16384]; ByteBuffer encoded = ByteBuffer.wrap(block).order(ByteOrder.LITTLE_ENDIAN);
        input.order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < count; i++) {
            double sum = 0;
            for (int channel = 0; channel < channels; channel++) {
                double value = floating ? input.getFloat() : input.getShort() / 32768.0;
                if (!Double.isFinite(value)) throw new IOException("Decoded audio contains invalid samples.");
                sum += value / channels;
            }
            float mono = (float) sum;
            if (!Float.isFinite(mono)) throw new IOException("Decoded audio exceeds Float32 range.");
            encoded.putFloat(mono);
            if (!encoded.hasRemaining()) { output.write(block); encoded.clear(); }
        }
        if (encoded.position() > 0) output.write(block, 0, encoded.position());
        frames += count;
    }
    public void close() throws IOException { try { output.getFD().sync(); } finally { output.close(); } }
}
