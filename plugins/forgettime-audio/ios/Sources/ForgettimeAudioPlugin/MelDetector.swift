import Foundation
// Experimental review-only mel-flux-v1. Does not replace live capture.
struct MelSettings {
 let windowMs: Int, bands: Int, neighbor: Int, confirmation: Int, rearming: Bool, threshold: Double
 init(windowMs: Int = 20, bands: Int = 48, neighbor: Int = 5, confirmation: Int = 1, rearming: Bool = true, threshold: Double = 2) throws {
  guard [10,20,40].contains(windowMs),[24,48,96].contains(bands),[1,3,5].contains(neighbor),(0...2).contains(confirmation),threshold.isFinite,threshold >= 0.5,threshold <= 4 else {throw MelError.invalid}
  self.windowMs=windowMs;self.bands=bands;self.neighbor=neighbor;self.confirmation=confirmation;self.rearming=rearming;self.threshold=threshold
 }
}
enum MelError: Error {case invalid, emptyFilter}
struct MelOnset {let sourceFrame:Double;let analyzedThroughFrame:Int64;let flux:Double;let threshold:Double}
struct MelRow {let center:Double;let through:Int64;let flux:Double;let threshold:Double;let ready:Bool}
final class MelDetector {
 static let version="mel-flux-v1"
 let settings:MelSettings
 private var rate=0,n=0,hop=0,historyLimit=0,cursor=0
 private var first:Int64=0,expected:Int64 = -1,seen:Int64=0,watermark:Int64=0
 private var pcm=[Double](),window=[Double](),real=[Double](),imaginary=[Double](),cosine=[Double](),sine=[Double]()
 private(set) var power=[Double](),logMel=[Double]()
 private var previous:[Double]?=nil,norm=0.0,last = -Double.infinity,armed=true
 private var bins=[[Int]](),weights=[[Double]](),history=[Double](),rows=[MelRow]()
 init(settings:MelSettings) {self.settings=settings}
 func reset(){n=0;hop=0;first=0;cursor=0;historyLimit=0;pcm=[];window=[];real=[];imaginary=[];cosine=[];sine=[];power=[];logMel=[];bins=[];weights=[];rate=0;expected = -1;seen=0;previous=nil;history=[];rows=[];armed=true;last = -Double.infinity;watermark=0}
 private func mel(_ f:Double)->Double {f<1000 ? f/(200.0/3) : 15+log(f/1000)/(log(6.4)/27)}
 private func hz(_ m:Double)->Double {m<15 ? m*(200.0/3) : 1000*exp((m-15)*(log(6.4)/27))}
 private func configure(_ r:Int,_ start:Int64)throws {
  reset();rate=r;first=start;expected=start;watermark=start
  n=max(128,min(8192,Int(pow(2,log2(Double(r)*Double(settings.windowMs)/1000).rounded()))));hop=max(1,Int((Double(r)*0.0025).rounded()));historyLimit=Int(ceil(Double(r)*0.1/Double(hop)));cursor=0
  pcm=Array(repeating:0,count:n);window=(0..<n).map{0.5-0.5*cos(2*Double.pi*Double($0)/Double(n-1))};let sum=window.reduce(0,+);norm=sum*sum
  real=Array(repeating:0,count:n);imaginary=real;power=Array(repeating:0,count:n/2+1);cosine=(0..<n/2).map{cos(-2*Double.pi*Double($0)/Double(n))};sine=(0..<n/2).map{sin(-2*Double.pi*Double($0)/Double(n))}
  let edges=(0..<settings.bands+2).map{hz(mel(30)+(mel(min(16000,Double(r)/2))-mel(30))*Double($0)/Double(settings.bands+1))}
  bins=[];weights=[]
  for b in 0..<settings.bands {var bi=[Int](),we=[Double]();for j in 0...n/2 {let f=Double(j)*Double(r)/Double(n);let w=max(0,min((f-edges[b])/(edges[b+1]-edges[b]),(edges[b+2]-f)/(edges[b+2]-edges[b+1])))*2/(edges[b+2]-edges[b]);if w>0 {bi.append(j);we.append(w)}};if bi.isEmpty{reset();throw MelError.emptyFilter};bins.append(bi);weights.append(we)}
  logMel=Array(repeating:0,count:settings.bands)
 }
 func process(sample:Float,frame:Int64,sampleRate:Int)throws ->MelOnset? {
  guard sample.isFinite,frame>=0,frame<9007199254740991,sampleRate>=8000,sampleRate<=192000 else {throw MelError.invalid}
  if rate != sampleRate || expected != frame {try configure(sampleRate,frame)}
  expected=frame+1;pcm[cursor]=Double(sample);cursor=(cursor+1)%n;seen+=1
  if seen<Int64(n) || (seen-Int64(n))%Int64(hop) != 0 {return nil}
  for i in 0..<n {real[i]=pcm[(cursor+i)%n]*window[i];imaginary[i]=0};fft()
  for j in 0..<power.count {power[j]=(real[j]*real[j]+imaginary[j]*imaginary[j])/norm}
  var flux=0.0
  for b in 0..<settings.bands {var energy=0.0;for j in 0..<bins[b].count {energy+=weights[b][j]*power[bins[b][j]]};let value=log1p(energy/1e-8);logMel[b]=value
   if let previous=previous {var reference=0.0;let half=settings.neighbor/2;for k in max(0,b-half)...min(settings.bands-1,b+half){reference=max(reference,previous[k])};flux+=max(0,value-reference)}}
  flux/=Double(settings.bands);previous=logMel
  var mean=0.0,variance=0.0;for v in history {mean+=v};mean/=Double(max(1,history.count));for v in history {variance+=(v-mean)*(v-mean)};variance/=Double(max(1,history.count))
  let row=MelRow(center:Double(frame)-Double(n)+1+Double(n-1)/2,through:frame+1,flux:flux,threshold:mean+settings.threshold*sqrt(variance)+0.005,ready:history.count==historyLimit)
  history.append(flux);if history.count>historyLimit{history.removeFirst()};rows.append(row);if rows.count>settings.confirmation+2{rows.removeFirst()}
  watermark=max(first,Int64(floor(row.center+Double((1-settings.confirmation)*hop))))
  let index=rows.count-1-settings.confirmation;if index<1{return nil};let candidate=rows[index]
  if candidate.ready && candidate.flux<=candidate.threshold {armed=true}
  var maximum=true;if index+1<rows.count{for j in index+1..<rows.count {if candidate.flux<=rows[j].flux{maximum=false}}}
  if candidate.ready && (!settings.rearming || armed) && candidate.flux>candidate.threshold && candidate.flux>rows[index-1].flux && maximum && candidate.center-last>=Double(rate)*0.018 {last=candidate.center;armed=false;return MelOnset(sourceFrame:candidate.center,analyzedThroughFrame:row.through,flux:candidate.flux,threshold:candidate.threshold)}
  return nil
 }
 private func fft(){var j=0;for i in 1..<n {var bit=n>>1;while j&bit != 0 {j ^= bit;bit >>= 1};j ^= bit;if i<j{let t=real[i];real[i]=real[j];real[j]=t}}
  var length=2;while length<=n {var base=0;while base<n {for j in 0..<length/2 {let at=j*n/length,u=base+j,v=u+length/2;let c=cosine[at],s=sine[at];let tr=real[v]*c-imaginary[v]*s,ti=real[v]*s+imaginary[v]*c;real[v]=real[u]-tr;imaginary[v]=imaginary[u]-ti;real[u]+=tr;imaginary[u]+=ti};base+=length};length*=2}}
 var latest:MelRow?{rows.last}
 var windowFrames:Int{n};var hopFrames:Int{hop};var processedThroughFrame:Int64{watermark};var receivedThroughFrame:Int64{max(0,expected)}
 var reliableFromFrame:Int64{rate == 0 ? 0 : Int64(floor(Double(first)+Double(n-1)/2+Double(historyLimit*hop)))}
}
