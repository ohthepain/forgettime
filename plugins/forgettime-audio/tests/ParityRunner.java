import app.forgettime.audio.DrumOnsetDetector;
import app.forgettime.audio.WaveformEnvelopeCapture;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;

public class ParityRunner {
    public static void main(String[] args) throws Exception {
        int rate = Integer.parseInt(args[1]);
        ByteBuffer pcm = ByteBuffer.wrap(Files.readAllBytes(Path.of(args[0]))).order(ByteOrder.LITTLE_ENDIAN);
        DrumOnsetDetector detector = new DrumOnsetDetector(rate);
        WaveformEnvelopeCapture waveform = new WaveformEnvelopeCapture(rate);
        boolean showWaveform = args.length > 2;
        long frame = 0;
        while (pcm.hasRemaining()) {
            double sample = pcm.getFloat(), time = frame++ / (double) rate;
            DrumOnsetDetector.Onset onset = detector.process(sample, time);
            WaveformEnvelopeCapture.Point point = waveform.process(sample, time);
            if (showWaveform && point != null) System.out.println(point.time + "," + point.duration + "," + point.min + "," + point.max);
            if (!showWaveform && onset != null) System.out.println(onset.time + "," + onset.strength + "," + onset.confidence);
        }
    }
}
