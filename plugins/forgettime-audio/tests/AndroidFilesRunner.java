import app.forgettime.audio.NativeBarStore;
import app.forgettime.audio.PcmFileWriter;
import java.io.*;
import java.nio.file.*;
import java.util.*;
public class AndroidFilesRunner {
  static void require(boolean value, String reason) { if (!value) throw new AssertionError(reason); }
  public static void main(String[] args) throws Exception {
    File root = new File(args[0]); root.mkdirs();
    byte[] wav = Files.readAllBytes(Path.of(args[1])), sidecar = Files.readAllBytes(Path.of(args[2]));
    var store = new NativeBarStore(root, directory -> { try (var channel = java.nio.channels.FileChannel.open(directory.toPath(), StandardOpenOption.READ)) { channel.force(true); } });
    var summary = new NativeBarStore.Summary("portable", "Portable bar", 0, 137, false, wav.length + sidecar.length);
    String transfer = store.begin(summary, wav.length, sidecar.length);
    store.append(transfer, "wav", 0, Arrays.copyOf(wav, 10));
    boolean failed = false; try { store.commit(transfer); } catch (IOException expected) { failed = true; }
    require(failed && store.list().isEmpty(), "Incomplete pair never becomes saved");
    store.append(transfer, "wav", 10, Arrays.copyOfRange(wav, 10, wav.length));
    store.append(transfer, "sidecar", 0, sidecar); store.commit(transfer);
    var reopened = new NativeBarStore(root, directory -> {});
    require(reopened.list().size() == 1, "Committed pair survives restart");
    var pair = reopened.read("portable");
    require(Arrays.equals(wav, Files.readAllBytes(pair.wav.toPath())) && Arrays.equals(sidecar, Files.readAllBytes(pair.sidecar.toPath())), "Portable bytes remain exact");
    failed = false; try { reopened.begin(summary, wav.length, sidecar.length); } catch (IOException expected) { failed = true; }
    require(failed, "Duplicate save cannot overwrite original");
    failed = false; try { reopened.read("../portable"); } catch (IOException expected) { failed = true; }
    require(failed, "Only opaque safe IDs can select committed bars");
    var interrupted = new NativeBarStore.Summary("interrupted", "Interrupted", 1, 120, false, wav.length + sidecar.length);
    transfer = reopened.begin(interrupted, wav.length, sidecar.length); reopened.append(transfer, "wav", 0, wav); reopened.abort(transfer);
    require(reopened.list().size() == 1, "Aborted upload preserves prior library");
    Files.write(pair.sidecar.toPath(), new byte[]{1});
    failed = false; try { reopened.list(); } catch (IOException expected) { failed = true; }
    require(failed, "Corrupt committed pair must report an error");
    File counts = new File(root, "count-library");
    var countStore = new NativeBarStore(counts, directory -> {});
    for (int i = 0; i < 100; i++) {
      String transaction = countStore.begin(new NativeBarStore.Summary("bar-" + i, "Bar", i, 120, true, 2), 1, 1);
      countStore.append(transaction, "wav", 0, new byte[]{1}); countStore.append(transaction, "sidecar", 0, new byte[]{1}); countStore.commit(transaction);
    }
    failed = false; try { countStore.begin(new NativeBarStore.Summary("over-limit", "Bar", 100, 120, true, 2), 1, 1); } catch (IOException expected) { failed = true; }
    require(failed && countStore.list().size() == 100, "Quota failure preserves every previously saved bar");
    File failedRoot = new File(root, "failed-commit");
    var cannotSync = new NativeBarStore(failedRoot, directory -> { throw new IOException("Simulated disk failure"); });
    String transaction = cannotSync.begin(new NativeBarStore.Summary("failure", "Failure", 0, 120, true, 2), 1, 1);
    cannotSync.append(transaction, "wav", 0, new byte[]{1}); cannotSync.append(transaction, "sidecar", 0, new byte[]{1});
    failed = false; try { cannotSync.commit(transaction); } catch (IOException expected) { failed = true; }
    require(failed && cannotSync.list().isEmpty(), "Failed durable write is never listed as saved");
    require(new NativeBarStore(failedRoot, directory -> {}).list().isEmpty(), "Restart removes abandoned stage without inventing a saved bar");
    File mono = new File(root, "decode.pcm");
    try (var output = new PcmFileWriter(mono, 44100, 2)) {
      var buffer = java.nio.ByteBuffer.allocate(8).order(java.nio.ByteOrder.LITTLE_ENDIAN);
      buffer.putShort((short)-32768).putShort((short)16384).putShort((short)32767).putShort((short)-32767).flip();
      output.append(buffer, false);
      require(output.frames() == 2, "Decoded source frames keep original channel-rate clock");
    }
    var decoded = java.nio.ByteBuffer.wrap(Files.readAllBytes(mono.toPath())).order(java.nio.ByteOrder.LITTLE_ENDIAN);
    require(decoded.getFloat() == -0.25f && decoded.getFloat() == 0, "PCM16 channels average without clipping");
    try (var output = new PcmFileWriter(mono, 48000, 2)) {
      var buffer = java.nio.ByteBuffer.allocate(8).order(java.nio.ByteOrder.LITTLE_ENDIAN).putFloat(2).putFloat(1); buffer.flip(); output.append(buffer, true);
    }
    require(java.nio.ByteBuffer.wrap(Files.readAllBytes(mono.toPath())).order(java.nio.ByteOrder.LITTLE_ENDIAN).getFloat() == 1.5f, "Finite Float32 source is not normalized or clipped");
    failed = false;
    try (var output = new PcmFileWriter(mono, 48000, 1)) {
      var buffer = java.nio.ByteBuffer.allocate(4).order(java.nio.ByteOrder.LITTLE_ENDIAN).putFloat(Float.NaN); buffer.flip(); output.append(buffer, true);
    } catch (IOException expected) { failed = true; }
    require(failed, "Nonfinite decoded PCM is rejected");
    System.out.println("Android atomic portable file and PCM contracts passed");
  }
}
