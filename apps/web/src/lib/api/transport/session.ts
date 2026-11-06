import { clearApiReadCache } from './read-cache'
import { adminSessionHeaders } from '../../admin-session'
export const API_URL = process.env.NEXT_PUBLIC_API_URL

if (!API_URL) {
  throw new Error(
    'NEXT_PUBLIC_API_URL is not set. Build cannot proceed without a valid API URL. ' +
    'Set it in .env.production (local) or GitHub Secrets (CI).'
  )
}

export const CSRF_STORAGE_KEY = 'lh_csrf'

/** 機能設定でオフになっている API を開いたとき、共通 shell へ知らせる合図。 */
export const FEATURE_DISABLED_EVENT = 'lh-feature-disabled'

export function getCsrfToken(): string {
  if (typeof window === 'undefined') return ''
  /*
   * localStorage が無い・触れない環境（Cookie無効のブラウザや一部の試験環境）
   * ではアクセス自体が投げる。トークン無し＝通常の認証失敗と同じ扱いなので、
   * ここでは握りつぶして '' を返す。
   */
  try {
    return localStorage.getItem(CSRF_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function setCsrfToken(token: string | undefined | null): void {
  if (typeof window === 'undefined' || !token) return
  if (getCsrfToken() !== token) clearApiReadCache()
  try {
    localStorage.setItem(CSRF_STORAGE_KEY, token)
  } catch { /* 保存できなくてもセッション認証自体は動く */ }
}

/** 認証情報はメモリ上のキーにだけ使い、保存・ログ出力はしない。 */
export function apiReadScope(): { key: string; identified: boolean } {
  let account: string | null = null
  try { account = localStorage.getItem('lh_selected_account') } catch { /* 保存できない環境は明示された対象で区別する。 */ }
  const csrf = getCsrfToken()
  const headers = adminSessionHeaders()
  return { key: JSON.stringify([csrf, headers, account]), identified: Boolean(csrf || headers.Authorization) }
}

export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
