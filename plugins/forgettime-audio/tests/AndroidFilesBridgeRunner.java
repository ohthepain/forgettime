import app.forgettime.audio.*;
import java.io.*;
import java.nio.*;
import java.nio.file.*;
import java.util.*;
/** Host transport for actual store/detector; replaces only Capacitor and picker/share UI. */
public class AndroidFilesBridgeRunner {
  static NativeBarStore store; static File root;
  static Map<String, File> handles = new HashMap<>();
  static Map<String, Object> map(Object... values) { Map<String,Object> result = new LinkedHashMap<>(); for (int i=0;i<values.length;i+=2) result.put((String)values[i],values[i+1]); return result; }
  static String decode(String value) { return new String(Base64.getDecoder().decode(value), java.nio.charset.StandardCharsets.UTF_8); }
  static Object held(File file) { String id=UUID.randomUUID().toString(); handles.put(id,file); return map("handle",id,"size",file.length()); }
  static Object summary(NativeBarStore.Summary value) { return map("id",value.id,"name",value.name,"createdAt",value.createdAt,"bpm",value.bpm,"complete",value.complete,"bytes",value.bytes); }
  public static void main(String[] args) throws Exception {
    root=new File(args[0]); store=new NativeBarStore(root,directory -> {});
    try (var lines=new BufferedReader(new InputStreamReader(System.in))) { String line; while((line=lines.readLine())!=null) { try { System.out.println(json(map("result", run(line.split("\t",-1))))); } catch(Exception error) { System.out.println(json(map("error",error.toString()))); } } }
  }
  static Object run(String[] a) throws Exception {
    switch(a[0]) {
      case "beginBarSave": return map("transferId",store.begin(new NativeBarStore.Summary(a[1],decode(a[2]),Long.parseLong(a[3]),Double.parseDouble(a[4]),Boolean.parseBoolean(a[5]),Long.parseLong(a[6])),Long.parseLong(a[7]),Long.parseLong(a[8])));
      case "appendFileChunk": store.append(a[1],a[2],Long.parseLong(a[3]),Base64.getDecoder().decode(a[4])); return null;
      case "commitBarSave": store.commit(a[1]); return null;
      case "abortFileTransfer": store.abort(a[1]); return null;
      case "listSavedBars": { var bars=new ArrayList<>(); for(var value:store.list()) bars.add(summary(value)); return map("bars",bars); }
      case "readSavedBar": { var pair=store.read(a[1]); return map("summary",summary(pair.summary),"wav",held(pair.wav),"sidecar",held(pair.sidecar)); }
      case "readFileChunk": { var file=handles.get(a[1]); byte[] bytes=new byte[Integer.parseInt(a[3])]; try(var input=new RandomAccessFile(file,"r")) { input.seek(Long.parseLong(a[2])); input.readFully(bytes); } return map("data",Base64.getEncoder().encodeToString(bytes)); }
      case "releaseFiles": for(int i=1;i<a.length;i++) handles.remove(a[i]); return null;
      case "restart": store=new NativeBarStore(root,directory -> {}); return null;
      case "exportSavedBar": store.read(a[1]); return map("status","cancelled");
      case "pickAudioFiles": { var files=new ArrayList<>(); for(int i=1;i<a.length;i++) { File file=new File(decode(a[i])); var value=(Map<String,Object>)held(file); value.put("name",file.getName()); files.add(value); } return map("files",files); }
      case "analyzeFixture": {
        int rate=Integer.parseInt(a[2]); ByteBuffer bytes=ByteBuffer.wrap(Files.readAllBytes(Path.of(decode(a[1])))).order(ByteOrder.LITTLE_ENDIAN);
        var detector=new DrumOnsetDetector(rate); var onsets=new ArrayList<>(); var candidates=new ArrayList<>(); int frame=0;
        while(bytes.hasRemaining()) { var onset=detector.process(bytes.getFloat(),frame++/(double)rate); if(onset!=null) onsets.add(map("time",onset.time,"strength",onset.strength,"confidence",onset.confidence)); if(frame%997==0)candidates.addAll(detector.drainDiagnostics().candidates); }
        candidates.addAll(detector.drainDiagnostics().candidates); return map("onsets",onsets,"diagnostics",map("candidates",candidates,"dropped",0));
      }
      default: throw new IOException("Unsupported fixture operation "+a[0]);
    }
  }
  static String json(Object value) {
    if(value==null)return "null";
    if(value instanceof String)return "\""+((String)value).replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n")+"\"";
    if(value instanceof Map<?,?>) { var entries=new ArrayList<String>(); for(var e:((Map<?,?>)value).entrySet())entries.add(json(e.getKey())+":"+json(e.getValue())); return "{"+String.join(",",entries)+"}"; }
    if(value instanceof List<?>) { var entries=new ArrayList<String>(); for(var e:(List<?>)value)entries.add(json(e)); return "["+String.join(",",entries)+"]"; }
    return value.toString();
  }
}
