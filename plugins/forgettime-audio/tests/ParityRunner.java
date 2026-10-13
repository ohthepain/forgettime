import app.forgettime.audio.DrumOnsetDetector;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;

public class ParityRunner {
    public static void main(String[] args) throws Exception {
        int rate = Integer.parseInt(args[1]);
        ByteBuffer pcm = ByteBuffer.wrap(Files.readAllBytes(Path.of(args[0]))).order(ByteOrder.LITTLE_ENDIAN);
        DrumOnsetDetector detector = new DrumOnsetDetector(rate);
        long frame = 0;
        while (pcm.hasRemaining()) {
            DrumOnsetDetector.Onset onset = detector.process(pcm.getFloat(), frame++ / (double) rate);
            if (onset != null) System.out.println(onset.time + "," + onset.strength + "," + onset.confidence);
        }
    }
}
