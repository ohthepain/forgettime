import { z } from 'zod'
import { MAX_SIDECAR_BYTES, type BarFiles } from './bar-files'
import { MAX_AUDIO_FILE_BYTES } from './wav'
export const MAX_SAVED_BARS = 100
export const MAX_LIBRARY_BYTES = 256 * 1024 * 1024
export interface SavedBarSummary { id: string; name: string; createdAt: number; bpm: number; complete: boolean; bytes: number }
export interface SavedBarRecord extends SavedBarSummary, BarFiles {}
/** save resolves only after the complete pair and its list entry are durably committed. */
export interface SavedBarRepository { list(): Promise<SavedBarSummary[]>; read(id: string): Promise<SavedBarRecord>; save(record: SavedBarRecord): Promise<void> }
export interface BarFileOptions { savedBars?: SavedBarRepository; exportFile?: (name: string, bytes: ArrayBuffer | string, mime: string) => Promise<void> }
const summarySchema = z.strictObject({ id: z.string().min(1).max(128), name: z.string().min(1).max(255), createdAt: z.number().finite().nonnegative(), bpm: z.number().min(30).max(300), complete: z.boolean(), bytes: z.number().int().positive().max(MAX_AUDIO_FILE_BYTES + MAX_SIDECAR_BYTES) })
export function createBrowserSavedBars(factory: IDBFactory = indexedDB): SavedBarRepository {
  const connect = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('forgettime-saved-bars', 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('bars', { keyPath: 'id' }); request.result.createObjectStore('index', { keyPath: 'id' }) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Close other Forgettime tabs to open saved bars.'))
  })
  async function read<T>(store: string, id?: string): Promise<T> {
    const db = await connect()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly'), request = id === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(id)
      tx.oncomplete = () => { db.close(); request.result === undefined ? reject(new Error('Saved bar is missing.')) : resolve(request.result) }
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Saved bar could not be read.')) }
    })
  }
  return {
    list: async () => summarySchema.array().max(MAX_SAVED_BARS).parse(await read<unknown>('index')),
    read: async id => {
      const record = await read<SavedBarRecord>('bars', id)
      const { wav, sidecar, ...summary } = record
      summarySchema.parse(summary)
      if (!(wav instanceof ArrayBuffer) || typeof sidecar !== 'string' || wav.byteLength > MAX_AUDIO_FILE_BYTES || sidecar.length > MAX_SIDECAR_BYTES || summary.bytes !== wav.byteLength + new TextEncoder().encode(sidecar).length) throw new Error('Saved bar is malformed or incomplete.')
      return record
    },
    save: async record => {
      const { wav: _wav, sidecar: _sidecar, ...summary } = record
      summarySchema.parse(summary)
      const sidecarBytes = new TextEncoder().encode(record.sidecar).length
      if (record.wav.byteLength > MAX_AUDIO_FILE_BYTES || sidecarBytes > MAX_SIDECAR_BYTES || record.bytes !== record.wav.byteLength + sidecarBytes) throw new Error('Saved bar exceeds supported file limits.')
      const db = await connect()
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['bars', 'index'], 'readwrite'), request = tx.objectStore('index').getAll()
        let failure: Error | null = null
        request.onsuccess = () => {
          const entries = request.result as SavedBarSummary[]
          if (entries.length >= MAX_SAVED_BARS || entries.reduce((sum, entry) => sum + entry.bytes, 0) + record.bytes > MAX_LIBRARY_BYTES) {
            failure = new Error('Saved bars limit reached (100 bars / 256 MiB). Download your files before deliberately clearing browser storage.'); tx.abort(); return
          }
          const { wav, sidecar, ...summary } = record
          tx.objectStore('bars').add({ ...summary, wav, sidecar }); tx.objectStore('index').add(summary)
        }
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onabort = () => { db.close(); reject(failure ?? tx.error ?? new Error('Local save was aborted. No saved bar was added.')) }
      })
    },
  }
}
export async function requestBrowserDownload(name: string, bytes: ArrayBuffer | string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  try {
    const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove()
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
