import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index.js'
import { sha256Hex } from '../middleware/auth.js'
import { createTestD1 } from '../test-utils/d1-sqlite.js'

const mail = vi.hoisted(() => ({
  sendStaffInviteEmail: vi.fn(),
  sendStaffLineLinkEmail: vi.fn(),
}))
vi.mock('../services/staff-invite.js', () => mail)

const { staff } = await import('./staff.js')

/*
 * 監査 R497〜R499（担当者の権限設定の入口・再送・同時編集）。
 *
 * R497: 表にない既存キー（/automations）を bundle/役割保存で消さない。
 * R498: 同じ要求キーの再送は1回だけ受け付け、再送で新しいセッションを切らない。
 * R499: 古い版からの保存は409で止め、最新の制限を上書きしない。
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

function row(id: string) {
  return testDb.raw.prepare(`SELECT * FROM staff_members WHERE id = ?`).get(id) as {
    role: string; access_level: string; role_bundle: string | null;
    permission_keys: string | null; view_permission_keys: string | null;
    policy_version: number;
  }
}
const keys = (value: string | null) => (value ? JSON.parse(value) as string[] : [])
const policyVersion = (id: string) => row(id).policy_version

function seedTargetWithAutomationKeys() {
  // 個別編集で付けた /automations（表・全プリセットに無いキー）を持つ状態。
  testDb.raw.prepare(
    `UPDATE staff_members SET permission_keys = ?, view_permission_keys = ? WHERE id = 'target-1'`,
  ).run(JSON.stringify(['/chats', '/automations']), JSON.stringify([]))
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

describe('R497 表にない既存キーを消さない', () => {
  it('見るだけのかたまり保存でも /automations が残る', async () => {
    seedTargetWithAutomationKeys()
    const res = await patch('target-1', { roleBundle: 'view_only' }, await seedGrant())
    expect(res.status).toBe(200)
    const saved = row('target-1')
    expect(saved.role_bundle).toBe('view_only')
    const edit = keys(saved.permission_keys)
    const view = keys(saved.view_permission_keys)
    // どちらかで残っていれば閲覧は通る（GET は edit/view のどちらでも許可）。
    expect([...edit, ...view]).toContain('/automations')
  })

  it('別項目の変更（受付＋分析なし）でも /automations が残る', async () => {
    seedTargetWithAutomationKeys()
    const res = await patch('target-1', {
      roleBundle: 'reception',
      permissionScope: {
        friends: 'view', pii: 'view', delivery: 'none', inbox: 'edit',
        booking: 'edit', booking_menus: 'view', booking_settings: 'view',
        booking_own: 'edit', analytics: 'none', settings: 'none', operations: 'view',
      },
    }, await seedGrant())
    expect(res.status).toBe(200)
    const saved = row('target-1')
    expect([...keys(saved.permission_keys), ...keys(saved.view_permission_keys)]).toContain('/automations')
  })

  it('個別編集で役割だけ見るだけにしても表示側の未表示キーが残る', async () => {
    testDb.raw.prepare(
      `UPDATE staff_members SET permission_keys = ?, view_permission_keys = ? WHERE id = 'target-1'`,
    ).run(JSON.stringify(['/chats']), JSON.stringify(['/automations']))
    const res = await patch('target-1', { role: 'viewer' }, await seedGrant())
    expect(res.status).toBe(200)
    const saved = row('target-1')
    expect([...keys(saved.permission_keys), ...keys(saved.view_permission_keys)]).toContain('/automations')
  })
})

describe('R498 同じ要求キーの再送は1回だけ', () => {
  it('同じ要求キーの再送は版を進めず同じ結果を返す', async () => {
    const before = policyVersion('target-1')
    const first = await patch('target-1', { roleBundle: 'reception', idempotencyKey: 'req-1' }, await seedGrant())
    expect(first.status).toBe(200)
    const firstBody = await first.json() as { data: { policyVersion: number } }
    expect(policyVersion('target-1')).toBe(before + 1)
    // 再送は新しい step-up なしでも同じ結果を返す（副作用なし）。
    const second = await patch('target-1', { roleBundle: 'reception', idempotencyKey: 'req-1' })
    expect(second.status).toBe(200)
    const secondBody = await second.json() as { data: { policyVersion: number } }
    expect(secondBody.data.policyVersion).toBe(firstBody.data.policyVersion)
    expect(policyVersion('target-1')).toBe(before + 1)
  })

  it('再送で保存後ログインし直したセッションを終了しない', async () => {
    const first = await patch('target-1', { roleBundle: 'reception', idempotencyKey: 'req-2' }, await seedGrant())
    expect(first.status).toBe(200)
    // 対象者がログインし直す。
    testDb.raw.prepare(
      `INSERT INTO admin_sessions (token_hash, staff_id, expires_at, created_at) VALUES (?, 'target-1', ?, ?)`,
    ).run('new-session-hash', LATER, NOW)
    const retry = await patch('target-1', { roleBundle: 'reception', idempotencyKey: 'req-2' })
    expect(retry.status).toBe(200)
    const kept = testDb.raw.prepare(
      `SELECT * FROM admin_sessions WHERE token_hash = ?`,
    ).get('new-session-hash')
    expect(kept).not.toBeNull()
  })
})

describe('R499 古い版からの保存は409で止まる', () => {
  it('読んだ後に他者が制限したら古い保存は409で制限を保つ', async () => {
    const readVersion = policyVersion('target-1')
    // 管理者Bが先に見るだけへ制限する。
    const bRes = await patch('target-1', { roleBundle: 'view_only', expectedPolicyVersion: readVersion }, await seedGrant())
    expect(bRes.status).toBe(200)
    expect(row('target-1').role_bundle).toBe('view_only')
    // 管理者Aの古い画面からの保存（full 相当の個別編集）は止まる。
    const aRes = await patch('target-1', {
      roleBundle: 'operations', expectedPolicyVersion: readVersion,
    }, await seedGrant())
    expect(aRes.status).toBe(409)
    expect(row('target-1').role_bundle).toBe('view_only')
  })

  it('最新の版なら保存できる', async () => {
    const readVersion = policyVersion('target-1')
    const res = await patch('target-1', { roleBundle: 'operations', expectedPolicyVersion: readVersion }, await seedGrant())
    expect(res.status).toBe(200)
    expect(row('target-1').role_bundle).toBe('operations')
  })

  it('版を指定しない従来の保存はそのまま通る', async () => {
    const res = await patch('target-1', { roleBundle: 'operations' }, await seedGrant())
    expect(res.status).toBe(200)
  })
})
