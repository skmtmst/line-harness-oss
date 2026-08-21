export const ADMIN_SESSION_STORAGE_KEY = 'lh_admin_session_fallback'
export const TWO_FACTOR_CHALLENGE_STORAGE_KEY = 'lh_two_factor_challenge'

export function storeAdminSession(sessionToken: string, csrfToken?: string): void {
  if (typeof window === 'undefined' || !sessionToken) return
  sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, sessionToken)
  if (csrfToken) localStorage.setItem('lh_csrf', csrfToken)
}

export function captureAdminSessionHandoff(): string {
  if (typeof window === 'undefined') return ''

  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const sessionToken = params.get('lh_session') || ''
  const csrfToken = params.get('lh_csrf') || ''
  if (!sessionToken) return getAdminSessionToken()

  storeAdminSession(sessionToken, csrfToken)
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  return sessionToken
}

export function captureTwoFactorChallenge(): string {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const token = params.get('lh_2fa') || ''
  if (token) {
    sessionStorage.setItem(TWO_FACTOR_CHALLENGE_STORAGE_KEY, token)
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  }
  return token || sessionStorage.getItem(TWO_FACTOR_CHALLENGE_STORAGE_KEY) || ''
}

export function clearTwoFactorChallenge(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(TWO_FACTOR_CHALLENGE_STORAGE_KEY)
}

export function getAdminSessionToken(): string {
  if (typeof window === 'undefined') return ''
  return sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) || ''
}

export function adminSessionHeaders(): Record<string, string> {
  const token = getAdminSessionToken()
  return token ? { Authorization: `Bearer lh_session:${token}` } : {}
}

export function clearAdminSession(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
}
