import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index.js'
import { sha256Hex } from '../middleware/auth.js'
import { updateStaffMember, DEFAULT_TENANT_ID } from '@line-crm/db'
import { createTestD1 } from '../test-utils/d1-sqlite.js'

const mail = vi.hoisted(() => ({
  sendStaffInviteEmail: vi.fn(),
  sendStaffLineLinkEmail: vi.fn(),
}))
vi.mock('../services/staff-invite.js', () => mail)

const { staff } = await import('./staff.js')

/*
 * 監査 R501: 管理者同士の同時停止・降格・削除で管理者が0人にならない。
 *
 * guardLastAdmin は読んでから確かめるため、同時に互いを止める2要求が
 * 両方とも通過してしまう。書き込みと同じ条件で「ほかに有効な管理者が
 * 残る」ことを求め、2つ目は409で止める。
 */

const NOW = '2026-09-08T01:00:00.000Z'
const LATER = '2026-09-09T01:00:00.000Z'
let testDb: ReturnType<typeof createTestD1>

function appAs(callerId: string, role: 'owner' | 'admin' | 'staff' = 'admin') {
  const instance = new Hono<Env>()
  instance.use('*', async (c, next) => {
    c.set('staff', { id: callerId, name: callerId, role, readOnly: false, permissionKeys: [] })
    await next()
  })
  instance.route('/', staff)
  return instance
}

function bindings(): Env['Bindings'] {
  return {
    DB: testDb.db,
    ADMIN_PUBLIC_URL: 'https://admin.example.com',
  } as Env['Bindings']
}

async function seedGrant(staffId: string, purpose = 'staff.permissions.change') {
  const token = `grant-${staffId}-${crypto.randomUUID()}`
  testDb.raw.prepare(
    `INSERT INTO auth_step_up_grants (token_hash, staff_id, purpose, expires_at, consumed_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  ).run(await sha256Hex(token), staffId, purpose, LATER, NOW)
  return token
}

function patchAs(callerId: string, id: string, body: unknown, stepUpToken?: string) {
  return appAs(callerId).request(`/api/staff/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(stepUpToken ? { 'X-Step-Up-Token': stepUpToken } : {}),
    },
    body: JSON.stringify(body),
  }, bindings())
}

function deleteAs(callerId: string, id: string, stepUpToken?: string) {
  return appAs(callerId).request(`/api/staff/${id}`, {
    method: 'DELETE',
    headers: stepUpToken ? { 'X-Step-Up-Token': stepUpToken } : {},
  }, bindings())
}

function isActive(id: string) {
  return (testDb.raw.prepare(`SELECT is_active AS v FROM staff_members WHERE id = ?`).get(id) as { v: number }).v === 1
}

function adminCount() {
  return (testDb.raw.prepare(
    `SELECT COUNT(*) AS v FROM staff_members WHERE is_active = 1 AND role <> 'staff' AND access_level <> 'read_only'`,
  ).get() as { v: number }).v
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
  testDb = createTestD1()
  mail.sendStaffInviteEmail.mockReset()
  mail.sendStaffLineLinkEmail.mockReset()
  for (const [id, name] of [['admin-a', 'Admin A'], ['admin-b', 'Admin B']] as const) {
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, is_active) VALUES (?, ?, ?, 'admin', ?, 1)`,
    ).run(id, name, `${id}@example.com`, `${id}-key`)
  }
})

afterEach(() => {
  testDb.raw.close()
  vi.useRealTimers()
})

describe('R501 同時に互いを止めても管理者が残る', () => {
  it('AがBを止めた後ではB側の書き込みは条件に合わず止まる（競合の再現）', async () => {
    // 両方の guard が書き込み前に通過した状態（互いに相手以外の有効な管理者を見る）。
    const first = await patchAs('admin-a', 'admin-b', { isActive: false }, await seedGrant('admin-a'))
    expect(first.status).toBe(200)
    expect(isActive('admin-b')).toBe(false)
    // B の要求は guard 通過後に届いたものとして、同じ書き込み条件で確かめる。
    const second = await updateStaffMember(testDb.db, 'admin-a', { is_active: 0 },
      { requireRemainingAdmin: { tenantId: DEFAULT_TENANT_ID } })
    expect(second).toBeNull()
    expect(isActive('admin-a')).toBe(true)
    expect(adminCount()).toBe(1)
  })

  it('最後の1人を止める書き込みは通らない', async () => {
    testDb.raw.prepare(`UPDATE staff_members SET is_active = 0 WHERE id = 'admin-b'`).run()
    expect(adminCount()).toBe(1)
    const applied = await updateStaffMember(testDb.db, 'admin-a', { is_active: 0 },
      { requireRemainingAdmin: { tenantId: DEFAULT_TENANT_ID } })
    expect(applied).toBeNull()
    expect(isActive('admin-a')).toBe(true)
  })

  it('ほかに管理者がいれば止められる', async () => {
    const applied = await updateStaffMember(testDb.db, 'admin-b', { is_active: 0 },
      { requireRemainingAdmin: { tenantId: DEFAULT_TENANT_ID } })
    expect(applied).not.toBeNull()
    expect(isActive('admin-b')).toBe(false)
    expect(adminCount()).toBe(1)
  })

  it('片方の無効化は200で通り、管理者が1人残る', async () => {
    const res = await patchAs('admin-a', 'admin-b', { isActive: false }, await seedGrant('admin-a'))
    expect(res.status).toBe(200)
    expect(adminCount()).toBe(1)
  })

  it('降格の競合も2つ目は止まる（見るだけへの変更後に相手を降格できない）', async () => {
    const first = await patchAs('admin-a', 'admin-b', { roleBundle: 'view_only' }, await seedGrant('admin-a'))
    expect(first.status).toBe(200)
    // B の降格要求は guard 通過後に届いたものとして、同じ書き込み条件で確かめる。
    const second = await updateStaffMember(testDb.db, 'admin-a',
      { access_level: 'read_only', role_bundle: 'view_only' },
      { requireRemainingAdmin: { tenantId: DEFAULT_TENANT_ID } })
    expect(second).toBeNull()
    expect(adminCount()).toBe(1)
  })

  it('管理者2人のうち1人の削除は通り、もう1人が残る', async () => {
    const res = await deleteAs('admin-a', 'admin-b', await seedGrant('admin-a'))
    expect(res.status).toBe(200)
    expect(adminCount()).toBe(1)
  })
})
