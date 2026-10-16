import { useEffect, useState } from 'react'
import type { DecodedImportAudio } from './audio-import'
import type { DetectorSettings } from './detector-contract'
import { OnsetDetector, type DetectedOnset } from './onset-detector'

/** Analyze from source zero, yielding between chunks so tuning stays interactive. */
export function useImportDetections(audio: DecodedImportAudio | null, settings: DetectorSettings) {
  const [result, setResult] = useState<{ audio: DecodedImportAudio; settings: DetectorSettings; hits: DetectedOnset[] } | null>(null)
  useEffect(() => {
    if (!audio) return
    const detector = new OnsetDetector(settings), hits: DetectedOnset[] = []
    let offset = 0, cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const step = () => {
      if (cancelled) return
      const end = Math.min(audio.samples.length, offset + 32768)
      hits.push(...detector.process(audio.samples.subarray(offset, end), offset / audio.sampleRate, audio.sampleRate))
      detector.drainDiagnostics()
      offset = end
      if (offset < audio.samples.length) timer = setTimeout(step, 0)
      else setResult({ audio, settings, hits })
    }
    timer = setTimeout(step, 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [audio, settings])
  const current = result?.audio === audio && result.settings === settings
  return { hits: current ? result.hits : [], pending: Boolean(audio) && !current }
}
