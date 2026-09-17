import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index.js'
import { sha256Hex, authMiddleware } from '../middleware/auth.js'
import { createTestD1 } from '../test-utils/d1-sqlite.js'

const mail = vi.hoisted(() => ({
  sendStaffInviteEmail: vi.fn(),
  sendStaffLineLinkEmail: vi.fn(),
}))
vi.mock('../services/staff-invite.js', () => mail)

const { staff } = await import('./staff.js')

/*
 * N-424 (#852): 役割bundle（管理者/運用/受付/見るだけ/個別設定）を
 * role とは別に保存し、bundle は「初期値」として preset のキーへ展開する。
 *
 * 直す前: 画面で「受付」を選んでも role='staff' へ潰れ、運用と区別できず、
 * 「見えるだけ」の3択も保存できなかった。
 */

const NOW = '2026-09-08T01:00:00.000Z'
const LATER = '2026-09-09T01:00:00.000Z'
let testDb: ReturnType<typeof createTestD1>

function app(current: Record<string, unknown> = {}) {
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

function bindings(): Env['Bindings'] {
  return {
    DB: testDb.db,
    ADMIN_PUBLIC_URL: 'https://admin.example.com',
  } as Env['Bindings']
}

async function seedGrant(purpose = 'staff.permissions.change') {
  const token = `grant-${crypto.randomUUID()}`
  testDb.raw.prepare(
    `INSERT INTO auth_step_up_grants (token_hash, staff_id, purpose, expires_at, consumed_at, created_at)
     VALUES (?, 'admin-1', ?, ?, NULL, ?)`,
  ).run(await sha256Hex(token), purpose, LATER, NOW)
  return token
}

function patch(id: string, body: unknown, stepUpToken?: string, current?: Record<string, unknown>) {
  return app(current).request(`/api/staff/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(stepUpToken ? { 'X-Step-Up-Token': stepUpToken } : {}),
    },
    body: JSON.stringify(body),
  }, bindings())
}

function row(id: string) {
  return testDb.raw.prepare(`SELECT * FROM staff_members WHERE id = ?`).get(id) as {
    role: string; access_level: string; role_bundle: string | null;
    permission_keys: string | null; view_permission_keys: string | null; email_mask: string | null;
  }
}
const keys = (value: string | null) => (value ? JSON.parse(value) as string[] : [])

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

describe('PATCH /api/staff/:id の役割bundle', () => {
  it('受付を選ぶと bundle=受付・受信箱と予約はできる・友だちは見るだけ・配信は出さない', async () => {
    const token = await seedGrant()
    const res = await patch('target-1', { roleBundle: 'reception' }, token)
    expect(res.status).toBe(200)
    const data = (await res.json() as { data: { roleBundle: string; role: string; permissionScope: Record<string, string> } }).data
    expect(data.roleBundle).toBe('reception')
    expect(data.role).toBe('staff')
    expect(data.permissionScope.inbox).toBe('edit')
    expect(data.permissionScope.delivery).toBe('none')

    const saved = row('target-1')
    expect(saved.role_bundle).toBe('reception')
    expect(saved.role).toBe('staff')
    expect(saved.access_level).toBe('full')
    const edit = keys(saved.permission_keys)
    const view = keys(saved.view_permission_keys)
    expect(edit).toContain('/chats')        // 受信箱はできる
    expect(edit).toContain('/booking/bookings') // 予約はできる
    expect(view).toContain('/friends')      // 友だちは見るだけ
    expect(edit).not.toContain('/friends')
    expect(edit).not.toContain('/broadcasts')
    expect(view).not.toContain('/broadcasts') // 配信は出さない
    expect(saved.email_mask).toBe('masked')
  })

  it('運用を選ぶと bundle=運用・配信もできる・設定は出さない', async () => {
    const token = await seedGrant()
    const res = await patch('target-1', { roleBundle: 'operations' }, token)
    expect(res.status).toBe(200)
    const saved = row('target-1')
    expect(saved.role_bundle).toBe('operations')
    const edit = keys(saved.permission_keys)
    const view = keys(saved.view_permission_keys)
    expect(edit).toContain('/broadcasts')
    expect(edit).toContain('/chats')
    expect(edit).not.toContain('/webhooks')   // 設定は出さない
    expect(view).not.toContain('/webhooks')
    expect(view).toContain('/analytics')      // 分析は見るだけ
  })

  it('見るだけを選ぶと read_only で全機能がviewキーに入る', async () => {
    const token = await seedGrant()
    const res = await patch('target-1', { roleBundle: 'view_only' }, token)
    expect(res.status).toBe(200)
    const saved = row('target-1')
    expect(saved.role_bundle).toBe('view_only')
    expect(saved.access_level).toBe('read_only')
    expect(keys(saved.permission_keys)).toEqual([])
    const view = keys(saved.view_permission_keys)
    expect(view).toContain('/chats')
    expect(view).toContain('/broadcasts')
    expect(view).toContain('/friends')
  })

  it('bundleと3択を同時に送ると個別設定として保存される', async () => {
    const token = await seedGrant()
    const res = await patch('target-1', {
      roleBundle: 'reception',
      permissionScope: { delivery: 'view' },
    }, token)
    expect(res.status).toBe(200)
    const data = (await res.json() as { data: { roleBundle: string } }).data
    expect(data.roleBundle).toBe('custom')
    const saved = row('target-1')
    expect(saved.role_bundle).toBe('custom')
    // 3択表が送られたときは、その表が正本（未定義の行は出さない）
    const view = keys(saved.view_permission_keys)
    expect(view).toContain('/broadcasts')
    expect(keys(saved.permission_keys)).not.toContain('/chats')
  })

  it('個別設定をそのまま選ぶと custom で保存される', async () => {
    const token = await seedGrant()
    const res = await patch('target-1', {
      roleBundle: 'custom',
      permissionScope: { inbox: 'edit', friends: 'view' },
      emailMask: 'none',
    }, token)
    expect(res.status).toBe(200)
    const saved = row('target-1')
    expect(saved.role_bundle).toBe('custom')
    expect(saved.role).toBe('staff')
    expect(keys(saved.permission_keys)).toContain('/chats')
    expect(keys(saved.view_permission_keys)).toContain('/friends')
    expect(saved.email_mask).toBe('none')
  })

  it('正しくないbundle・知らない項目・変なメール指定は400', async () => {
    const token = await seedGrant()
    expect((await patch('target-1', { roleBundle: 'superuser' }, token)).status).toBe(400)
    expect((await patch('target-1', { permissionScope: { secret: 'edit' } }, token)).status).toBe(400)
    expect((await patch('target-1', { permissionScope: { inbox: 'everything' } }, token)).status).toBe(400)
    expect((await patch('target-1', { emailMask: 'sometimes' }, token)).status).toBe(400)
    expect(row('target-1').role_bundle).toBeNull()
  })

  it('step-up無しのbundle変更は428で、何も書き込まない', async () => {
    const res = await patch('target-1', { roleBundle: 'reception' })
    expect(res.status).toBe(428)
    const saved = row('target-1')
    expect(saved.role_bundle).toBeNull()
    expect(keys(saved.permission_keys)).toEqual([])
  })

  it('権限の無いスタッフ本人はbundleを変えられない', async () => {
    const res = await patch(
      'target-1',
      { roleBundle: 'reception' },
      await seedGrant(),
      { id: 'target-1', role: 'staff' },
    )
    expect(res.status).toBe(403)
    expect(row('target-1').role_bundle).toBeNull()
  })

  it('旧来の role 指定もbundleへ写す（viewer → 見るだけ）', async () => {
    const token = await seedGrant()
    const res = await patch('target-1', { role: 'viewer' }, token)
    expect(res.status).toBe(200)
    const saved = row('target-1')
    expect(saved.role_bundle).toBe('view_only')
    expect(saved.access_level).toBe('read_only')
    expect(keys(saved.view_permission_keys)).toContain('/chats')
  })
})

describe('メールの見せ方（email_mask）', () => {
  async function listEmails(current: Record<string, unknown>) {
    const res = await app(current).request('/api/staff', { method: 'GET' }, bindings())
    expect(res.status).toBe(200)
    const { data } = await res.json() as { data: Array<{ id: string; email: string | null }> }
    return data.find((item) => item.id === 'target-1')?.email
  }

  it('mask=full なら実アドレス、masked なら伏せ字、none なら返さない', async () => {
    // 既定（未設定）の管理者は実アドレスが見える
    expect(await listEmails({})).toBe('target@example.com')
    expect(await listEmails({ emailMask: 'full' })).toBe('target@example.com')
    expect(await listEmails({ emailMask: 'masked' })).toBe('t***@example.com')
    expect(await listEmails({ emailMask: 'none' })).toBeNull()
  })

  it('本人には常に実アドレスを返す', async () => {
    const res = await app({ id: 'target-1', role: 'staff', emailMask: 'none' })
      .request('/api/staff/target-1', { method: 'GET' }, bindings())
    expect(res.status).toBe(200)
    const { data } = await res.json() as { data: { email: string | null } }
    expect(data.email).toBe('target@example.com')
  })
})

/*
 * 認証 middleware の「見えるだけ」判定を実物で通す。
 * staff のAPIキーで呼び、view キーでは GET だけ通ることを確かめる。
 */
describe('「見えるだけ」のキーはGETだけ許可する', () => {
  const KEY_VIEW = 'key-view-staff'
  const KEY_NONE = 'key-noperm-staff'

  function secureApp() {
    const instance = new Hono<Env>()
    instance.use('/api/*', authMiddleware)
    instance.get('/api/reminders', (c) => c.json({ success: true }))
    instance.post('/api/reminders', (c) => c.json({ success: true }))
    instance.get('/api/accounts/health-summary', (c) => c.json({ success: true }))
    instance.get('/api/access/users', (c) => c.json({ success: true }))
    instance.get('/api/audit/events', (c) => c.json({ success: true }))
    return instance
  }

  function call(method: string, path: string, key: string) {
    return secureApp().request(path, {
      method,
      headers: { Authorization: `Bearer ${key}` },
    }, bindings())
  }

  beforeEach(() => {
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, role, api_key, is_active, view_permission_keys)
       VALUES ('staff-view', '見るだけ担当', 'staff', ?, 1, '["/reminders","/health"]')`,
    ).run(KEY_VIEW)
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, role, api_key, is_active)
       VALUES ('staff-none', '権限なし', 'staff', ?, 1)`,
    ).run(KEY_NONE)
  })

  it('view キーのGETは通る', async () => {
    const res = await call('GET', '/api/reminders', KEY_VIEW)
    expect(res.status).toBe(200)
  })

  it('view キーでは変更系は403', async () => {
    const res = await call('POST', '/api/reminders', KEY_VIEW)
    expect(res.status).toBe(403)
  })

  it('キーが無い人はGETも403', async () => {
    const res = await call('GET', '/api/reminders', KEY_NONE)
    expect(res.status).toBe(403)
  })

  it('運用状態の健全性は /health キーで見られる', async () => {
    const res = await call('GET', '/api/accounts/health-summary', KEY_VIEW)
    expect(res.status).toBe(200)
    expect((await call('GET', '/api/accounts/health-summary', KEY_NONE)).status).toBe(403)
  })

  it('設定の点キー（view）でログインユーザー一覧と監査が読める', async () => {
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, role, api_key, is_active, view_permission_keys)
       VALUES ('staff-settings-view', '設定閲覧', 'staff', 'key-settings-view', 1, '["access.user.view","access.audit.view"]')`,
    ).run()
    expect((await call('GET', '/api/access/users', 'key-settings-view')).status).toBe(200)
    expect((await call('GET', '/api/audit/events', 'key-settings-view')).status).toBe(200)
    expect((await call('GET', '/api/access/users', KEY_NONE)).status).toBe(403)
    expect((await call('GET', '/api/audit/events', KEY_NONE)).status).toBe(403)
  })
})
