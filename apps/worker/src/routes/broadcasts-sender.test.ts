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

it('名前が変更された送り手の控えは検出され、同じ送り手を保存して更新できる', async () => {
  expect((await request('/api/broadcasts/draft/sender', 'PUT', { senderId: 'sender', expectedVersion: 1 })).status).toBe(200)
  db.raw.exec("UPDATE line_senders SET name='新しい名前' WHERE id='sender'")
  expect(await (await request('/api/broadcasts/draft/sender')).json()).toMatchObject({ data: { senderStale: true } })
  expect((await request('/api/broadcasts/draft/sender', 'PUT', { senderId: 'sender', expectedVersion: 2 })).status).toBe(200)
  expect(await (await request('/api/broadcasts/draft/sender')).json()).toMatchObject({ data: { senderStale: false, sender: { name: '新しい名前' } } })
})

it('送達記録のない配信と模擬配信を訂正できない理由を返す', async () => {
  db.raw.exec("UPDATE broadcasts SET status='sent' WHERE id='draft'")
  expect(await (await request('/api/broadcasts/draft/sender')).json()).toMatchObject({ data: { correctionReason: '模擬で送った配信は訂正できません。' } })
  db.raw.exec("DELETE FROM broadcast_execution_contexts WHERE broadcast_id='draft'")
  expect(await (await request('/api/broadcasts/draft/sender')).json()).toMatchObject({ data: { correctionReason: '送達記録がない配信は訂正できません。' } })
})

it('送り手が削除済みでも控えのずれを検出し店の名前を保存できる', async () => {
  expect((await request('/api/broadcasts/draft/sender', 'PUT', { senderId: 'sender', expectedVersion: 1 })).status).toBe(200)
  db.raw.exec("DELETE FROM line_senders WHERE id='sender'")
  expect(await (await request('/api/broadcasts/draft/sender')).json()).toMatchObject({ data: { senderStale: true } })
  expect((await request('/api/broadcasts/draft/sender', 'PUT', { senderId: null, expectedVersion: 2 })).status).toBe(200)
  expect(await (await request('/api/broadcasts/draft/sender')).json()).toMatchObject({ data: { senderStale: false, senderId: null, sender: null } })
})

it('複数店舗への配信は訂正できない理由を返す', async () => {
  db.raw.exec("UPDATE broadcasts SET status='sent',target_type='multi-account-dedup',line_account_id=NULL,account_ids='[\"a\"]' WHERE id='draft'; DELETE FROM broadcast_execution_contexts WHERE broadcast_id='draft'")
  expect(await (await request('/api/broadcasts/draft/sender')).json()).toMatchObject({ data: { correctionReason: '複数の店への配信は訂正できません。' } })
})

it('元配信に訂正の下書きがあればその ID を返し、送信済みなら訂正済みを返す', async () => {
  db.raw.exec("INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status,line_account_id) VALUES('origin','元','text','文','all','sent','a'); INSERT INTO broadcast_sender_corrections(broadcast_id,correction_of_broadcast_id,correction_request_key) VALUES('draft','origin','key')")
  expect(await (await request('/api/broadcasts/origin/sender')).json()).toMatchObject({ data: { correctionDraftId: 'draft', correctionReason: null } })
  db.raw.exec("UPDATE broadcasts SET status='sent' WHERE id='draft'")
  expect(await (await request('/api/broadcasts/origin/sender')).json()).toMatchObject({ data: { correctionDraftId: null, correctionReason: 'この配信は訂正済みです。' } })
})
