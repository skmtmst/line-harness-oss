export const ADMIN_SESSION_STORAGE_KEY = 'lh_admin_session_fallback'
export const TWO_FACTOR_CHALLENGE_STORAGE_KEY = 'lh_two_factor_challenge'
const TWO_FACTOR_NEXT_STORAGE_KEY = 'lh_2fa_next'
const TWO_FACTOR_METHOD_STORAGE_KEY = 'lh_2fa_method'
let runtimeAdminSessionToken = ''

function readSessionStorage(key: string): string | null {
  try { return sessionStorage.getItem(key) } catch { return null }
}

function writeSessionStorage(key: string, value: string): void {
  try { sessionStorage.setItem(key, value) } catch { /* URL handoff / memory fallback is used */ }
}

function removeSessionStorage(key: string): void {
  try { sessionStorage.removeItem(key) } catch { /* already unavailable */ }
}

/**
 * 運営コンソールから始めた二段階認証かを、URL と一時保存の両方から判定する。
 *
 * `next=ops` は秘密ではないので query に残してよい。シークレットモードでは
 * タブをまたぐ Cookie / storage の扱いが通常モードより厳しいため、URL を正本に
 * して、従来の hash と sessionStorage は後方互換として残す。
 */
export function isOpsTwoFactorReturn(
  search: string,
  hash: string,
  storedNext: string | null,
): boolean {
  const query = new URLSearchParams(search.replace(/^\?/, ''))
  const fragment = new URLSearchParams(hash.replace(/^#/, ''))
  return query.get('next') === 'ops' || fragment.get('lh_next') === 'ops' || storedNext === 'ops'
}

export function storeAdminSession(sessionToken: string, csrfToken?: string): void {
  if (typeof window === 'undefined' || !sessionToken) return
  runtimeAdminSessionToken = sessionToken
  writeSessionStorage(ADMIN_SESSION_STORAGE_KEY, sessionToken)
  if (csrfToken) {
    try { localStorage.setItem('lh_csrf', csrfToken) } catch { /* session auth still works */ }
  }
}

/**
 * Cross-site cookie が使えない構成では、最初の画面遷移にも不透明な session を渡す。
 * fragment はサーバーログや Referer に送られず、到着直後に captureAdminSessionHandoff が消す。
 */
export function adminSessionHandoffPath(path: string, sessionToken?: string, csrfToken?: string): string {
  if (!sessionToken) return path
  const hash = new URLSearchParams({ lh_session: sessionToken })
  if (csrfToken) hash.set('lh_csrf', csrfToken)
  return `${path}#${hash.toString()}`
}

export function captureAdminSessionHandoff(): string {
  if (typeof window === 'undefined') return ''

  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const sessionToken = params.get('lh_session') || ''
  const csrfToken = params.get('lh_csrf') || ''
  if (!sessionToken) return getAdminSessionToken()

  storeAdminSession(sessionToken, csrfToken)
  try { window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`) } catch { /* cosmetic only */ }
  return sessionToken
}

export function captureTwoFactorChallenge(): string {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const token = params.get('lh_2fa') || ''
  // 運営コンソール（/ops）から来たときは、認証のあと /ops へ戻す（★V6 37-1）。
  if (isOpsTwoFactorReturn(window.location.search, window.location.hash, null)) {
    writeSessionStorage(TWO_FACTOR_NEXT_STORAGE_KEY, 'ops')
  }
  if (token) {
    writeSessionStorage(TWO_FACTOR_CHALLENGE_STORAGE_KEY, token)
    try { window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`) } catch { /* cosmetic only */ }
  }
  return token || readSessionStorage(TWO_FACTOR_CHALLENGE_STORAGE_KEY) || ''
}

/** 2 要素認証のあとの戻り先。'/ops' か '/'。読んだら消す。 */
export function takeTwoFactorNextPath(): string {
  if (typeof window === 'undefined') return '/'
  const next = readSessionStorage(TWO_FACTOR_NEXT_STORAGE_KEY)
  removeSessionStorage(TWO_FACTOR_NEXT_STORAGE_KEY)
  return isOpsTwoFactorReturn(window.location.search, window.location.hash, next) ? '/ops' : '/'
}

export function clearTwoFactorChallenge(): void {
  if (typeof window === 'undefined') return
  removeSessionStorage(TWO_FACTOR_CHALLENGE_STORAGE_KEY)
  removeSessionStorage(TWO_FACTOR_METHOD_STORAGE_KEY)
}

/** 二段階認証へ進んだときのログイン方法。 */
export type TwoFactorMethod = 'password' | 'line'

/*
 * R507: 二段階認証の画面で出すログイン方法。
 *
 * 合言葉の受け渡し（#lh_2fa=）と同じ便で `lh_method=password` が来たときだけ
 * メール経路。LINE経路のサーバー側リダイレクトには付かないので、
 * 印が無いときはLINE経路とみなす。再読込では保存した値を読む
 * （合言葉と同じく、その場の便が正本）。
 */
export function captureTwoFactorMethod(): TwoFactorMethod {
  if (typeof window === 'undefined') return 'line'
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  if (params.get('lh_2fa')) {
    const method: TwoFactorMethod = params.get('lh_method') === 'password' ? 'password' : 'line'
    try { sessionStorage.setItem(TWO_FACTOR_METHOD_STORAGE_KEY, method) } catch { /* 合言葉と同じ扱い */ }
    return method
  }
  try { return sessionStorage.getItem(TWO_FACTOR_METHOD_STORAGE_KEY) === 'password' ? 'password' : 'line' }
  catch { return 'line' }
}

export function getAdminSessionToken(): string {
  if (typeof window === 'undefined') return ''
  return readSessionStorage(ADMIN_SESSION_STORAGE_KEY) || runtimeAdminSessionToken
}

export function adminSessionHeaders(tokenOverride?: string): Record<string, string> {
  const token = tokenOverride || getAdminSessionToken()
  return token ? { Authorization: `Bearer lh_session:${token}` } : {}
}

export function clearAdminSession(): void {
  if (typeof window === 'undefined') return
  runtimeAdminSessionToken = ''
  removeSessionStorage(ADMIN_SESSION_STORAGE_KEY)
}
