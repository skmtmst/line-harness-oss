import { afterEach, beforeEach, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../worker-env.js'
import type { AuthenticatedStaff } from '../middleware/auth/principal/auth.js'
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js'
import { broadcasts } from './broadcasts.js'

let db: SqliteD1
const owner: AuthenticatedStaff = { id: 'owner', name: '担当者', role: 'owner', readOnly: false, tenantId: 't' }
function request(path: string, method = 'GET', body?: unknown, staff = owner, impersonation = false) {
  const app = new Hono<Env>()
  app.use('*', async (c, next) => { c.env = { DB: db.db } as Env['Bindings']; c.set('staff', staff); if (impersonation) c.set('impersonation', { id: 'i', tenantId: 't', mode: 'write', piiRevealed: false, startedAt: '' }); await next() })
  app.route('/', broadcasts)
  return app.request(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
}
beforeEach(() => {
  db = createTestD1()
  db.raw.exec(`INSERT INTO tenants(id,name) VALUES('t','店'),('other','別');
    INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('a','a','店','x','x','t'),('b','b','別','x','x','other');
    INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status,line_account_id) VALUES('draft','配信','text','文','all','draft','a'),('other','別','text','文','all','draft','b');
    INSERT INTO line_senders(id,account_id,name,visibility,status,version,created_by,updated_at,idempotency_key,request_json) VALUES('sender','a','配信係','all','active',1,'owner','now','key','{}');
    INSERT INTO broadcast_execution_contexts(broadcast_id,account_id,purpose,created_via,created_by,request_key,request_fingerprint) VALUES('draft','a','marketing','manual','owner','test-key','test');`)
})
afterEach(() => db.raw.close())

it('送り手を同じ店の下書きに名前だけの控えとして保存し、版を進める', async () => {
  const response = await request('/api/broadcasts/draft/sender', 'PUT', { senderId: 'sender', expectedVersion: 1 })
  expect(response.status).toBe(200)
  expect(db.raw.prepare('SELECT sender_id,sender_snapshot_json FROM broadcast_sender_corrections WHERE broadcast_id=?').get('draft')).toEqual({ sender_id: 'sender', sender_snapshot_json: '{"name":"配信係"}' })
  expect(((await (await request('/api/broadcasts/draft/sender')).json()) as { data: unknown }).data).toMatchObject({ senderId: 'sender', sender: { name: '配信係' }, version: 2 })
  expect((await request('/api/broadcasts/draft/sender', 'PUT', { senderId: null, expectedVersion: 1 })).status).toBe(409)
  expect(db.raw.prepare('SELECT sender_id FROM broadcast_sender_corrections WHERE broadcast_id=?').get('draft')).toEqual({ sender_id: 'sender' })
})

it('他店・閲覧のみ・代理・存在しない送り手を拒み、記録を残さない', async () => {
  expect((await request('/api/broadcasts/other/sender', 'PUT', { senderId: 'sender', expectedVersion: 1 })).status).toBe(404)
  expect((await request('/api/broadcasts/draft/sender', 'PUT', { senderId: 'sender', expectedVersion: 1 }, { ...owner, readOnly: true })).status).toBe(403)
  expect((await request('/api/broadcasts/draft/sender', 'PUT', { senderId: 'sender', expectedVersion: 1 }, owner, true)).status).toBe(403)
  expect((await request('/api/broadcasts/draft/sender', 'PUT', { senderId: 'missing', expectedVersion: 1 })).status).toBe(404)
  expect(db.raw.prepare('SELECT count(*) AS n FROM broadcast_sender_corrections').get()).toEqual({ n: 0 })
})

it('模擬でない配信には送り手を保存せず、失効した送り手を復元しない', async () => {
  db.raw.exec("DELETE FROM broadcast_execution_contexts WHERE broadcast_id='draft'")
  expect((await request('/api/broadcasts/draft/sender', 'PUT', { senderId: 'sender', expectedVersion: 1 })).status).toBe(409)
  db.raw.exec("INSERT INTO broadcast_execution_contexts(broadcast_id,account_id,purpose,created_via,created_by,request_key,request_fingerprint) VALUES('draft','a','marketing','manual','owner','test-key-2','test'); UPDATE line_senders SET status='inactive' WHERE id='sender'")
  expect((await request('/api/broadcasts/draft/sender', 'PUT', { senderId: 'sender', expectedVersion: 1 })).status).toBe(404)
  expect(db.raw.prepare('SELECT count(*) AS n FROM broadcast_sender_corrections').get()).toEqual({ n: 0 })
})
