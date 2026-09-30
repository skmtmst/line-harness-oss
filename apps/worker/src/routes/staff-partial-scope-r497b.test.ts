import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index.js'
import { sha256Hex, authMiddleware, permissionForApiPath } from '../middleware/auth.js'
import { createTestD1 } from '../test-utils/d1-sqlite.js'

const mail = vi.hoisted(() => ({
  sendStaffInviteEmail: vi.fn(),
  sendStaffLineLinkEmail: vi.fn(),
}))
vi.mock('../services/staff-invite.js', () => mail)

const { staff } = await import('./staff.js')

/*
 * R497b: 一部だけ許可（例：分析の1キーのみ）の保存・再読込・実判定。
 *
 * - 保存済みに /analytics だけがある状態をそのまま保つ
 * - 行単位の保存は触っていない分析の一部を落とさない
 * - かたまりの選び直しは全体の置き換え（一部も置き換わる）
 * - 実際の権限判定はキー単位（/api/analytics は通り、/api/conversions は止まる）
 */

const NOW = '2026-09-08T01:00:00.000Z'
const LATER = '2026-09-09T01:00:00.000Z'
let testDb: ReturnType<typeof createTestD1>

function bindings(): Env['Bindings'] {
  return {
    DB: testDb.db,
    ADMIN_PUBLIC_URL: 'https://admin.example.com',
  } as Env['Bindings']
}

function staffApp(current: Record<string, unknown> = {}) {
  const instance = new Hono<Env>()
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'admin-1', name: 'Admin One', role: 'admin', readOnly: false,
      permissionKeys: [],
      ...current,
    })
    await next()
  })
  instance.route('/', staff)
  return instance
}

/* 実際の権限判定を通す最小の口。認可は authMiddleware が握る。 */
function judgmentApp() {
  const instance = new Hono<Env>()
  instance.use('*', authMiddleware)
  instance.get('/api/analytics', (c) => c.json({ success: true }))
  instance.get('/api/conversions', (c) => c.json({ success: true }))
  instance.get('/api/chats', (c) => c.json({ success: true }))
  return instance
}

async function seedGrant(purpose = 'staff.permissions.change') {
  const token = `grant-${crypto.randomUUID()}`
  testDb.raw.prepare(
    `INSERT INTO auth_step_up_grants (token_hash, staff_id, purpose, expires_at, consumed_at, created_at)
     VALUES (?, 'admin-1', ?, ?, NULL, ?)`,
  ).run(await sha256Hex(token), purpose, LATER, NOW)
  return token
}

function patch(id: string, body: unknown, stepUpToken?: string) {
  return staffApp().request(`/api/staff/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(stepUpToken ? { 'X-Step-Up-Token': stepUpToken } : {}),
    },
    body: JSON.stringify(body),
  }, bindings())
}

function getStaff(id: string) {
  return staffApp().request(`/api/staff/${id}`, { method: 'GET' }, bindings())
}

function judge(method: string, path: string, apiKey: string) {
  return judgmentApp().request(path, {
    method,
    headers: { Authorization: `Bearer ${apiKey}` },
  }, bindings())
}

function seedPartialTarget() {
  // 個別設定：受信箱は変えられる、分析は1キーだけの部分設定、配信はなし。
  testDb.raw.prepare(
    `UPDATE staff_members SET role = 'staff', access_level = 'full', role_bundle = 'custom',
      permission_keys = ?, view_permission_keys = ?, email_mask = NULL, policy_version = 1
      WHERE id = 'target-1'`,
  ).run(JSON.stringify(['/chats', '/analytics']), JSON.stringify([]))
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
  testDb = createTestD1()
  mail.sendStaffInviteEmail.mockReset()
  mail.sendStaffLineLinkEmail.mockReset()
  testDb.raw.prepare(
    `INSERT INTO staff_members (id, name, email, role, api_key, is_active) VALUES ('admin-1', 'Admin One', 'admin@example.com', 'admin', 'admin-1-key', 1)`,
  ).run()
  testDb.raw.prepare(
    `INSERT INTO staff_members (id, name, email, role, api_key, is_active) VALUES ('target-1', 'Target One', 'target@example.com', 'staff', 'target-1-key', 1)`,
  ).run()
})

afterEach(() => {
  testDb.raw.close()
  vi.useRealTimers()
})

describe('R497b 一部だけ許可の保存と実判定', () => {
  it('保存済みの一部をそのまま保ち、再読込と一致する', async () => {
    seedPartialTarget()
    const reread = await getStaff('target-1')
    expect(reread.status).toBe(200)
    const data = (await reread.json() as {
      data: { permissionKeys: string[]; permissionViewKeys: string[] }
    }).data
    // 分析の1キーは保存済みどおり残る。
    expect(data.permissionKeys).toContain('/chats')
    expect(data.permissionKeys).toContain('/analytics')
  })

  it('実際の権限判定はキー単位で通す・止める', async () => {
    seedPartialTarget()
    expect(permissionForApiPath('/api/analytics')).toBe('/analytics')
    expect(permissionForApiPath('/api/conversions')).toBe('/conversions')
    // /analytics のキーがあるので分析の読み取りは通る。
    expect((await judge('GET', '/api/analytics', 'target-1-key')).status).toBe(200)
    // /conversions のキーはないので成果の読み取りは止まる（同じ分析行でも違う）。
    expect((await judge('GET', '/api/conversions', 'target-1-key')).status).toBe(403)
    // 受信箱は通る。
    expect((await judge('GET', '/api/chats', 'target-1-key')).status).toBe(200)
  })

  it('行単位の保存は触っていない分析の一部を残す', async () => {
    seedPartialTarget()
    const res = await patch('target-1', {
      roleBundle: 'reception',
      permissionKeys: ['/chats', '/analytics', '/broadcasts', '/scenarios', '/reminders',
        '/auto-replies', '/friend-add-settings', '/templates', '/rich-menus',
        '/line-notifications', '/nen-campaigns', '/nen-members', '/webinars',
        '/contents', '/contents/vars', '/form-submissions',
        'broadcast.definition.edit', 'broadcast.test.send',
        'broadcast.definition.publish', 'broadcast.result.export'],
      permissionViewKeys: [],
      emailMask: 'masked',
    }, await seedGrant())
    expect(res.status).toBe(200)

    const reread = await getStaff('target-1')
    const data = (await reread.json() as {
      data: { permissionKeys: string[]; permissionScope: Record<string, string> }
    }).data
    // 触っていない分析の一部が残る。
    expect(data.permissionKeys).toContain('/analytics')
    expect(data.permissionScope.delivery).toBe('edit')
    expect(data.permissionScope.inbox).toBe('edit')
  })

  it('かたまりの選び直しは全体の置き換え（一部も置き換わる）', async () => {
    seedPartialTarget()
    // 受付のかたまりで保存し直す（分析なし）。分析の一部は残らない。
    const res = await patch('target-1', { roleBundle: 'reception' }, await seedGrant())
    expect(res.status).toBe(200)
    const reread = await getStaff('target-1')
    const data = (await reread.json() as {
      data: { permissionKeys: string[] }
    }).data
    expect(data.permissionKeys).not.toContain('/analytics')
    expect(data.permissionKeys).toContain('/chats')
  })
})
