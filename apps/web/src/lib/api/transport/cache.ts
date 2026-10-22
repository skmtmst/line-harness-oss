import { responseApiError } from './errors'
import { API_URL, apiReadScope } from './session'
import { fetchApi } from './request'
import { adminSessionHeaders } from '../../admin-session'
import { fetchWithNetworkMessage, extractApiErrorCode } from './errors'
import { apiReadCacheGeneration, canonicalApiPath, synchronizeApiReadScope } from './read-cache'

/** 互換口。取得中の共有と短い再利用は共通の GET 処理が所有する。 */
export function fetchSharedRead<T>(path: string): Promise<T> {
  return fetchApi<T>(path)
}

/**
 * よく開く一覧の取り方（前のデータをすぐ出して裏で取り直す用）。
 *
 * - readCachedList：覚えている分だけすぐ返す（無いときは null）。画面はこちらを先に出す。
 * - refreshCachedList：ETag を付けて取り直す。変わっていなければ 304 で覚えていた分を返す。
 * 本文と ETag はタブ内だけ。通常の GET と同じ認証・店舗・失効の世代で区別する。
 */
const listCache = new Map<string, { etag: string | null; body: unknown }>()
let listGeneration = -1

function listCacheKey(path: string): string {
  const scope = apiReadScope()
  synchronizeApiReadScope(scope.key)
  const generation = apiReadCacheGeneration()
  if (listGeneration !== generation || !scope.identified) listCache.clear()
  listGeneration = generation
  return JSON.stringify([scope.key, generation, canonicalApiPath(path)])
}

export function readCachedList<T>(path: string): T | null {
  return structuredClone(listCache.get(listCacheKey(path))?.body ?? null) as T | null
}

export async function refreshCachedList<T>(path: string): Promise<T> {
  const key = listCacheKey(path)
  const cached = listCache.get(key)
  // 明示の再検証が失敗したら、前の成功を新しい答えとして残さない。
  listCache.delete(key)
  const headers: Record<string, string> = { ...adminSessionHeaders() }
  if (cached?.etag) headers['If-None-Match'] = cached.etag
  const res = await fetchWithNetworkMessage(`${API_URL}${path}`, {
    credentials: 'include',
    headers,
  })
  if (res.status === 304 && cached) {
    if (key === listCacheKey(path)) listCache.set(key, cached)
    return structuredClone(cached.body) as T
  }
  if (!res.ok) {
    const raw = await res.text()
    throw responseApiError(res, raw, extractApiErrorCode(raw), undefined)
  }
  const body = (await res.json()) as T
  const failed = body && typeof body === 'object' && 'success' in body && body.success === false
  if (!failed && key === listCacheKey(path)) listCache.set(key, { etag: res.headers.get('ETag'), body })
  return structuredClone(body)
}
