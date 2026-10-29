import { expect, it } from 'vitest'
import { hasLineConnectionProblem, lineAccountConnectionState, tokenExpiryNotice, tokenExpirySummary } from './line-account-state'

it('稼働中の要確認だけを問題として数え、未確認・停止中・アーカイブを混ぜない', () => {
  const warning = { isActive: true, connection: { status: 'warn' as const } }
  expect(hasLineConnectionProblem(warning)).toBe(true)
  for (const account of [{ ...warning, connection: undefined }, { ...warning, isActive: false }, { ...warning, archivedAt: '2026-10-01' }]) {
    expect(hasLineConnectionProblem(account)).toBe(false)
    expect(lineAccountConnectionState(account).tone).toBe('idle')
  }
})

const expiry = (status: 'unknown' | 'expired' | 'expiring' | 'valid') => ({ status, label: `期限:${status}`, daysLeft: null })

it('トークンの期限は切れた・近い時だけ行に出し、記録なし・余裕あり・アーカイブには出さない', () => {
  expect(tokenExpiryNotice({ tokenExpiry: expiry('expired') })).toBe('期限:expired')
  expect(tokenExpiryNotice({ tokenExpiry: expiry('expiring') })).toBe('期限:expiring')
  expect(tokenExpiryNotice({ tokenExpiry: expiry('unknown') })).toBeNull()
  expect(tokenExpiryNotice({ tokenExpiry: expiry('valid') })).toBeNull()
  expect(tokenExpiryNotice({ tokenExpiry: expiry('expired'), archivedAt: '2026-10-01' })).toBeNull()
})

it('帯の下の期限の1行は、接続とは別に数え、0件なら出さない', () => {
  expect(tokenExpirySummary([{ tokenExpiry: expiry('unknown') }, { tokenExpiry: expiry('valid') }])).toBeNull()
  expect(tokenExpirySummary([
    { tokenExpiry: expiry('expired') },
    { tokenExpiry: expiry('expired'), archivedAt: '2026-10-01' },
    { tokenExpiry: expiry('expiring') },
  ])).toBe('期限が切れたトークン 1 件・期限が近い 1 件')
})
