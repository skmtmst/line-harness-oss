import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index.js'
import { sha256Hex } from '../middleware/auth.js'
import { encryptTotpSecret, totpAtStep } from '../lib/totp.js'
import { createTestD1 } from '../test-utils/d1-sqlite.js'

const mail = vi.hoisted(() => ({
  sendStaffInviteEmail: vi.fn(),
  sendStaffLineLinkEmail: vi.fn(),
}))
vi.mock('../services/staff-invite.js', () => mail)

const { staff } = await import('./staff.js')

const NOW = '2026-09-08T01:00:00.000Z'
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const MASTER_KEY = 'test-master-key-which-is-longer-than-32-characters'
const LIMIT_ERROR = '入力回数を超えました。しばらく待ってからやり直してください'
let testDb: ReturnType<typeof createTestD1>

function app() {
  const instance = new Hono<Env>()
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1', name: 'Staff One', role: 'admin', readOnly: false,
      permissionKeys: [],
    })
    await next()
  })
  instance.route('/', staff)
  return instance
}

function bindings(): Env['Bindings'] {
  return {
    DB: testDb.db,
    TOTP_ENCRYPTION_KEY: MASTER_KEY,
    ADMIN_PUBLIC_URL: 'https://admin.example.com',
  } as Env['Bindings']
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
  testDb = createTestD1()
  mail.sendStaffInviteEmail.mockReset()
  mail.sendStaffLineLinkEmail.mockReset()
  mail.sendStaffLineLinkEmail.mockResolvedValue(undefined)
})

afterEach(() => {
  testDb.raw.close()
  vi.useRealTimers()
})

describe('二段階認証の初回設定確認', () => {
  beforeEach(async () => {
    testDb.raw.prepare(
      `INSERT INTO staff_members
         (id, name, role, api_key, is_active, totp_pending_secret_enc)
       VALUES (?, ?, 'admin', ?, 1, ?)`,
    ).run('staff-1', 'Staff One', 'staff-1-key', await encryptTotpSecret(SECRET, MASTER_KEY))
  })

  async function confirm(code: string) {
    return app().request('/api/staff/staff-1/two-factor/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    }, bindings())
  }

  it('10分内の5回目の失敗から429で拒否する', async () => {
    const current = await totpAtStep(SECRET, Math.floor(Date.now() / 30_000))
    const invalid = current === '000000' ? '000001' : '000000'
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await confirm(invalid)).status).toBe(400)
    }
    const fifth = await confirm(invalid)
    expect(fifth.status).toBe(429)
    await expect(fifth.json()).resolves.toEqual({ success: false, error: LIMIT_ERROR })
    expect((await confirm(current)).status).toBe(429)
  })

  it('成功したら試行記録を消す', async () => {
    const response = await confirm(await totpAtStep(SECRET, Math.floor(Date.now() / 30_000)))
    expect(response.status).toBe(200)
    expect(testDb.raw.prepare(
      'SELECT * FROM staff_two_factor_setup_attempts WHERE staff_id = ?',
    ).get('staff-1')).toBeUndefined()
  })
})

describe('スタッフ招待の確定', () => {
  const TOKEN = 'invite-secret-token'

  beforeEach(async () => {
    testDb.raw.prepare(
      `INSERT INTO staff_members
         (id, name, email, role, api_key, is_active, invite_status, invite_token_hash, invite_expires_at)
       VALUES (?, ?, ?, 'staff', ?, 0, 'pending_email', ?, ?)`,
    ).run(
      'invitee-1', '招待された人', 'invitee@example.test', 'invitee-key',
      await sha256Hex(TOKEN), new Date(Date.now() + 60_000).toISOString(),
    )
  })

  it('旧GETリンクは状態を変えず確認画面へ302で送る', async () => {
    const response = await app().request(
      `/api/staff/invitations/${TOKEN}/verify`, {}, bindings(),
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`https://admin.example.com/staff/invite#invite=${TOKEN}`)
    expect(testDb.raw.prepare(
      'SELECT invite_status, email_verified_at FROM staff_members WHERE id = ?',
    ).get('invitee-1')).toEqual({ invite_status: 'pending_email', email_verified_at: null })
    expect(mail.sendStaffLineLinkEmail).not.toHaveBeenCalled()
  })

  it('POST本文のトークンでだけ確定してLINE連携メールを送る', async () => {
    const response = await app().request('/api/staff/invitations/confirm/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: TOKEN }),
    }, bindings())
    expect(response.status).toBe(200)
    expect(testDb.raw.prepare(
      'SELECT invite_status FROM staff_members WHERE id = ?',
    ).get('invitee-1')).toEqual({ invite_status: 'pending_line' })
    expect(mail.sendStaffLineLinkEmail).toHaveBeenCalledOnce()
  })
})
