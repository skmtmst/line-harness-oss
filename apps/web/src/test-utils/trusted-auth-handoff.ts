import { twoFactorChallengeHandoffPath } from '@/lib/admin-session'

/** Existing UI tests model a successful local primary login before landing. */
export function trustedChallengeUrl(url: string): string {
  const parsed = new URL(url, 'https://test.invalid')
  const fragment = new URLSearchParams(parsed.hash.slice(1))
  const token = fragment.get('lh_2fa')
  if (!token) return url
  return twoFactorChallengeHandoffPath(`${parsed.pathname}${parsed.search}`, token, fragment.get('lh_method') === 'password' ? 'password' : 'line')
}
