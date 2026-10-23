import { fetchApi } from './request'
import { getCsrfToken } from './session'
import { clearApiReadCache } from './read-cache'

/** 本人情報の先読みも、通常の GET と同じ認証・失効・期限で共有する。 */
export function prefetchApiRead(path: string): void {
  if (!getCsrfToken()) return
  void fetchApi(path).catch(() => undefined)
}

/** 既存の呼出元の互換口。利用後も短い期限までは同じ答えを使う。 */
export function fetchPrefetchedRead<T>(path: string): Promise<T> {
  return fetchApi<T>(path)
}

export function clearPrefetchedReads(): void { clearApiReadCache() }
