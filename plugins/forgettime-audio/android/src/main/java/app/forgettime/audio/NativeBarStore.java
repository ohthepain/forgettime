package app.forgettime.audio;

import java.io.*;
import java.util.*;

/** Private, same-volume atomic directory commit; platform injects directory fsync. */
public final class NativeBarStore {
    public static final long AUDIO_LIMIT = 64L * 1024 * 1024, SIDECAR_LIMIT = 2L * 1024 * 1024, LIBRARY_LIMIT = 256L * 1024 * 1024;
    public interface DirectorySync { void sync(File directory) throws IOException; }
    public static final class Summary {
        public final String id, name;
        public final long createdAt, bytes;
        public final double bpm;
        public final boolean complete;
        public Summary(String id, String name, long createdAt, double bpm, boolean complete, long bytes) throws IOException {
            validId(id);
            if (name == null || name.isEmpty() || name.length() > 255 || createdAt < 0 || !Double.isFinite(bpm) || bpm < 30 || bpm > 300 || bytes < 1 || bytes > AUDIO_LIMIT + SIDECAR_LIMIT) throw new IOException("Invalid saved bar summary.");
            this.id = id; this.name = name; this.createdAt = createdAt; this.bpm = bpm; this.complete = complete; this.bytes = bytes;
        }
    }
    public static final class Pair {
        public final Summary summary;
        public final File wav, sidecar;
        Pair(Summary summary, File directory) { this.summary = summary; wav = new File(directory, "audio.wav"); sidecar = new File(directory, "context.forget"); }
    }
    private static final class Pending {
        final Summary summary; final File directory; final long wavBytes, sidecarBytes;
        long touched = System.nanoTime();
        Pending(Summary summary, File directory, long wavBytes, long sidecarBytes) { this.summary = summary; this.directory = directory; this.wavBytes = wavBytes; this.sidecarBytes = sidecarBytes; }
    }
    private final File root;
    private final DirectorySync sync;
    private final Map<String, Pending> pending = new HashMap<>();
    public NativeBarStore(File root, DirectorySync sync) throws IOException {
        this.root = root; this.sync = sync;
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Private saved-bar storage is unavailable.");
        for (File file : children(root)) if (file.getName().startsWith(".stage-")) remove(file);
    }
    public synchronized String begin(Summary summary, long wavBytes, long sidecarBytes) throws IOException {
        expire();
        if (!pending.isEmpty()) throw new IOException("A saved bar is still being written. Try again.");
        if (wavBytes < 1 || wavBytes > AUDIO_LIMIT || sidecarBytes < 1 || sidecarBytes > SIDECAR_LIMIT || summary.bytes != wavBytes + sidecarBytes) throw new IOException("Invalid saved pair lengths.");
        List<Summary> entries = list(); long bytes = 0; for (Summary item : entries) bytes += item.bytes;
        if (entries.size() >= 100 || bytes + summary.bytes > LIBRARY_LIMIT) throw new IOException("Saved bars limit reached (100 bars / 256 MiB). Export your files before deliberately clearing app storage.");
        if (new File(root, summary.id).exists()) throw new IOException("A saved bar with that ID already exists.");
        String id = UUID.randomUUID().toString(); File stage = new File(root, ".stage-" + id);
        if (!stage.mkdir()) throw new IOException("Unable to stage saved bar; check available storage.");
        pending.put(id, new Pending(summary, stage, wavBytes, sidecarBytes)); return id;
    }
    public synchronized void append(String id, String part, long offset, byte[] bytes) throws IOException {
        Pending operation = operation(id);
        String name; long expected;
        if ("wav".equals(part)) { name = "audio.wav"; expected = operation.wavBytes; }
        else if ("sidecar".equals(part)) { name = "context.forget"; expected = operation.sidecarBytes; }
        else throw new IOException("Invalid saved file part.");
        File file = new File(operation.directory, name);
        if (bytes.length < 1 || bytes.length > 65536 || offset != file.length() || offset + bytes.length > expected) throw new IOException("Saved file chunk is out of order or exceeds its size.");
        try (FileOutputStream output = new FileOutputStream(file, true)) { output.write(bytes); }
    }
    public synchronized void commit(String id) throws IOException {
        Pending operation = operation(id);
        File wav = new File(operation.directory, "audio.wav"), sidecar = new File(operation.directory, "context.forget");
        if (wav.length() != operation.wavBytes || sidecar.length() != operation.sidecarBytes) throw new IOException("Saved pair is incomplete; no bar was added.");
        flush(wav); flush(sidecar);
        try (FileOutputStream file = new FileOutputStream(new File(operation.directory, "manifest")); DataOutputStream output = new DataOutputStream(file)) {
            Summary value = operation.summary;
            output.writeInt(0x46544231); output.writeUTF(value.id); output.writeUTF(value.name); output.writeLong(value.createdAt); output.writeDouble(value.bpm); output.writeBoolean(value.complete); output.writeLong(value.bytes); output.writeLong(operation.wavBytes); output.writeLong(operation.sidecarBytes); output.flush(); file.getFD().sync();
        }
        sync.sync(operation.directory);
        File destination = new File(root, operation.summary.id);
        if (destination.exists() || !operation.directory.renameTo(destination)) throw new IOException("Saved pair could not be committed atomically; no bar was added.");
        try { sync.sync(root); }
        catch (IOException error) {
            if (!destination.renameTo(operation.directory)) throw new IOException("Saved pair exists but durable commit could not be confirmed. Reopen the saved library before trying again.", error);
            throw new IOException("Saved pair could not be committed durably.", error);
        }
        pending.remove(id);
    }
    public synchronized void abort(String id) throws IOException { Pending value = pending.remove(id); if (value != null) remove(value.directory); }
    public synchronized void close() throws IOException { for (String id : new ArrayList<>(pending.keySet())) abort(id); }
    public synchronized List<Summary> list() throws IOException {
        List<Summary> entries = new ArrayList<>(); long bytes = 0;
        for (File file : children(root)) {
            if (file.getName().startsWith(".stage-")) continue;
            Pair pair = read(file.getName()); entries.add(pair.summary); bytes += pair.summary.bytes;
            if (entries.size() > 100 || bytes > LIBRARY_LIMIT) throw new IOException("Saved library exceeds supported limits.");
        }
        entries.sort((a, b) -> Long.compare(b.createdAt, a.createdAt)); return entries;
    }
    public synchronized Pair read(String id) throws IOException {
        validId(id); File directory = new File(root, id), manifest = new File(directory, "manifest");
        if (!directory.isDirectory() || !manifest.isFile() || manifest.length() > 4096) throw new IOException("Saved bar is missing or its index is corrupt.");
        try (DataInputStream input = new DataInputStream(new FileInputStream(manifest))) {
            if (input.readInt() != 0x46544231) throw new IOException("Unsupported saved bar index version.");
            Summary summary = new Summary(input.readUTF(), input.readUTF(), input.readLong(), input.readDouble(), input.readBoolean(), input.readLong());
            long wavBytes = input.readLong(), sidecarBytes = input.readLong(); Pair pair = new Pair(summary, directory);
            if (!id.equals(summary.id) || input.read() != -1 || wavBytes < 1 || wavBytes > AUDIO_LIMIT || sidecarBytes < 1 || sidecarBytes > SIDECAR_LIMIT || wavBytes + sidecarBytes != summary.bytes || !pair.wav.isFile() || pair.wav.length() != wavBytes || !pair.sidecar.isFile() || pair.sidecar.length() != sidecarBytes) throw new IOException("Saved bar has an incomplete or corrupt pair.");
            return pair;
        }
    }
    private Pending operation(String id) throws IOException { expire(); Pending value = pending.get(id); if (value == null) throw new IOException("Saved file transfer expired."); value.touched = System.nanoTime(); return value; }
    private void expire() throws IOException { for (String id : new ArrayList<>(pending.keySet())) if (System.nanoTime() - pending.get(id).touched > 600_000_000_000L) abort(id); }
    private static void validId(String id) throws IOException { if (id == null || !id.matches("[A-Za-z0-9_-]{1,128}")) throw new IOException("Invalid saved bar ID."); }
    private static void flush(File file) throws IOException { try (FileOutputStream stream = new FileOutputStream(file, true)) { stream.getFD().sync(); } }
    private static File[] children(File directory) throws IOException { File[] files = directory.listFiles(); if (files == null) throw new IOException("Saved bar directory cannot be read."); return files; }
    public static void remove(File file) throws IOException { if (file.isDirectory()) for (File child : children(file)) remove(child); if (file.exists() && !file.delete()) throw new IOException("Temporary audio could not be removed."); }
}
