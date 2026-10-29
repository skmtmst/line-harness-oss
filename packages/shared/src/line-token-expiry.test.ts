import { expect, it } from 'vitest'
import { lineTokenExpiry } from './line-token-expiry.js'

it('期限だけを判定し、空値・日本時間・境界を区別する', () => {
  const now = Date.parse('2026-10-27T00:00:00Z')
  expect(lineTokenExpiry('2026-11-10T00:00:00Z', now).status).toBe('expiring')
  expect(lineTokenExpiry(null, now).status).toBe('unknown')
  expect(lineTokenExpiry('invalid', now).status).toBe('unknown')
  expect(lineTokenExpiry('2026-10-27T09:00:00', now).status).toBe('expired')
  expect(lineTokenExpiry('2026-10-27T09:00:01+09:00', now).status).toBe('expiring')
  expect(lineTokenExpiry('2026-11-11T00:00:00Z', now).status).toBe('valid')
})
