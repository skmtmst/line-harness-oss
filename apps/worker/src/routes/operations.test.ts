import { beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index.js'
import { createTestD1 } from '../test-utils/d1-sqlite.js'
import { operations } from './operations.js'

function app(role: 'owner' | 'admin' | 'staff' = 'owner') {
  const instance = new Hono<Env>()
  instance.use('*', async (c, next) => {
    c.set('staff', { id: `${role}-1`, name: role, role, readOnly: false })
    await next()
  })
  instance.route('/', operations)
  return instance
}

let testDb: ReturnType<typeof createTestD1>

beforeEach(() => {
  testDb = createTestD1()
  testDb.raw.prepare("INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES ('account-1', 'channel', 'LINE', 'token', 'secret')").run()
})

describe('運用状態API', () => {
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
  })

  it('全体停止はownerだけ、アカウント停止はadminも実行できる', async () => {
    const denied = await app('admin').request('/api/operations/incidents', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-confirm-irreversible': 'operation-stop' },
      body: JSON.stringify({ lineAccountId: null, capabilities: ['broadcast_dispatch'], reason: '障害', expectedVersion: 0, confirmation: '停止' }),
    }, { DB: testDb.db })
    expect(denied.status).toBe(403)

    const allowed = await app('admin').request('/api/operations/incidents', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-confirm-irreversible': 'operation-stop' },
      body: JSON.stringify({ lineAccountId: 'account-1', capabilities: ['broadcast_dispatch'], reason: '障害', expectedVersion: 0, confirmation: '停止' }),
    }, { DB: testDb.db })
    expect(allowed.status).toBe(201)
    expect(await allowed.json()).toMatchObject({ success: true, data: { control: { version: 1, activeIncidentId: expect.any(String) } } })
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
      headers: { 'content-type': 'application/json', 'x-confirm-irreversible': 'operation-stop' },
      body: JSON.stringify({ lineAccountId: 'account-1', capabilities: ['broadcast_dispatch'], reason: '誤配信', expectedVersion: 0, confirmation: '停止' }),
    }
    expect((await app().request('/api/operations/incidents', request, { DB: testDb.db })).status).toBe(201)
    expect((await app().request('/api/operations/incidents', request, { DB: testDb.db })).status).toBe(409)

    const control = await app('staff').request('/api/operations/control?account_id=account-1', {}, { DB: testDb.db })
    expect(await control.json()).toMatchObject({ success: true, data: { states: { broadcast_dispatch: 'stopped' } } })
    const history = await app('staff').request('/api/operations/history', {}, { DB: testDb.db })
    expect(await history.json()).toMatchObject({
      success: true,
      data: expect.arrayContaining([expect.objectContaining({ reason: '誤配信', status: 'stopped' })]),
    })
  })
})
