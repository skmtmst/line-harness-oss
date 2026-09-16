import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index.js'
import type { AuthenticatedStaff } from '../middleware/auth.js'
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js'
import { friendAddRules } from './friend-add-rules.js'

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
}

function setupApp(db: D1Database) {
  const app = new Hono<Env>()
  app.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings']
    c.set('staff', owner)
    await next()
  })
  app.route('/', friendAddRules)
  return app
}

function seedRun(testDb: SqliteD1, id: string): void {
  testDb.raw.prepare(
    `INSERT INTO friend_add_events
      (id, line_account_id, friend_id, webhook_event_id, friend_kind, attribution_status,
       routing_status, error_code, occurred_at, processed_at)
     VALUES (?, 'account-1', 'friend-1', ?, 'first_time', 'unavailable',
             'partial_failed', 'action_failed', '2026-09-16T10:00:00.000', '2026-09-16T10:00:01.000')`,
  ).run(id, `webhook-${id}`)
  const completedSnapshot = JSON.stringify({
    kind: 'row', actionType: 'tag', config: { op: 'add', tagIds: ['tag-completed'] },
  })
  const failedSnapshot = JSON.stringify({
    kind: 'row', actionType: 'tag', config: { op: 'add', tagIds: ['tag-failed'] },
  })
  testDb.raw.prepare(
    `INSERT INTO friend_add_action_runs
      (id, event_id, action_stable_id, action_type, action_snapshot, idempotency_key,
       status, attempt_count, last_error_code, started_at, completed_at, created_at, updated_at)
     VALUES (?, ?, 'version-1:0', 'tag', ?, ?, 'completed', 1, NULL,
             '2026-09-16T10:00:00.100', '2026-09-16T10:00:00.200',
             '2026-09-16T10:00:00.100', '2026-09-16T10:00:00.200'),
            (?, ?, 'version-1:1', 'tag', ?, ?, 'failed', 1, ?,
             '2026-09-16T10:00:00.300', '2026-09-16T10:00:00.400',
             '2026-09-16T10:00:00.300', '2026-09-16T10:00:00.400')`,
  ).run(
    `${id}-completed`, id, completedSnapshot, `${id}:completed`,
    `${id}-failed`, id, failedSnapshot, `${id}:failed`, 'SQLITE_CONSTRAINT: secret-customer-value',
  )
}

describe('N-102 friend-add failed-only action retry route', () => {
  let testDb: SqliteD1

  beforeEach(() => {
    testDb = createTestD1()
    testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1'), ('tenant-2', '統括2')`).run()
    testDb.raw.prepare(
      `INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1'),
              ('account-2', 'channel-2', '店舗2', 'token-2', 'secret-2', 1, 'tenant-2')`,
    ).run()
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, role, api_key, tenant_id)
       VALUES ('owner-1', 'オーナー', 'owner', 'owner-key', 'tenant-1')`,
    ).run()
    insertFriend(testDb.raw, 'friend-1', { line_account_id: 'account-1', display_name: '顧客A' })
    testDb.raw.prepare(
      `INSERT INTO tags (id, name, line_account_id)
       VALUES ('tag-completed', '成功済み', 'account-1'), ('tag-failed', '再試行', 'account-1')`,
    ).run()
  })

  afterEach(() => testDb.raw.close())

  it('詳細は全処理と安全なエラーだけを返し、別accountでは404', async () => {
    seedRun(testDb, 'run-detail')
    const app = setupApp(testDb.db)
    const detail = await app.request('/api/friend-add-runs/run-detail?account_id=account-1')
    expect(detail.status).toBe(200)
    const body = await detail.json() as { data: { actionRuns: Array<Record<string, unknown>> } }
    expect(body.data.actionRuns).toHaveLength(2)
    expect(body.data.actionRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({ stableId: 'version-1:0', type: 'tag', status: 'completed', errorCode: null }),
      expect.objectContaining({ stableId: 'version-1:1', type: 'tag', status: 'failed', errorCode: 'action_failed' }),
    ]))
    expect(JSON.stringify(body)).not.toContain('secret-customer-value')

    const hidden = await app.request('/api/friend-add-runs/run-detail?account_id=account-2')
    expect(hidden.status).toBe(404)
  })

  it('失敗分だけ再試行し、成功済み処理の試行回数と副作用を変えない', async () => {
    seedRun(testDb, 'run-retry')
    const app = setupApp(testDb.db)
    const response = await app.request('/api/friend-add-runs/run-retry/retry?account_id=account-1', { method: 'POST' })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true, data: { status: 'completed', retried: 1 },
    })
    expect(testDb.raw.prepare(
      `SELECT action_stable_id, status, attempt_count
         FROM friend_add_action_runs WHERE event_id = 'run-retry' ORDER BY action_stable_id`,
    ).all()).toEqual([
      { action_stable_id: 'version-1:0', status: 'completed', attempt_count: 1 },
      { action_stable_id: 'version-1:1', status: 'completed', attempt_count: 2 },
    ])
    expect(testDb.raw.prepare(
      `SELECT tag_id FROM friend_tags WHERE friend_id = 'friend-1' ORDER BY tag_id`,
    ).all()).toEqual([{ tag_id: 'tag-failed' }])
    expect(testDb.raw.prepare(`SELECT routing_status, error_code FROM friend_add_events WHERE id = 'run-retry'`).get())
      .toEqual({ routing_status: 'completed', error_code: null })

    const replay = await app.request('/api/friend-add-runs/run-retry/retry?account_id=account-1', { method: 'POST' })
    expect(replay.status).toBe(409)
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM friend_tags WHERE friend_id = 'friend-1'`).get())
      .toEqual({ count: 1 })
  })

  it('同時再試行は一方だけが勝ち、別account指定は404', async () => {
    seedRun(testDb, 'run-race')
    const app = setupApp(testDb.db)
    const [first, second] = await Promise.all([
      app.request('/api/friend-add-runs/run-race/retry?account_id=account-1', { method: 'POST' }),
      app.request('/api/friend-add-runs/run-race/retry?account_id=account-1', { method: 'POST' }),
    ])
    expect([first.status, second.status].sort()).toEqual([200, 409])
    expect(testDb.raw.prepare(
      `SELECT attempt_count FROM friend_add_action_runs WHERE id = 'run-race-failed'`,
    ).get()).toEqual({ attempt_count: 2 })

    seedRun(testDb, 'run-other')
    const hidden = await app.request('/api/friend-add-runs/run-other/retry?account_id=account-2', { method: 'POST' })
    expect(hidden.status).toBe(404)
    expect(testDb.raw.prepare(
      `SELECT status, attempt_count FROM friend_add_action_runs WHERE id = 'run-other-failed'`,
    ).get()).toEqual({ status: 'failed', attempt_count: 1 })
  })
})
