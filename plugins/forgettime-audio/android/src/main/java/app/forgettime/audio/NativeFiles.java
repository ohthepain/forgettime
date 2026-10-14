package app.forgettime.audio;

import android.app.Activity;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.system.*;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

/** Narrow file operations only; no arbitrary paths/URIs accepted from JavaScript. */
final class NativeFiles {
    private static final long CACHE_LIMIT = 192L * 1024 * 1024;
    private final ForgettimeAudioPlugin plugin;
    private final Context context;
    private final File temporary, exports;
    private final NativeBarStore store;
    private final ThreadPoolExecutor queue = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(32));
    private final Map<String, Held> handles = new HashMap<>();
    private final Map<String, Upload> uploads = new HashMap<>();
    private volatile boolean closed, picking;
    private volatile PluginCall pickerCall;
    private static final class Held {
        final File file; final boolean owned; final long size; long touched = System.nanoTime();
        Held(File file, boolean owned) { this.file = file; this.owned = owned; size = file.length(); }
    }
    private static final class Upload {
        final File file; final long size; long touched = System.nanoTime();
        Upload(File file, long size) { this.file = file; this.size = size; }
    }
    NativeFiles(ForgettimeAudioPlugin plugin) throws IOException {
        this.plugin = plugin; context = plugin.getContext();
        temporary = new File(context.getCacheDir(), "forgettime-imports"); exports = new File(context.getCacheDir(), "forgettime-exports");
        if (temporary.exists()) NativeBarStore.remove(temporary);
        if (!temporary.mkdirs()) throw new IOException("Temporary audio storage is unavailable.");
        if (!exports.isDirectory() && !exports.mkdirs()) throw new IOException("Export storage is unavailable.");
        pruneExports();
        store = new NativeBarStore(new File(context.getNoBackupFilesDir(), "forgettime-bars-v1"), directory -> {
            FileDescriptor fd = null;
            try { fd = Os.open(directory.getAbsolutePath(), OsConstants.O_RDONLY, 0); Os.fsync(fd); }
            catch (ErrnoException error) { throw new IOException("Saved directory could not be synchronized.", error); }
            finally { if (fd != null) try { Os.close(fd); } catch (ErrnoException ignored) { } }
        });
    }
    void execute(String method, PluginCall call) {
        submit(call, () -> {
            expire();
            switch (method) {
                case "listSavedBars": { JSArray bars = new JSArray(); for (var value : store.list()) bars.put(summary(value)); call.resolve(object("bars", bars)); break; }
                case "beginBarSave": {
                    JSObject value = call.getObject("summary"); if (value == null) throw new IOException("Missing saved summary.");
                    var summary = new NativeBarStore.Summary(value.getString("id"), value.getString("name"), integer(value, "createdAt"), value.optDouble("bpm", Double.NaN), value.getBoolean("complete"), integer(value, "bytes"));
                    call.resolve(object("transferId", store.begin(summary, integer(call, "wavBytes"), integer(call, "sidecarBytes")))); break;
                }
                case "appendFileChunk": {
                    String id = required(call, "transferId"), part = required(call, "part"), text = required(call, "data");
                    if (text.length() > 87384) throw new IOException("File chunk exceeds supported size.");
                    byte[] data; try { data = Base64.decode(text, Base64.NO_WRAP); } catch (IllegalArgumentException error) { throw new IOException("Invalid file chunk encoding."); }
                    if (data.length < 1 || data.length > 65536) throw new IOException("File chunk exceeds supported size.");
                    long offset = integer(call, "offset");
                    if ("audio".equals(part)) {
                        Upload value = uploads.get(id); if (value == null) throw new IOException("Decode upload expired.");
                        if (offset != value.file.length() || offset + data.length > value.size) throw new IOException("Decode chunk is out of order.");
                        reserve(data.length);
                        try (FileOutputStream output = new FileOutputStream(value.file, true)) { output.write(data); } value.touched = System.nanoTime();
                    } else store.append(id, part, offset, data);
                    call.resolve(); break;
                }
                case "commitBarSave": store.commit(required(call, "transferId")); call.resolve(); break;
                case "abortFileTransfer": {
                    String id = required(call, "transferId"); store.abort(id); Upload upload = uploads.remove(id); if (upload != null) NativeBarStore.remove(upload.file); call.resolve(); break;
                }
                case "readSavedBar": {
                    var pair = store.read(required(call, "id")); String wav = hold(pair.wav, false), sidecar = null;
                    try { sidecar = hold(pair.sidecar, false); call.resolve(object("summary", summary(pair.summary), "wav", descriptor(wav), "sidecar", descriptor(sidecar))); }
                    catch (Exception error) { release(wav); if (sidecar != null) release(sidecar); throw error; } break;
                }
                case "readFileChunk": {
                    String id = required(call, "handle"); Held value = handles.get(id); if (value == null) throw new IOException("Selected file handle expired. Choose the files again.");
                    long offset = integer(call, "offset"), length = integer(call, "length");
                    if (length < 1 || length > 65536 || offset > value.size - length || value.file.length() != value.size) throw new IOException("Selected file changed or chunk is invalid.");
                    byte[] data = new byte[(int) length]; try (RandomAccessFile input = new RandomAccessFile(value.file, "r")) { input.seek(offset); input.readFully(data); }
                    value.touched = System.nanoTime(); call.resolve(object("data", Base64.encodeToString(data, Base64.NO_WRAP))); break;
                }
                case "releaseFiles": {
                    JSArray ids = call.getArray("handles"); if (ids == null || ids.length() > 8) throw new IOException("Invalid file handle list.");
                    for (int i = 0; i < ids.length(); i++) release(ids.getString(i)); call.resolve(); break;
                }
                case "pickAudioFiles": pick(call); break;
                case "beginAudioDecode": {
                    String name = required(call, "name"); long size = integer(call, "byteLength");
                    if (!name.toLowerCase(Locale.ROOT).endsWith(".m4a") || name.length() > 255 || size < 1 || size > NativeBarStore.AUDIO_LIMIT) throw new IOException("Unsupported compressed audio file.");
                    if (!uploads.isEmpty()) throw new IOException("Another audio file is being decoded.");
                    reserve(size + 32L * 1024 * 1024); String id = UUID.randomUUID().toString(); File file = new File(temporary, id + ".m4a");
                    if (!file.createNewFile()) throw new IOException("Cannot stage compressed audio."); uploads.put(id, new Upload(file, size)); call.resolve(object("transferId", id)); break;
                }
                case "finishAudioDecode": {
                    String id = required(call, "transferId"); Upload upload = uploads.remove(id); if (upload == null) throw new IOException("Decode upload expired.");
                    File pcm = new File(temporary, UUID.randomUUID() + ".pcm"); String held = null;
                    try {
                        if (upload.file.length() != upload.size) throw new IOException("Compressed audio upload is incomplete.");
                        reserve(32L * 1024 * 1024);
                        var result = AndroidAudioDecoder.decode(upload.file, pcm, () -> closed); held = hold(pcm, true);
                        call.resolve(object("handle", held, "size", pcm.length(), "frames", result.frames, "sampleRate", result.sampleRate, "channels", result.channels));
                    } catch (Exception error) { if (held != null) release(held); else NativeBarStore.remove(pcm); throw error; }
                    finally { NativeBarStore.remove(upload.file); } break;
                }
                case "exportSavedBar": export(call); break;
                default: throw new IOException("Unknown file operation.");
            }
        });
    }
    private void pick(PluginCall call) throws IOException {
        if (picking) throw new IOException("The document picker is already open."); picking = true; pickerCall = call;
        plugin.getActivity().runOnUiThread(() -> {
            if (closed) { picking = false; pickerCall = null; call.reject("File picker was closed."); return; }
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try { plugin.startActivityForResult(call, intent, "audioFilesPicked"); }
            catch (RuntimeException error) { picking = false; pickerCall = null; call.reject("Document picker is unavailable.", error); }
        });
    }
    void picked(PluginCall call, ActivityResult result) {
        picking = false; pickerCall = null;
        if (call == null || closed) return;
        submit(call, () -> {
            JSArray selected = new JSArray(); List<String> made = new ArrayList<>();
            try {
                if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.resolve(object("files", selected)); return; }
                Intent data = result.getData(); List<Uri> uris = new ArrayList<>();
                if (data.getClipData() != null) { if (data.getClipData().getItemCount() > 2) throw new IOException("Choose one audio file and an optional .forget file."); for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri()); }
                else if (data.getData() != null) uris.add(data.getData());
                boolean audio = false, sidecar = false;
                for (Uri uri : uris) {
                    if (!"content".equals(uri.getScheme())) throw new IOException("Choose an accessible document from the system picker.");
                    String name = null; long declared = -1;
                    try (Cursor cursor = context.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
                        if (cursor != null && cursor.moveToFirst()) { name = cursor.getString(0); if (!cursor.isNull(1)) declared = cursor.getLong(1); }
                    }
                    if (name == null || name.isEmpty() || name.length() > 255) throw new IOException("Selected document has no supported filename.");
                    String lower = name.toLowerCase(Locale.ROOT); boolean metadata = lower.endsWith(".forget");
                    if (metadata) { if (sidecar) throw new IOException("Choose at most one .forget file."); sidecar = true; }
                    else { if (!(lower.endsWith(".wav") || lower.endsWith(".m4a")) || audio) throw new IOException("Choose one WAV or M4A file."); audio = true; }
                    long limit = metadata ? NativeBarStore.SIDECAR_LIMIT : NativeBarStore.AUDIO_LIMIT;
                    if (declared > limit || declared == 0) throw new IOException("Selected file exceeds supported size limits."); reserve(declared > 0 ? declared : limit);
                    File target = new File(temporary, UUID.randomUUID().toString());
                    try (InputStream input = context.getContentResolver().openInputStream(uri)) {
                        if (input == null) throw new IOException("Selected document cannot be read."); copy(input, target, limit);
                        if (target.length() == 0 || declared >= 0 && target.length() != declared) throw new IOException("Selected document changed while being copied.");
                        String id = hold(target, true); made.add(id); selected.put(object("handle", id, "name", name, "size", target.length()));
                    } catch (Exception error) { NativeBarStore.remove(target); throw error; }
                }
                if (!audio && !uris.isEmpty()) throw new IOException("Choose a WAV or M4A file with its optional .forget file.");
                call.resolve(object("files", selected));
            } catch (Exception error) { for (String id : made) release(id); throw error; }
        });
    }
    private void export(PluginCall call) throws Exception {
        var pair = store.read(required(call, "id")); reserve(pair.summary.bytes);
        File directory = new File(exports, UUID.randomUUID().toString()); if (!directory.mkdir()) throw new IOException("Cannot prepare export files.");
        ArrayList<Uri> uris = new ArrayList<>();
        try {
            for (File source : new File[]{pair.wav, pair.sidecar}) {
                File file = new File(directory, "forgettime-" + pair.summary.id + (source == pair.wav ? ".wav" : ".forget"));
                try (InputStream input = new FileInputStream(source)) { copy(input, file, source.length()); }
                uris.add(FileProvider.getUriForFile(context, context.getPackageName() + ".forgettime.audiofiles", file));
            }
        } catch (Exception error) { NativeBarStore.remove(directory); throw error; }
        plugin.getActivity().runOnUiThread(() -> {
            try {
                if (closed) throw new IllegalStateException("Export closed.");
                Intent send = new Intent(Intent.ACTION_SEND_MULTIPLE).setType("*/*").putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                ClipData clip = ClipData.newRawUri("Forgettime WAV and context", uris.get(0)); clip.addItem(new ClipData.Item(uris.get(1))); send.setClipData(clip);
                plugin.getActivity().startActivity(Intent.createChooser(send, "Export WAV and .forget")); call.resolve(object("status", "presented"));
            } catch (RuntimeException error) { call.reject("Unable to open a share destination. Local pair is retained.", error); }
        });
    }
    private String hold(File file, boolean owned) throws IOException { if (handles.size() >= 8) throw new IOException("Too many open audio files. Finish the current import."); String id = UUID.randomUUID().toString(); handles.put(id, new Held(file, owned)); return id; }
    private JSObject descriptor(String id) { return object("handle", id, "size", handles.get(id).size); }
    private void release(String id) throws IOException { Held value = handles.remove(id); if (value != null && value.owned) NativeBarStore.remove(value.file); }
    private void reserve(long bytes) throws IOException { pruneExports(); if (bytes < 0 || diskBytes(temporary) + diskBytes(exports) + bytes > CACHE_LIMIT) throw new IOException("Temporary audio storage limit reached. Finish other imports or try again after old exports expire."); }
    private static long diskBytes(File file) throws IOException { if (!file.isDirectory()) return file.length(); long size = 0; File[] children = file.listFiles(); if (children == null) throw new IOException("Cannot inspect temporary storage."); for (File child : children) size += diskBytes(child); return size; }
    private void pruneExports() throws IOException { File[] children = exports.listFiles(); if (children == null) return; for (File child : children) if (System.currentTimeMillis() - child.lastModified() > 86400000L) NativeBarStore.remove(child); }
    private void expire() throws IOException {
        for (String id : new ArrayList<>(handles.keySet())) if (System.nanoTime() - handles.get(id).touched > 600_000_000_000L) release(id);
        for (String id : new ArrayList<>(uploads.keySet())) if (System.nanoTime() - uploads.get(id).touched > 600_000_000_000L) NativeBarStore.remove(uploads.remove(id).file);
    }
    private void copy(InputStream input, File output, long max) throws IOException {
        try (FileOutputStream target = new FileOutputStream(output)) { byte[] buffer = new byte[65536]; long total = 0; int count; while ((count = input.read(buffer)) != -1) { if (closed || Thread.currentThread().isInterrupted()) throw new IOException("File operation cancelled."); total += count; if (total > max) throw new IOException("File exceeds supported size limits."); target.write(buffer, 0, count); } target.getFD().sync(); }
    }
    private interface Job { void run() throws Exception; }
    private void submit(PluginCall call, Job job) {
        if (closed) { call.reject("Native file operations closed."); return; }
        try { queue.execute(() -> { try { if (closed) throw new IOException("Native file operation cancelled."); job.run(); } catch (Exception error) { call.reject(error.getMessage() == null ? "Native file operation failed." : error.getMessage(), error); } finally { if (closed && queue.getQueue().isEmpty()) cleanup(); } }); }
        catch (RejectedExecutionException error) { call.reject("Native file operations are busy. Try again."); }
    }
    void close() {
        closed = true;
        PluginCall selecting = pickerCall; pickerCall = null; if (selecting != null) selecting.reject("File picker closed before selection completed.");
        // Queued calls still run their cancellation branch and settle their promises.
        try { queue.execute(this::cleanup); } catch (RejectedExecutionException ignored) { }
        queue.shutdown();
    }
    private void cleanup() {
        try { store.close(); for (String id : new ArrayList<>(handles.keySet())) release(id); for (Upload value : uploads.values()) NativeBarStore.remove(value.file); uploads.clear(); }
        catch (IOException ignored) { /* Startup retries deletion of temporary leftovers. */ }
    }
    private static String required(PluginCall call, String key) throws IOException { String value = call.getString(key); if (value == null || value.isEmpty()) throw new IOException("Missing " + key + "."); return value; }
    private static long integer(PluginCall call, String key) throws IOException { return integer(call.getData(), key); }
    private static long integer(JSObject value, String key) throws IOException { double number = value.optDouble(key, Double.NaN); if (!Double.isFinite(number) || number < 0 || number > 9007199254740991d || number != Math.floor(number)) throw new IOException("Invalid " + key + "."); return (long) number; }
    private static JSObject summary(NativeBarStore.Summary value) { return object("id", value.id, "name", value.name, "createdAt", value.createdAt, "bpm", value.bpm, "complete", value.complete, "bytes", value.bytes); }
    private static JSObject object(Object... entries) { JSObject value = new JSObject(); for (int i = 0; i < entries.length; i += 2) value.put((String) entries[i], entries[i + 1]); return value; }
}
