import { beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index.js'
import { createTestD1 } from '../test-utils/d1-sqlite.js'
import { consumeAdminStepUpGrant, createAdminStepUpGrant, isOperationCapabilityStopped } from '@line-crm/db'
import { operations } from './operations.js'
import { sha256Hex } from '../middleware/auth.js'

function app(role: 'owner' | 'admin' | 'staff' = 'owner', emergencyControl = role !== 'staff') {
  const instance = new Hono<Env>()
  instance.use('*', async (c, next) => {
    c.set('staff', { id: `${role}-1`, name: role, role, readOnly: false, permissionKeys: emergencyControl ? ['action:emergency-control'] : [] })
    await next()
  })
  instance.route('/', operations)
  return instance
}

let testDb: ReturnType<typeof createTestD1>

const key = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`

async function operationHeaders(
  role: 'owner' | 'admin',
  purpose: 'operation-stop' | 'operation-restore',
  idempotencyKey: string,
  suffix: string,
) {
  const sessionToken = `operation-session-${role}`
  const stepUpToken = `operation-step-up-${suffix}`
  await createAdminStepUpGrant(testDb.db, {
    tokenHash: await sha256Hex(stepUpToken),
    staffId: `${role}-1`,
    sessionTokenHash: await sha256Hex(sessionToken),
    purpose,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
  })
  return {
    'content-type': 'application/json',
    'x-confirm-irreversible': purpose,
    'idempotency-key': idempotencyKey,
    'x-step-up-token': stepUpToken,
    cookie: `lh_admin_session=${sessionToken}`,
  }
}

beforeEach(() => {
  testDb = createTestD1()
  testDb.raw.prepare("INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES ('account-1', 'channel', 'LINE', 'token', 'secret')").run()
})

describe('運用状態API', () => {
  it('step-up tokenは現在のsessionと用途に結び付き、1回だけ使える', async () => {
    const tokenHash = await sha256Hex('single-use-token')
    const sessionTokenHash = await sha256Hex('bound-session')
    await createAdminStepUpGrant(testDb.db, {
      tokenHash,
      staffId: 'owner-1',
      sessionTokenHash,
      purpose: 'operation-stop',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    })
    expect(await consumeAdminStepUpGrant(testDb.db, {
      tokenHash, staffId: 'owner-1', sessionTokenHash: await sha256Hex('other-session'),
      purpose: 'operation-stop', now: new Date().toISOString(),
    })).toBe(false)
    expect(await consumeAdminStepUpGrant(testDb.db, {
      tokenHash, staffId: 'owner-1', sessionTokenHash,
      purpose: 'operation-restore', now: new Date().toISOString(),
    })).toBe(false)
    expect(await consumeAdminStepUpGrant(testDb.db, {
      tokenHash, staffId: 'owner-1', sessionTokenHash,
      purpose: 'operation-stop', now: new Date().toISOString(),
    })).toBe(true)
    expect(await consumeAdminStepUpGrant(testDb.db, {
      tokenHash, staffId: 'owner-1', sessionTokenHash,
      purpose: 'operation-stop', now: new Date().toISOString(),
    })).toBe(false)
  })

  it('保存された健全性結果が無いときは0件と偽らずnullを返す', async () => {
    const response = await app('admin').request('/api/operations/health', {}, { DB: testDb.db })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: null })
  })

  it('健全性アラートを確認済みにできるのはowner/adminだけ', async () => {
    testDb.raw.prepare(
      `INSERT INTO operation_health_alerts
       (id, check_key, status, severity, detail, first_detected_at, last_detected_at, updated_at)
       VALUES ('alert-1', 'delivery', 'open', 'warning', '滞留', '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z')`,
    ).run()
    const denied = await app('staff').request('/api/operations/alerts/alert-1/ack', { method: 'POST' }, { DB: testDb.db })
    expect(denied.status).toBe(403)
    const allowed = await app('admin').request('/api/operations/alerts/alert-1/ack', { method: 'POST' }, { DB: testDb.db })
    expect(allowed.status).toBe(200)
    expect(await allowed.json()).toMatchObject({ success: true, data: { status: 'acknowledged', acknowledgedBy: 'admin-1' } })
  })

  it('確認ヘッダーと合言葉が無い停止を拒否する', async () => {
    const missingHeader = await app().request('/api/operations/incidents', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccountId: null, capabilities: ['broadcast_dispatch'], reason: '障害', expectedVersion: 0, confirmation: '停止' }),
    }, { DB: testDb.db })
    expect(missingHeader.status).toBe(428)

    const wrongWord = await app().request('/api/operations/incidents', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-confirm-irreversible': 'operation-stop' },
      body: JSON.stringify({ lineAccountId: null, capabilities: ['broadcast_dispatch'], reason: '障害', expectedVersion: 0, confirmation: 'とめる' }),
    }, { DB: testDb.db })
    expect(wrongWord.status).toBe(400)

    const missingIdempotency = await app().request('/api/operations/incidents', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-confirm-irreversible': 'operation-stop' },
      body: JSON.stringify({ lineAccountId: null, capabilities: ['broadcast_dispatch'], reason: '障害', expectedVersion: 0, confirmation: '停止' }),
    }, { DB: testDb.db })
    expect(missingIdempotency.status).toBe(400)
    expect(await missingIdempotency.json()).toMatchObject({ error: expect.stringContaining('Idempotency-Key') })
  })

  it('step-up tokenが無い停止を拒否し、同じ冪等キーを本人確認後にやり直せる', async () => {
    const body = JSON.stringify({
      lineAccountId: 'account-1', capabilities: ['broadcast_dispatch'],
      reason: '障害', expectedVersion: 0, confirmation: '停止',
    })
    const denied = await app().request('/api/operations/incidents', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-confirm-irreversible': 'operation-stop',
        'idempotency-key': key(8),
      },
      body,
    }, { DB: testDb.db })
    expect(denied.status).toBe(428)
    expect(await denied.json()).toMatchObject({ error: expect.stringContaining('本人確認') })

    const retried = await app().request('/api/operations/incidents', {
      method: 'POST',
      headers: await operationHeaders('owner', 'operation-stop', key(8), 'retry-after-step-up'),
      body,
    }, { DB: testDb.db })
    expect(retried.status).toBe(201)
  })

  it('全体停止はownerだけ、アカウント停止はadminも実行できる', async () => {
    const denied = await app('admin').request('/api/operations/incidents', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-confirm-irreversible': 'operation-stop' },
      body: JSON.stringify({ lineAccountId: null, capabilities: ['broadcast_dispatch'], reason: '障害', expectedVersion: 0, confirmation: '停止' }),
    }, { DB: testDb.db })
    expect(denied.status).toBe(403)

    const allowed = await app('admin').request('/api/operations/incidents', {
      method: 'POST', headers: await operationHeaders('admin', 'operation-stop', key(1), 'admin-account-stop'),
      body: JSON.stringify({ lineAccountId: 'account-1', capabilities: ['broadcast_dispatch'], reason: '障害', expectedVersion: 0, confirmation: '停止' }),
    }, { DB: testDb.db })
    expect(allowed.status).toBe(201)
    expect(await allowed.json()).toMatchObject({ success: true, data: { control: { version: 1, activeIncidentId: expect.any(String) } } })
  })

  it('adminでも緊急停止・復旧の専用権限が無ければ停止できない', async () => {
    const denied = await app('admin', false).request('/api/operations/incidents', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-confirm-irreversible': 'operation-stop' },
      body: JSON.stringify({ lineAccountId: 'account-1', capabilities: ['broadcast_dispatch'], reason: '障害', expectedVersion: 0, confirmation: '停止' }),
    }, { DB: testDb.db })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ error: expect.stringContaining('専用権限') })
  })

  it('停止前の件数を実テーブルからまとめて返す', async () => {
    const response = await app().request('/api/operations/control/preview?account_id=account-1', {}, { DB: testDb.db })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        control: { lineAccountId: 'account-1', version: 0 },
        counts: {
          broadcast_dispatch: 0,
          scenario_dispatch: 0,
          reminder_dispatch: 0,
          automation_actions: 0,
        },
      },
    })
  })

  it('停止後は別端末相当のGETと履歴で同じ状態を取得し、古い版を409にする', async () => {
    const request = {
      method: 'POST',
      headers: await operationHeaders('owner', 'operation-stop', key(2), 'initial-stop'),
      body: JSON.stringify({ lineAccountId: 'account-1', capabilities: ['broadcast_dispatch'], reason: '誤配信', expectedVersion: 0, confirmation: '停止' }),
    }
    expect((await app().request('/api/operations/incidents', request, { DB: testDb.db })).status).toBe(201)
    const replayed = await app().request('/api/operations/incidents', request, { DB: testDb.db })
    expect(replayed.status).toBe(201)
    expect(replayed.headers.get('Idempotency-Replayed')).toBe('true')
    const reusedForAnotherRequest = {
      ...request,
      body: JSON.stringify({ lineAccountId: 'account-1', capabilities: ['scenario_dispatch'], reason: '別の停止', expectedVersion: 0, confirmation: '停止' }),
    }
    expect((await app().request('/api/operations/incidents', reusedForAnotherRequest, { DB: testDb.db })).status).toBe(409)
    const staleRequest = {
      ...request,
      headers: await operationHeaders('owner', 'operation-stop', key(3), 'stale-stop'),
    }
    expect((await app().request('/api/operations/incidents', staleRequest, { DB: testDb.db })).status).toBe(409)

    const control = await app('staff').request('/api/operations/control?account_id=account-1', {}, { DB: testDb.db })
    expect(await control.json()).toMatchObject({ success: true, data: { states: { broadcast_dispatch: 'stopped' } } })
    const history = await app('staff').request('/api/operations/history', {}, { DB: testDb.db })
    expect(await history.json()).toMatchObject({
      success: true,
      data: expect.arrayContaining([expect.objectContaining({ reason: '誤配信', status: 'stopped' })]),
    })
  })

  it('停止中に保留した対象を、停止記録の詳細から取得できる', async () => {
    const stopped = await app().request('/api/operations/incidents', {
      method: 'POST', headers: await operationHeaders('owner', 'operation-stop', key(7), 'held-stop'),
      body: JSON.stringify({ lineAccountId: 'account-1', capabilities: ['broadcast_dispatch'], reason: '誤配信', expectedVersion: 0, confirmation: '停止' }),
    }, { DB: testDb.db })
    const stoppedBody = await stopped.json() as { data: { incident: { id: string } } }
    expect(await isOperationCapabilityStopped(testDb.db, 'account-1', 'broadcast_dispatch', {
      targetType: 'broadcast', targetId: 'broadcast-1', result: 'held',
    })).toBe(true)

    const detail = await app('staff').request(
      `/api/operations/incidents/${stoppedBody.data.incident.id}`,
      {},
      { DB: testDb.db },
    )
    expect(detail.status).toBe(200)
    expect(await detail.json()).toMatchObject({
      success: true,
      data: {
        incident: { id: stoppedBody.data.incident.id },
        targetResults: [{
          incidentId: stoppedBody.data.incident.id,
          capability: 'broadcast_dispatch',
          targetType: 'broadcast',
          targetId: 'broadcast-1',
          result: 'held',
        }],
      },
    })
  })

  it('期限切れの予約がある間は復旧を拒否し、整理後だけ復旧する', async () => {
    const stopped = await app().request('/api/operations/incidents', {
      method: 'POST', headers: await operationHeaders('owner', 'operation-stop', key(4), 'restore-test-stop'),
      body: JSON.stringify({ lineAccountId: 'account-1', capabilities: ['broadcast_dispatch'], reason: '障害', expectedVersion: 0, confirmation: '停止' }),
    }, { DB: testDb.db })
    const stoppedBody = await stopped.json() as { data: { control: { version: number }; incident: { id: string } } }
    testDb.raw.prepare(
      `INSERT INTO broadcasts
         (id, title, message_type, message_content, target_type, status, scheduled_at, line_account_id)
       VALUES ('broadcast-overdue', '期限切れ', 'text', '本文', 'all', 'scheduled', '2020-01-01T00:00:00.000Z', 'account-1')`,
    ).run()

    const preview = await app().request(
      `/api/operations/incidents/${stoppedBody.data.incident.id}/restore-preview`,
      { method: 'POST' },
      { DB: testDb.db },
    )
    const blockedPreview = await preview.json() as {
      data: { definitions: { previewHash: string }; canRestore: boolean; blockers: { broadcast_dispatch: number } }
    }
    expect(blockedPreview).toMatchObject({
      success: true,
      data: {
        canRestore: false,
        blockers: { broadcast_dispatch: 1 },
        definitions: { available: true, drift: [expect.objectContaining({ id: 'broadcast-overdue', change: 'added' })] },
      },
    })

    const restoreRequest = (headers: Record<string, string>, previewHash: string) => app().request(
      `/api/operations/incidents/${stoppedBody.data.incident.id}/restore`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ expectedVersion: stoppedBody.data.control.version, confirmation: '復旧', previewHash }),
      },
      { DB: testDb.db },
    )
    const blockedHeaders = await operationHeaders('owner', 'operation-restore', key(5), 'blocked-restore')
    expect((await restoreRequest(blockedHeaders, blockedPreview.data.definitions.previewHash)).status).toBe(409)
    testDb.raw.prepare("UPDATE broadcasts SET status = 'draft' WHERE id = 'broadcast-overdue'").run()
    const safePreviewResponse = await app().request(
      `/api/operations/incidents/${stoppedBody.data.incident.id}/restore-preview`,
      { method: 'POST' },
      { DB: testDb.db },
    )
    const safePreview = await safePreviewResponse.json() as { data: { definitions: { previewHash: string } } }
    const restoreHeaders = await operationHeaders('owner', 'operation-restore', key(6), 'successful-restore')
    expect((await restoreRequest(restoreHeaders, safePreview.data.definitions.previewHash)).status).toBe(200)
    const replayedRestore = await restoreRequest(restoreHeaders, safePreview.data.definitions.previewHash)
    expect(replayedRestore.status).toBe(200)
    expect(replayedRestore.headers.get('Idempotency-Replayed')).toBe('true')
  })

  it('復旧確認後に設定が変わった場合は復旧を止め、最新の差分を返す', async () => {
    testDb.raw.prepare(
      `INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
       VALUES ('scenario-restore', '復旧対象', 'manual', 1, 'account-1')`,
    ).run()
    const stopped = await app().request('/api/operations/incidents', {
      method: 'POST', headers: await operationHeaders('owner', 'operation-stop', key(9), 'drift-stop'),
      body: JSON.stringify({ lineAccountId: 'account-1', capabilities: ['scenario_dispatch'], reason: '障害', expectedVersion: 0, confirmation: '停止' }),
    }, { DB: testDb.db })
    const stoppedBody = await stopped.json() as { data: { control: { version: number }; incident: { id: string } } }
    const preview = await app().request(
      `/api/operations/incidents/${stoppedBody.data.incident.id}/restore-preview`,
      { method: 'POST' },
      { DB: testDb.db },
    )
    const previewBody = await preview.json() as { data: { definitions: { previewHash: string; drift: unknown[] } } }
    expect(previewBody.data.definitions.drift).toEqual([])
    testDb.raw.prepare("UPDATE scenarios SET name = '確認後に編集' WHERE id = 'scenario-restore'").run()

    const response = await app().request(
      `/api/operations/incidents/${stoppedBody.data.incident.id}/restore`,
      {
        method: 'POST',
        headers: await operationHeaders('owner', 'operation-restore', key(10), 'drift-restore'),
        body: JSON.stringify({
          expectedVersion: stoppedBody.data.control.version,
          confirmation: '復旧',
          previewHash: previewBody.data.definitions.previewHash,
        }),
      },
      { DB: testDb.db },
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('設定が変わりました'),
      data: { definitions: { drift: [expect.objectContaining({ id: 'scenario-restore', change: 'edited' })] } },
    })
    expect(await isOperationCapabilityStopped(testDb.db, 'account-1', 'scenario_dispatch')).toBe(true)
  })
})
