import { api } from './api'
import { FEATURE_SETTINGS_UPDATED_EVENT } from './feature-settings-event'

/*
 * 画面を移るたびに取り直していた共通のものを、タブ内で使い回す。
 *
 * 対象: /api/settings/features（機能設定の全体）。サイドバー（統括・管理者
 * の並び順）と機能設定画面と導入ガイドのカードが、同じアカウントの同じ
 * 答えを別々に取りに行っていた。表示可否だけの visibility ではなく、
 * 並び順まで要る側の共有口がこれ（visibility は feature-visibility-cache）。
 *
 * 約束:
 * - 同時の要求は1本に相乗りさせる（取得中の Promise を共有する）
 * - 取れた答えは SHARE_MS のあいだ使い回す。失敗は覚えない（次は取り直す）
 * - 機能設定を保存した合図（FEATURE_SETTINGS_UPDATED_EVENT）で必ず捨てる
 * - ログアウト・セッション切れの後は捨てる（別人の設定を見せない）
 * - 表示の出し分けと並び順にだけ使う。保存の可否はサーバ側（今までどおり）
 */

const SHARE_MS = 30_000

type FeatureSettingsResponse = Awaited<ReturnType<typeof api.featureSettings.get>>

const entries = new Map<string, { at: number; promise: Promise<FeatureSettingsResponse> }>()

export function loadFeatureSettings(accountId: string): Promise<FeatureSettingsResponse> {
  const now = Date.now()
  const hit = entries.get(accountId)
  if (hit && now - hit.at < SHARE_MS) return hit.promise
  const promise = api.featureSettings.get(accountId)
  entries.set(accountId, { at: now, promise })
  // 失敗は覚えない。取れなかった設定を使い回すと、復旧後もメニューが出ないまま残る。
  const forget = () => {
    if (entries.get(accountId)?.promise === promise) entries.delete(accountId)
  }
  promise.then((res) => {
    if (!res.success) forget()
  }, forget)
  return promise
}

/** 機能設定を変えた・ログアウトした・試験でやり直すときに捨てる。accountId を省くと全部。 */
export function clearFeatureSettingsCache(accountId?: string): void {
  if (accountId) entries.delete(accountId)
  else entries.clear()
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener(FEATURE_SETTINGS_UPDATED_EVENT, (event) => {
    const accountId = (event as CustomEvent<{ accountId?: string }>).detail?.accountId
    clearFeatureSettingsCache(accountId || undefined)
  })
}
