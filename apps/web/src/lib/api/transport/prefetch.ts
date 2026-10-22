import { adminSessionHeaders } from '../../admin-session'
import { fetchApi } from './request'
import { getCsrfToken } from './session'

const reads = new Map<string, { at: number; pending: Promise<unknown> }>()
const MAX_AGE_MS = 30_000

function keyFor(path: string): string | null {
  const csrf = getCsrfToken()
  return csrf ? JSON.stringify([path, adminSessionHeaders(), csrf]) : null
}

/** 確認済みの認証世代でだけ先読みし、最初の利用者へ一度だけ渡す。 */
export function prefetchApiRead(path: string): void {
  const key = keyFor(path)
  if (!key) return
  const now = Date.now()
  for (const [oldKey, value] of reads) if (now - value.at >= MAX_AGE_MS) reads.delete(oldKey)
  if (reads.has(key)) return
  const pending = fetchApi<{ success: boolean }>(path)
  reads.set(key, { at: now, pending })
  const forget = () => { if (reads.get(key)?.pending === pending) reads.delete(key) }
  void pending.then((response) => { if (!response.success) forget() }, forget)
}

export function fetchPrefetchedRead<T>(path: string): Promise<T> {
  const key = keyFor(path)
  const entry = key ? reads.get(key) : undefined
  if (key) reads.delete(key)
  if (!entry || Date.now() - entry.at >= MAX_AGE_MS) return fetchApi<T>(path)
  return (entry.pending as Promise<T>).then((response) => structuredClone(response))
}

export function clearPrefetchedReads(): void { reads.clear() }
