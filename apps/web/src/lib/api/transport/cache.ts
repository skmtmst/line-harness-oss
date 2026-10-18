import { responseApiError } from './errors'
import { getCsrfToken, API_URL } from './session'
import { fetchApi } from './request'
import { adminSessionHeaders } from '../../admin-session'
import { fetchWithNetworkMessage, extractApiErrorCode } from './errors'

const sharedReads = new Map<string, Promise<unknown>>()

/** 同時に出る請求表示だけ共有する。完了後は捨て、保存後の読み直しは必ず通信する。 */
export function fetchSharedRead<T>(path: string): Promise<T> {
  const csrf = getCsrfToken()
  // Cookie だけでセッションの世代が分からない場合は共有しない。
  if (!csrf) return fetchApi<T>(path)
  const key = JSON.stringify([path, adminSessionHeaders(), csrf])
  let pending = sharedReads.get(key)
  if (!pending) {
    pending = fetchApi<T>(path)
    sharedReads.set(key, pending)
    const forget = () => { if (sharedReads.get(key) === pending) sharedReads.delete(key) }
    pending.then(forget, forget)
  }
  // 呼び出し側で表示用に並べ替え・加工しても、もう一方の表示へ伝えない。
  return (pending as Promise<T>).then((response) => structuredClone(response))
}

/**
 * よく開く一覧の取り方（前のデータをすぐ出して裏で取り直す用）。
 *
 * - readCachedList：覚えている分だけすぐ返す（無いときは null）。画面はこちらを先に出す。
 * - refreshCachedList：ETag を付けて取り直す。変わっていなければ 304 で覚えていた分を返す。
 * 覚えるのは本文と ETag だけ。秘密値・個人情報を鍵や値に混ぜない（path をそのまま鍵にする）。
 */
const listCache = new Map<string, { etag: string | null; body: unknown }>()

export function readCachedList<T>(path: string): T | null {
  return (listCache.get(path)?.body ?? null) as T | null
}

export async function refreshCachedList<T>(path: string): Promise<T> {
  const cached = listCache.get(path)
  const headers: Record<string, string> = { ...adminSessionHeaders() }
  if (cached?.etag) headers['If-None-Match'] = cached.etag
  const res = await fetchWithNetworkMessage(`${API_URL}${path}`, {
    credentials: 'include',
    headers,
  })
  if (res.status === 304 && cached) return cached.body as T
  if (!res.ok) {
    const raw = await res.text()
    throw responseApiError(res, raw, extractApiErrorCode(raw), undefined)
  }
  const body = (await res.json()) as T
  listCache.set(path, { etag: res.headers.get('ETag'), body })
  return body
}
