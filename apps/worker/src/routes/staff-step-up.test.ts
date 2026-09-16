import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index.js'
import { sha256Hex } from '../middleware/auth.js'
import { encryptTotpSecret } from '../lib/totp.js'
import { createTestD1 } from '../test-utils/d1-sqlite.js'

const mail = vi.hoisted(() => ({
  sendStaffInviteEmail: vi.fn(),
  sendStaffLineLinkEmail: vi.fn(),
}))
vi.mock('../services/staff-invite.js', () => mail)

const { staff } = await import('./staff.js')

const NOW = '2026-09-08T01:00:00.000Z'
const LATER = '2026-09-09T01:00:00.000Z'
const MASTER_KEY = 'test-master-key-which-is-longer-than-32-characters'
let testDb: ReturnType<typeof createTestD1>

function app() {
  const instance = new Hono<Env>()
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'admin-1', name: 'Admin One', role: 'admin', readOnly: false,
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

/** 期限付きのstep-up grantを直接埋め、呼び出しに使う生tokenを返す。 */
async function seedGrant(purpose: string, options: { expiresAt?: string; consumed?: boolean; staffId?: string } = {}) {
  const token = `grant-${crypto.randomUUID()}`
  testDb.raw.prepare(
    `INSERT INTO auth_step_up_grants (token_hash, staff_id, purpose, expires_at, consumed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    await sha256Hex(token),
    options.staffId ?? 'admin-1',
    purpose,
    options.expiresAt ?? LATER,
    options.consumed ? NOW : null,
    NOW,
  )
  return token
}

function patch(id: string, body: unknown, stepUpToken?: string) {
  return app().request(`/api/staff/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(stepUpToken ? { 'X-Step-Up-Token': stepUpToken } : {}),
    },
    body: JSON.stringify(body),
  }, bindings())
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
  testDb = createTestD1()
  mail.sendStaffInviteEmail.mockReset()
  mail.sendStaffLineLinkEmail.mockReset()
  testDb.raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, is_active) VALUES ('admin-1', 'Admin One', 'admin', 'admin-1-key', 1)`,
  ).run()
  testDb.raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, is_active, totp_secret_enc, totp_enabled_at)
     VALUES ('target-1', 'Target One', 'staff', 'target-1-key', 1, ?, ?)`,
  ).run(await encryptTotpSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', MASTER_KEY), NOW)
})

afterEach(() => {
  testDb.raw.close()
  vi.useRealTimers()
})

describe('PATCH /api/staff/:id の権限変更 step-up', () => {
  it('step-up無しの役割変更は428で、対象もセッションも変わらない', async () => {
    testDb.raw.prepare(
      `INSERT INTO admin_sessions (token_hash, staff_id, expires_at) VALUES ('t-1', 'target-1', ?)`,
    ).run(LATER)

    const res = await patch('target-1', { role: 'admin' })
    expect(res.status).toBe(428)
    expect((await res.json() as { code?: string }).code).toBe('STEP_UP_REQUIRED')
    // 書き込み前に止まるので権限も認証状態もそのまま
    expect(testDb.raw.prepare(`SELECT role FROM staff_members WHERE id = 'target-1'`).get()).toEqual({ role: 'staff' })
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS n FROM admin_sessions WHERE staff_id = 'target-1'`).get()).toEqual({ n: 1 })
  })

  it('用途の違うgrantでは拒否する', async () => {
    const token = await seedGrant('operations.control')
    const res = await patch('target-1', { role: 'admin' }, token)
    expect(res.status).toBe(428)
    expect(testDb.raw.prepare(`SELECT role FROM staff_members WHERE id = 'target-1'`).get()).toEqual({ role: 'staff' })
  })

  it('期限切れ・消費済みのgrantでは拒否する', async () => {
    const expired = await seedGrant('staff.permissions.change', { expiresAt: '2026-09-07T00:00:00.000Z' })
    expect((await patch('target-1', { role: 'admin' }, expired)).status).toBe(428)

    const consumed = await seedGrant('staff.permissions.change', { consumed: true })
    expect((await patch('target-1', { role: 'admin' }, consumed)).status).toBe(428)

    expect(testDb.raw.prepare(`SELECT role FROM staff_members WHERE id = 'target-1'`).get()).toEqual({ role: 'staff' })
  })

  it('他人のgrantでは拒否する', async () => {
    const token = await seedGrant('staff.permissions.change', { staffId: 'target-1' })
    expect((await patch('target-1', { role: 'admin' }, token)).status).toBe(428)
  })

  it('正しいgrantなら変更でき、grantは使い切りになる', async () => {
    const token = await seedGrant('staff.permissions.change')
    const res = await patch('target-1', { role: 'admin' }, token)
    expect(res.status).toBe(200)
    expect(testDb.raw.prepare(`SELECT role FROM staff_members WHERE id = 'target-1'`).get()).toEqual({ role: 'admin' })

    // 同じtokenの2回目は消費済みで失敗する
    const second = await seedGrant('staff.permissions.change')
    void second
    const again = await patch('target-1', { isActive: true }, token)
    expect(again.status).toBe(428)
  })

  it('権限に触れない変更（名前だけ）はstep-up無しで通る', async () => {
    const res = await patch('target-1', { name: 'Renamed One' })
    expect(res.status).toBe(200)
    expect(testDb.raw.prepare(`SELECT name FROM staff_members WHERE id = 'target-1'`).get()).toEqual({ name: 'Renamed One' })
  })
})

describe('DELETE /api/staff/:id/two-factor の step-up', () => {
  function removeTwoFactor(id: string, stepUpToken?: string) {
    return app().request(`/api/staff/${id}/two-factor`, {
      method: 'DELETE',
      headers: stepUpToken ? { 'X-Step-Up-Token': stepUpToken } : {},
    }, bindings())
  }

  it('step-up無しでは解除できず、登録情報が残る', async () => {
    const res = await removeTwoFactor('target-1')
    expect(res.status).toBe(428)
    expect(testDb.raw.prepare(`SELECT totp_enabled_at FROM staff_members WHERE id = 'target-1'`).get()).toEqual({ totp_enabled_at: NOW })
  })

  it('権限変更用途のgrantでは拒否し、解除用途なら通る', async () => {
    const wrong = await seedGrant('staff.permissions.change')
    expect((await removeTwoFactor('target-1', wrong)).status).toBe(428)

    const right = await seedGrant('staff.two_factor.remove')
    const res = await removeTwoFactor('target-1', right)
    expect(res.status).toBe(200)
    expect(testDb.raw.prepare(`SELECT totp_enabled_at FROM staff_members WHERE id = 'target-1'`).get()).toEqual({ totp_enabled_at: null })
  })
})

describe('DELETE /api/staff/:id の step-up', () => {
  function remove(id: string, stepUpToken?: string) {
    return app().request(`/api/staff/${id}`, {
      method: 'DELETE',
      headers: stepUpToken ? { 'X-Step-Up-Token': stepUpToken } : {},
    }, bindings())
  }

  it('step-up無しでは利用停止できない', async () => {
    const res = await remove('target-1')
    expect(res.status).toBe(428)
    expect(testDb.raw.prepare(`SELECT is_active FROM staff_members WHERE id = 'target-1'`).get()).toEqual({ is_active: 1 })
  })

  it('正しいgrantなら利用停止できる', async () => {
    const token = await seedGrant('staff.permissions.change')
    const res = await remove('target-1', token)
    expect(res.status).toBe(200)
    expect(testDb.raw.prepare(`SELECT is_active FROM staff_members WHERE id = 'target-1'`).get()).toEqual({ is_active: 0 })
  })
})
