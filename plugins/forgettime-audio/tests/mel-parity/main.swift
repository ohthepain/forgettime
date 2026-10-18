import Foundation
let a=CommandLine.arguments
let settings=try MelSettings(windowMs:Int(a[2])!,bands:Int(a[3])!,neighbor:Int(a[4])!,confirmation:Int(a[5])!,rearming:a[6]=="true",threshold:Double(a[7])!)
let detector=MelDetector(settings:settings)
let data=try Data(contentsOf:URL(fileURLWithPath:a[1]));var last:Int64 = -1;var rows=0
for offset in stride(from:0,to:data.count,by:16){let sample:Float=data.withUnsafeBytes{Float(bitPattern:UInt32(littleEndian:$0.loadUnaligned(fromByteOffset:offset,as:UInt32.self)))};let frame:Int64=data.withUnsafeBytes{Int64(littleEndian:$0.loadUnaligned(fromByteOffset:offset+4,as:Int64.self))};let rate:Int=data.withUnsafeBytes{Int(Int32(littleEndian:$0.loadUnaligned(fromByteOffset:offset+12,as:Int32.self)))}
 let onset=try detector.process(sample:sample,frame:frame,sampleRate:rate)
 if let row=detector.latest,row.through != last {last=row.through;print("A,\(row.through),\(row.center),\(row.flux),\(row.threshold),\(row.ready ? 1:0)");if rows%47==0{print("P,\(row.through),"+detector.power.map{String($0)}.joined(separator:","));print("M,\(row.through),"+detector.logMel.map{String($0)}.joined(separator:","))};rows+=1}
 if let o=onset{print("O,\(o.sourceFrame),\(o.analyzedThroughFrame),\(o.flux),\(o.threshold)")}
}
print("S,\(detector.windowFrames),\(detector.hopFrames),\(detector.processedThroughFrame),\(detector.reliableFromFrame),\(detector.receivedThroughFrame)")
