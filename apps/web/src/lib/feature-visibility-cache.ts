import { api } from './api'
import { FEATURE_SETTINGS_UPDATED_EVENT } from './feature-settings'

/*
 * V6R-S0-b: 機能の表示可否（/api/settings/features/visibility）をアカウントごとに共有する。
 *
 * 以前はサイドバーと useFeatureVisibility が別々に取りに行き、検証環境の実測で
 * ダッシュボード・友だち一覧・運用状態などが毎回2回ずつ呼んでいた。
 *
 * 約束:
 * - 同時の要求は1本に相乗りさせる（取得中の Promise を共有する）
 * - 取れた答えは SHARE_MS のあいだ使い回す。失敗は覚えない（次は取り直す）
 * - 機能設定を保存した合図（FEATURE_SETTINGS_UPDATED_EVENT）で必ず捨てる
 * - 表示の出し分けにだけ使う。機能のオン・オフの強制はサーバ側（今までどおり）
 */
const SHARE_MS = 30_000

type VisibilityResponse = Awaited<ReturnType<typeof api.featureSettings.visibility>>

const entries = new Map<string, { at: number; promise: Promise<VisibilityResponse> }>()

export function loadFeatureVisibility(accountId: string): Promise<VisibilityResponse> {
  const now = Date.now()
  const hit = entries.get(accountId)
  if (hit && now - hit.at < SHARE_MS) return hit.promise
  const promise = api.featureSettings.visibility(accountId)
  entries.set(accountId, { at: now, promise })
  // 失敗は覚えない。取れなかった答えを30秒使い回すと、復旧後もメニューが出ないまま残る。
  const forget = () => { if (entries.get(accountId)?.promise === promise) entries.delete(accountId) }
  promise.then((res) => { if (!res.success) forget() }, forget)
  return promise
}

/** 機能設定を変えた・試験でやり直すときに捨てる。accountId を省くと全部。 */
export function clearFeatureVisibilityCache(accountId?: string): void {
  if (accountId) entries.delete(accountId)
  else entries.clear()
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener(FEATURE_SETTINGS_UPDATED_EVENT, (event) => {
    const accountId = (event as CustomEvent<{ accountId?: string }>).detail?.accountId
    clearFeatureVisibilityCache(accountId || undefined)
  })
}
