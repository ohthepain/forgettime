import { useCallback, useEffect, useRef, useState } from 'react'
import type { ResolvedHit } from './engine'

/**
 * Capture time controls measurement; the CSS animation controls presentation.
 * Retaining mounted marks prevents delayed audio frames from shortening a line's
 * full one-second fade. `active` becomes false when its reference is cleared.
 */
export function usePresentedHits(incoming: ResolvedHit[], active: boolean) {
  const [hits, setHits] = useState<ResolvedHit[]>([])
  const seen = useRef(new Set<number>())
  const cleanupTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const removeHit = useCallback((id: number) => {
    const timer = cleanupTimers.current.get(id)
    if (timer !== undefined) clearTimeout(timer)
    cleanupTimers.current.delete(id)
    setHits(current => current.filter(hit => hit.id !== id))
  }, [])

  useEffect(() => {
    if (!active) {
      seen.current.clear()
      cleanupTimers.current.forEach(clearTimeout)
      cleanupTimers.current.clear()
      setHits(current => current.length ? [] : current)
      return
    }
    const added = incoming.filter(hit => !hit.uncertain && hit.errorMs !== null && !seen.current.has(hit.id))
    if (!added.length) return
    for (const hit of added) {
      seen.current.add(hit.id)
      // A safety cleanup only: CSS reaches opacity zero at exactly one second;
      // normal removal occurs on animationend. This cannot truncate that fade.
      cleanupTimers.current.set(hit.id, setTimeout(() => removeHit(hit.id), 2000))
    }
    setHits(current => [...current, ...added])
  }, [incoming, active, removeHit])

  useEffect(() => () => {
    cleanupTimers.current.forEach(clearTimeout)
    cleanupTimers.current.clear()
  }, [])

  return { hits, removeHit }
}
