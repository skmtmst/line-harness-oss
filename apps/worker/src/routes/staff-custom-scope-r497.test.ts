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
 * R497: 個別設定（custom）の表示・保存・再読込・実際の権限判定の一致。
 *
 * - 保存済みキーを3択へ写した表示どおりに保存できる
 * - 行単位の保存は触っていない行の部分設定を落とさない
 * - 保存後の再読込（GET）が保存内容と一致する
 * - 実際の権限判定（authMiddleware）が保存済みキーどおりに通す・止める
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
  instance.get('/api/chats', (c) => c.json({ success: true }))
  instance.post('/api/chats', (c) => c.json({ success: true }))
  instance.get('/api/broadcasts', (c) => c.json({ success: true }))
  instance.post('/api/broadcasts', (c) => c.json({ success: true }))
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

function seedCustomTarget() {
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

describe('R497 個別設定の保存と再読込と権限判定の一致', () => {
  it('行単位の保存は触っていない部分設定を残し、再読込と一致する', async () => {
    seedCustomTarget()
    // 画面が行単位で組み立てた送り：受信箱はそのまま、配信だけ変えられるへ。
    // 触っていない分析の1キーは送り側が残す（サーバーは送られたとおりに保つ）。
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
    expect(reread.status).toBe(200)
    const data = (await reread.json() as {
      data: { roleBundle: string; permissionKeys: string[]; permissionViewKeys: string[]; permissionScope: Record<string, string> }
    }).data
    expect(data.roleBundle).toBe('custom')
    // 触っていない分析の部分設定が残る。
    expect(data.permissionKeys).toContain('/analytics')
    // 変えた配信は3択にも写る。
    expect(data.permissionScope.delivery).toBe('edit')
    expect(data.permissionScope.inbox).toBe('edit')
  })

  it('保存済みキーどおりに実際の権限判定が通す・止める', async () => {
    seedCustomTarget()
    expect(permissionForApiPath('/api/chats')).toBe('/chats')
    expect(permissionForApiPath('/api/broadcasts')).toBe('/broadcasts')
    // 受信箱のキーはあるので読み書きとも通る。
    expect((await judge('GET', '/api/chats', 'target-1-key')).status).toBe(200)
    expect((await judge('POST', '/api/chats', 'target-1-key')).status).toBe(200)
    // 配信のキーはないので読み書きとも止まる。
    expect((await judge('GET', '/api/broadcasts', 'target-1-key')).status).toBe(403)
    expect((await judge('POST', '/api/broadcasts', 'target-1-key')).status).toBe(403)
  })

  it('custom の再保存（かたまり名だけ）では保存済みキーを落とさない', async () => {
    seedCustomTarget()
    const res = await patch('target-1', { roleBundle: 'custom' }, await seedGrant())
    expect(res.status).toBe(200)
    const reread = await getStaff('target-1')
    const data = (await reread.json() as {
      data: { permissionKeys: string[]; permissionViewKeys: string[] }
    }).data
    expect(data.permissionKeys).toContain('/chats')
    expect(data.permissionKeys).toContain('/analytics')
  })
})
