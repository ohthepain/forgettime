import app.forgettime.audio.MelDetector;
import java.nio.*;import java.nio.file.*;import java.util.*;
public class MelParityRunner {
 public static void main(String[] args)throws Exception {
  MelDetector d=new MelDetector(new MelDetector.Settings(Integer.parseInt(args[1]),Integer.parseInt(args[2]),Integer.parseInt(args[3]),Integer.parseInt(args[4]),Boolean.parseBoolean(args[5]),Double.parseDouble(args[6])));
  ByteBuffer input=ByteBuffer.wrap(Files.readAllBytes(Path.of(args[0]))).order(ByteOrder.LITTLE_ENDIAN);long last=-1;int rows=0;
  while(input.hasRemaining()){float sample=input.getFloat();long frame=input.getLong();int rate=input.getInt();MelDetector.Onset onset=d.process(sample,frame,rate);MelDetector.Row row=d.latest();if(row!=null&&row.through!=last){last=row.through;System.out.println("A,"+row.through+","+row.center+","+row.flux+","+row.threshold+","+(row.ready?1:0));if(rows++%47==0){StringBuilder p=new StringBuilder("P,"+row.through);for(double v:d.power())p.append(",").append(v);System.out.println(p);StringBuilder m=new StringBuilder("M,"+row.through);for(double v:d.logMel())m.append(",").append(v);System.out.println(m);}}if(onset!=null)System.out.println("O,"+onset.sourceFrame+","+onset.analyzedThroughFrame+","+onset.flux+","+onset.threshold);}
  System.out.println("S,"+d.windowFrames()+","+d.hopFrames()+","+d.processedThroughFrame()+","+d.reliableFromFrame()+","+d.receivedThroughFrame());
 }
}
