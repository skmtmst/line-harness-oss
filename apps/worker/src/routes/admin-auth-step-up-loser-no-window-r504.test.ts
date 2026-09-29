import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index.js'
import { sha256Hex } from '../middleware/auth.js'
import { hashPassword } from '../services/password-hash.js'
import { createTestD1 } from '../test-utils/d1-sqlite.js'

const grantMock = vi.hoisted(() => ({
  createStepUpGrant: vi.fn(),
  realCreateStepUpGrant: null as null | ((...args: never[]) => Promise<boolean>),
}))
vi.mock('@line-crm/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@line-crm/db')>()
  grantMock.realCreateStepUpGrant = real.createStepUpGrant as (...args: never[]) => Promise<boolean>
  return {
    ...real,
    createStepUpGrant: (...args: never[]) => grantMock.createStepUpGrant(...args),
  }
})

const { adminAuth } = await import('./admin-auth.js')

/*
 * 監査 R504: 同じ認証コードの並行要求で負けた側（確認票の発行に失敗し
 * 409「使用済み」）のセッションにも、本人確認済みの10分窓が付いていた。
 *
 * 確認票の発行に成功した要求だけを本人確認済みにする。失敗応答の
 * セッションには確認済み時刻を残さず、確認票なしの重要操作は428のまま。
 */

const NOW = '2026-09-08T01:00:00.000Z'
const LATER = '2026-09-08T09:00:00.000Z'
const PASSWORD = 'correct-horse-99'
let testDb: ReturnType<typeof createTestD1>

function app() {
  const instance = new Hono<Env>()
  instance.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: 'Staff One', role: 'admin', readOnly: false })
    await next()
  })
  instance.route('/', adminAuth)
  return instance
}

function bindings(): Env['Bindings'] {
  return { DB: testDb.db } as Env['Bindings']
}

function bearer(token: string) {
  return { Authorization: `Bearer lh_session:${token}` }
}

function stepUpAt(tokenHash: string) {
  return (testDb.raw.prepare(
    `SELECT step_up_at AS v FROM admin_sessions WHERE token_hash = ?`,
  ).get(tokenHash) as { v: string | null }).v
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
  testDb = createTestD1()
  testDb.raw.prepare(
    `INSERT INTO staff_members (id, name, email, role, api_key, is_active, password_hash) VALUES ('staff-1', 'Staff One', 's1@example.com', 'admin', 's1-key', 1, ?)`,
  ).run(await hashPassword(PASSWORD))
  testDb.raw.prepare(
    `INSERT INTO admin_sessions (token_hash, staff_id, expires_at, created_at) VALUES (?, 'staff-1', ?, ?)`,
  ).run(await sha256Hex('session-loser'), LATER, NOW)
  grantMock.createStepUpGrant.mockReset()
  grantMock.createStepUpGrant.mockImplementation((...args: never[]) => grantMock.realCreateStepUpGrant!(...args))
})

afterEach(() => {
  testDb.raw.close()
  vi.useRealTimers()
})

describe('R504 確認票の発行に失敗したら本人確認済みにしない', () => {
  it('負けた側（409）のセッションには確認済み時刻を残さない', async () => {
    // 先勝者がコード確保を終えた状態を、確認票発行の失敗として再現する。
    grantMock.createStepUpGrant.mockResolvedValueOnce(false)
    const res = await app().request('/api/auth/step-up', {
      method: 'POST',
      headers: { ...bearer('session-loser'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD, purpose: 'staff.permissions.change' }),
    }, bindings())
    expect(res.status).toBe(409)
    expect(stepUpAt(await sha256Hex('session-loser'))).toBeNull()
  })

  it('勝った側（201）のセッションには確認済み時刻を残す', async () => {
    const res = await app().request('/api/auth/step-up', {
      method: 'POST',
      headers: { ...bearer('session-loser'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD, purpose: 'staff.permissions.change' }),
    }, bindings())
    expect(res.status).toBe(201)
    expect(stepUpAt(await sha256Hex('session-loser'))).toBe(NOW)
  })
})
