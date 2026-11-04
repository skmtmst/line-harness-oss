import { afterEach, beforeEach, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../worker-env.js'
import type { AuthenticatedStaff } from '../middleware/auth/principal/auth.js'
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js'
import { saveSimulationDraft, scheduleSimulation, simulationPreview } from '../features/broadcasts/broadcast-simulation/index.js'
import { createBroadcastCorrection } from './broadcasts-correction.js'

let db: SqliteD1
const owner: AuthenticatedStaff = { id: 'owner', name: '担当者', role: 'owner', readOnly: false, tenantId: 't' }
function request(key: string | null, staff = owner, origin = 'original', impersonation = false) {
  const app = new Hono<Env>()
  app.use('*', async (c, next) => { c.env = { DB: db.db } as Env['Bindings']; c.set('staff', staff); if (impersonation) c.set('impersonation', { id: 'i', tenantId: 't', mode: 'write', piiRevealed: false, startedAt: '' }); await next() })
  app.post('/api/broadcasts/:id/correction', createBroadcastCorrection)
  return app.request(`/api/broadcasts/${origin}/correction`, { method: 'POST', headers: key ? { 'Idempotency-Key': key } : {} })
}
beforeEach(() => {
  db = createTestD1()
  db.raw.exec(`INSERT INTO tenants(id,name) VALUES('t','店'),('other','別');
    INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('a','a','店','x','x','t'),('b','b','別','x','x','other');
    INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status,line_account_id) VALUES('original','配信','text','文','tag','sent','a'),('foreign','別','text','文','all','sent','b');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES('sent','sent','a'),('failed','failed','a'),('unknown','unknown','a'),('ab','ab','a');
    INSERT INTO broadcast_send_claims(broadcast_id,friend_id,line_account_id,state) VALUES('original','sent','a','sent'),('original','failed','a','failed'),('original','unknown','a','unknown');
    INSERT INTO broadcast_ab_recipients(broadcast_id,friend_id,variant_key,state) VALUES('original','ab','A','sent');`)
})
afterEach(() => db.raw.close())

it('送達済みだけを模擬の対象にし、同じキーの二重操作では下書きを増やさない', async () => {
  const first = await request('same-key'); expect(first.status).toBe(201)
  const id = ((await first.json()) as { data: { broadcastId: string } }).data.broadcastId
  const next = await request('same-key'); expect(((await next.json()) as { data: { broadcastId: string }; replayed: boolean })).toMatchObject({ data: { broadcastId: id }, replayed: true })
  expect(await simulationPreview(db.db, id)).toMatchObject({ matched: 2, recipients: 2, testMode: true })
  expect(db.raw.prepare('SELECT correction_of_broadcast_id FROM broadcast_sender_corrections WHERE broadcast_id=?').get(id)).toEqual({ correction_of_broadcast_id: 'original' })
  expect(db.raw.prepare('SELECT execution_mode FROM broadcast_execution_contexts WHERE broadcast_id=?').get(id)).toEqual({ execution_mode: 'simulation' })
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM broadcast_sender_corrections').get()).toEqual({ n: 1 })
})

it('権限がない人・他店・代理を拒み、空の送達記録を全員扱いにしない', async () => {
  expect((await request(null)).status).toBe(400)
  expect((await request('x', { ...owner, readOnly: true })).status).toBe(403)
  expect((await request('x', owner, 'original', true)).status).toBe(403)
  expect((await request('x', owner, 'foreign')).status).toBe(404)
  db.raw.exec("UPDATE broadcast_send_claims SET state='failed'; UPDATE broadcast_ab_recipients SET state='failed'")
  expect((await request('x')).status).toBe(409)
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM broadcast_sender_corrections').get()).toEqual({ n: 0 })
})

it('all でも元の絞り込み条件がある時は送達済み以外を除く', async () => {
  db.raw.exec("UPDATE broadcasts SET target_type='all',segment_conditions='{}' WHERE id='original'")
  const response = await request('filtered-all'); expect(response.status).toBe(201)
  const id = ((await response.json()) as { data: { broadcastId: string } }).data.broadcastId
  expect(await simulationPreview(db.db, id)).toMatchObject({ matched: 2, recipients: 2 })
})

it('全員向けでも送達記録にない友だちを含めず、記録がなければ作成しない', async () => {
  db.raw.exec("UPDATE broadcasts SET target_type='all',segment_conditions=NULL WHERE id='original'")
  const response = await request('all-with-records'); expect(response.status).toBe(201)
  const id = ((await response.json()) as { data: { broadcastId: string } }).data.broadcastId
  expect(await simulationPreview(db.db, id)).toMatchObject({ matched: 2, recipients: 2 })
  db.raw.exec("UPDATE broadcast_send_claims SET state='failed'; UPDATE broadcast_ab_recipients SET state='failed'")
  expect((await request('all-without-records')).status).toBe(409)
})

it('A/B の全員向けでも、試しと残りで送達済みの人だけを含める', async () => {
  db.raw.exec("UPDATE broadcasts SET target_type='all' WHERE id='original'; INSERT INTO broadcast_ab_tests(broadcast_id,test_ratio_pct,metric,decide_after_minutes,status) VALUES('original',10,'click',60,'finished')")
  const response = await request('ab-test'); expect(response.status).toBe(201)
  const id = ((await response.json()) as { data: { broadcastId: string } }).data.broadcastId
  expect(await simulationPreview(db.db, id)).toMatchObject({ matched: 2, recipients: 2 })
})

it('模擬の確定時に担当者と送り手の名前を控え、古い送り手名なら受け付けない', async () => {
  db.raw.exec("INSERT INTO line_senders(id,account_id,name,visibility,status,version,created_by,updated_at,idempotency_key,request_json) VALUES('sender','a','配信係','all','active',1,'owner','now','key','{}')")
  const response = await request('snapshot'); expect(response.status).toBe(201)
  const id = ((await response.json()) as { data: { broadcastId: string } }).data.broadcastId
  db.raw.prepare("UPDATE broadcast_sender_corrections SET sender_id='sender',sender_snapshot_json=? WHERE broadcast_id=?").run('{"name":"配信係"}',id)
  const p = await simulationPreview(db.db, id)
  db.raw.exec("UPDATE line_senders SET name='新しい係' WHERE id='sender'")
  await expect(scheduleSimulation(db.db,id,{expectedVersion:p.version,confirmedRecipientCount:p.recipients,testMode:true},'stale',new Date('2026-10-16T03:00:00Z'),owner)).rejects.toMatchObject({code:'version_conflict'})
  expect(db.raw.prepare('SELECT status FROM broadcasts WHERE id=?').get(id)).toEqual({status:'draft'})
  db.raw.prepare("UPDATE broadcast_sender_corrections SET sender_snapshot_json=? WHERE broadcast_id=?").run('{"name":"新しい係"}',id)
  await scheduleSimulation(db.db,id,{expectedVersion:p.version,confirmedRecipientCount:p.recipients,testMode:true},'ok',new Date('2026-10-16T03:00:00Z'),owner)
  expect(db.raw.prepare('SELECT sent_by_staff_id,sent_by_staff_name,sender_snapshot_json FROM broadcast_sender_corrections WHERE broadcast_id=?').get(id)).toEqual({sent_by_staff_id:'owner',sent_by_staff_name:'担当者',sender_snapshot_json:'{"name":"新しい係"}'})
})

it('事前確認と最終確認は同じ送達済み人数を返し、対象変更は拒否する', async () => {
  const response = await request('preview'); expect(response.status).toBe(201)
  const id = ((await response.json()) as { data: { broadcastId: string } }).data.broadcastId
  const { broadcasts } = await import('./broadcasts.js')
  const app = new Hono<Env>()
  app.use('*', async (c, next) => { c.env = { DB: db.db } as Env['Bindings']; c.set('staff', owner); await next() })
  app.route('/', broadcasts)
  const preview = await app.request('/api/broadcasts/preflight', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({draftId:id,lineAccountId:'a',targetType:'all'}) })
  expect(preview.status).toBe(200)
  expect((await preview.json()) as unknown).toMatchObject({data:{audienceCount:2}})
  const final = await app.request(`/api/broadcasts/${id}/send-preview`)
  expect(final.status).toBe(200)
  expect((await final.json()) as unknown).toMatchObject({data:{recipients:2,testMode:true}})
  const edit = await app.request(`/api/broadcasts/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({expectedVersion:1,targetType:'tag',targetTagId:'other'}) })
  expect(edit.status).toBe(409)
  const testSend = await app.request(`/api/broadcasts/${id}/test-send`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' })
  expect(testSend.status).toBe(409)
  expect(await testSend.json()).toMatchObject({ error: 'simulation_transport_only' })
})

it('模擬下書きの別の保存口でも宛先と元配信の目的を変更できない', async () => {
  const response = await request('fixed-purpose'); expect(response.status).toBe(201)
  const id = ((await response.json()) as { data: { broadcastId: string } }).data.broadcastId
  const input = { testMode: true, title: '訂正', text: '訂正します', expectedVersion: 1, purpose: 'marketing' }
  await expect(saveSimulationDraft(db.db, 'a', 'owner', 'edit', { ...input, targetTagId: 'other' }, id)).rejects.toMatchObject({ code: 'correction_audience_or_purpose_fixed' })
  await expect(saveSimulationDraft(db.db, 'a', 'owner', 'edit', { ...input, purpose: 'notice' }, id)).rejects.toMatchObject({ code: 'correction_audience_or_purpose_fixed' })
  expect(db.raw.prepare('SELECT target_type, lock_version FROM broadcasts WHERE id=?').get(id)).toEqual({ target_type: 'all', lock_version: 1 })
})
