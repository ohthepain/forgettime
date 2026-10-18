import { describe, expect, it } from 'vite-plus/test'
import { canonicalTrainingPcm, createTrainingSource, encodeTrainingManifest, parseTrainingManifest, reviseTrainingAnnotations, trainingBarFrames, trainingCoverage, trainingEligible, trainingExampleId, trainingFingerprint, validateTrainingManifest, verifyTrainingSource, type TrainingManifest } from './training-contract'

async function fixture(): Promise<TrainingManifest> {
  const { source } = await createTrainingSource([new Float32Array(16000)], 8000, { kind: 'import', beginningAvailable: true, endAvailable: true })
  const bar = { startFrame: 0, endFrame: 16000 }
  return { format: 'forgettime-training', schemaVersion: 1, sources: [source], groups: [{ id: 'recording-1', sourceChecksums: [source.checksum], assignment: 'training' }], examples: [{ id: trainingExampleId(source.checksum, bar), sourceChecksum: source.checksum, bar, reference: { bpm: 120, beatOneFrame: 0, meter: [4,4] }, desiredFrames: [0,4000,8000,12000], uncertain: [], reviewed: true }] }
}
describe('canonical training PCM', () => {
  it('defines exact little-endian framing and preserves finite Float32 including signed zero and overrange', async () => {
    const pcm = new Float32Array([-0, 1.25, -.5])
    const canonical = canonicalTrainingPcm([pcm], 48000)
    const v = new DataView(canonical.bytes)
    expect(new TextDecoder().decode(canonical.bytes.slice(0,8))).toBe('FTPCM001')
    expect(v.getUint32(8,true)).toBe(48000)
    expect(v.getBigUint64(16,true)).toBe(3n)
    expect(Object.is(v.getFloat32(24,true), -0)).toBe(true)
    expect(v.getFloat32(28,true)).toBe(1.25)
    const a = await createTrainingSource([pcm],48000,{kind:'capture',name:'first',beginningAvailable:true,endAvailable:true})
    const b = await createTrainingSource([pcm.slice()],48000,{kind:'import',name:'renamed',beginningAvailable:true,endAvailable:true})
    expect(a.source.checksum).toBe('2efbcfe00bba8c40ea5a9986619f95f5dfa5f8e35a294cf9dc26ff36efd95789')
    expect(a.source.checksum).toBe(b.source.checksum)
    await verifyTrainingSource(a.source, pcm)
    await expect(verifyTrainingSource(a.source, new Float32Array([0,1.25,-.5]))).rejects.toThrow('checksum')
    const rate = await createTrainingSource([pcm],44100,a.source.provenance)
    expect(rate.source.checksum).not.toBe(a.source.checksum)
    pcm[1]=0
    expect(a.samples[1]).toBe(1.25)
  })
  it('averages channels before Float32 rounding and rejects malformed PCM', () => {
    expect([...canonicalTrainingPcm([new Float32Array([1,3]), new Float32Array([-1,1])],48000).samples]).toEqual([0,2])
    for (const channels of [[], [new Float32Array()], [new Float32Array([NaN])], [new Float32Array([Infinity])], [new Float32Array(2),new Float32Array(1)]]) expect(()=>canonicalTrainingPcm(channels,48000)).toThrow()
    expect(()=>canonicalTrainingPcm([new Float32Array(1)],48000.5)).toThrow()
  })
})
describe('training manifest contract', () => {
  it('roundtrips exact annotation/source/group metadata without mutating input or losing provenance', async () => {
    const m=await fixture(),text=encodeTrainingManifest(m)
    expect(parseTrainingManifest(text)).toEqual(m)
    expect(m).toEqual(await fixture())
    expect(await trainingFingerprint(m)).toBe(await trainingFingerprint(JSON.parse(text)))
    const replacement=reviseTrainingAnnotations(m.examples[0],[1],[])
    expect(replacement.reviewed).toBe(false)
    expect(m.examples[0].reviewed).toBe(true)
    const edited=structuredClone(m);edited.examples[0].desiredFrames=[10];edited.examples[0].reviewed=false
    expect(await trainingFingerprint(edited)).not.toBe(await trainingFingerprint(m))
    expect(Object.keys(parseTrainingManifest(text).examples[0])).not.toContain('history')
  })
  it('rejects wrong versions, unknown fields, inconsistent identity, noninteger labels and unknown references', async () => {
    const m=await fixture()
    const mutations:((x:TrainingManifest)=>void)[]=[x=>{x.examples[0].id='wrong'},x=>{x.examples[0].reference.bpm=110},x=>{x.examples[0].desiredFrames=[.5]},x=>{x.examples[0].desiredFrames=[16000]},x=>{x.examples[0].desiredFrames=[4000,0]},x=>{x.examples[0].desiredFrames=[0,0]},x=>{x.sources.push(x.sources[0])},x=>{x.groups=[]},x=>{x.groups.push({...x.groups[0],id:'duplicate-source'})},x=>{x.examples[0].uncertain=[{startFrame:400,endFrame:300}]},x=>{x.examples[0].uncertain=[{startFrame:0,endFrame:300},{startFrame:200,endFrame:400}]},x=>{x.sources[0].provenance.ancestorStartFrame=0}]
    for(const mutate of mutations){const copy=structuredClone(m);mutate(copy);expect(()=>validateTrainingManifest(copy)).toThrow()}
    expect(()=>parseTrainingManifest(JSON.stringify({...m,schemaVersion:2}))).toThrow()
    expect(()=>validateTrainingManifest({...m,history:[]})).toThrow()
    expect(()=>validateTrainingManifest({...m,examples:[{...m.examples[0],reference:{...m.examples[0].reference,bpm:NaN}}]})).toThrow()
    expect(()=>parseTrainingManifest(' '.repeat(2*1024*1024+1))).toThrow('too large')
  })
  it('allows reviewed silence, preserves draft markers in uncertainty, and distinguishes partial audio', async () => {
    const m=await fixture(),e=m.examples[0],s=m.sources[0]
    e.desiredFrames=[]
    expect(trainingEligible(e,s)).toBe(true)
    e.reviewed=false;expect(trainingEligible(e,s)).toBe(false)
    e.reviewed=true;e.uncertain=[{startFrame:0,endFrame:16000}]
    expect(trainingEligible(e,s)).toBe(false)
    e.desiredFrames=[0];expect(validateTrainingManifest(m)).toEqual(m)
    e.uncertain=[];e.reference.bpm=96;e.reference.beatOneFrame=-4000;e.bar={startFrame:-4000,endFrame:16000};e.id=trainingExampleId(s.checksum,e.bar)
    expect(validateTrainingManifest(m)).toEqual(m)
    expect(trainingCoverage(e,s)).toMatchObject({startFrame:0,endFrame:16000,complete:false,beforeFrames:0})
    expect(trainingEligible(e,s)).toBe(false)
  })
  it('rounds musical boundaries independently without long-run drift',()=>{
    const first=trainingBarFrames(44100,110,.3,1000), next=trainingBarFrames(44100,110,.3,1001)
    expect(first.endFrame).toBe(next.startFrame)
    expect(first.startFrame).toBe(Math.round(.3+1000*44100*240/110))
    expect(()=>trainingBarFrames(48000,0,0,0)).toThrow()
  })
  it('deduplicates identity across reimports but distinguishes ranges and preserves explicit related-source grouping', async()=>{
    const m=await fixture(),e=m.examples[0]
    expect(trainingExampleId(e.sourceChecksum,e.bar)).toBe(e.id)
    expect(trainingExampleId(e.sourceChecksum,{startFrame:1,endFrame:16001})).not.toBe(e.id)
    const b=await createTrainingSource([new Float32Array([1])],8000,{kind:'import',ancestorChecksum:e.sourceChecksum,ancestorStartFrame:100,beginningAvailable:false,endAvailable:false})
    m.sources.push(b.source);m.groups[0].sourceChecksums.push(b.source.checksum)
    expect(parseTrainingManifest(encodeTrainingManifest(m)).groups[0].sourceChecksums).toHaveLength(2)
    const hash=await trainingFingerprint(m);m.sources.reverse();m.groups[0].sourceChecksums.reverse()
    expect(await trainingFingerprint(m)).toBe(hash)
    m.groups[0].sourceChecksums=m.groups[0].sourceChecksums.filter(x=>x!==b.source.checksum)
    m.groups.push({id:'leaky-excerpt',sourceChecksums:[b.source.checksum],assignment:'withheld'})
    expect(()=>validateTrainingManifest(m)).toThrow('recording group')
  })
})
