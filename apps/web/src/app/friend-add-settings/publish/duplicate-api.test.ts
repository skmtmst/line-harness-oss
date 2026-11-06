import { afterEach, beforeEach, expect, it } from 'vitest'
import { Hono } from '../../../../../worker/node_modules/hono'
import { friendAddRules } from '../../../../../worker/src/routes/friend-add-rules'
import { createTestD1, type SqliteD1 } from '../../../../../worker/src/test-utils/d1-sqlite'
import type { Env } from '../../../../../worker/src/index'

let db: SqliteD1
const definition = { routeIds: ['route-1'], scenarioId: null, messageType: 'text', messageText: 'ようこそ', timing: 'immediate', actions: [], friendCondition: '', activeFrom: null, activeUntil: null }
function app(readOnly = false) {
  const server = new Hono<Env>()
  server.use('*', async (c, next) => {
    c.env = { DB: db.db } as Env['Bindings']
    c.set('staff', { id: 'owner-1', name: 'オーナー', role: 'owner', tenantId: 'tenant-1', readOnly })
    await next()
  })
  server.route('/', friendAddRules)
  return server
}
function request(accountId = 'account-1', version = 1) {
  return app().request(`/api/friend-add-rules/rule-1/duplicate?account_id=${accountId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'duplicate-u07-test-0001' }, body: JSON.stringify({ expectedVersion: version }) })
}
beforeEach(() => {
  db = createTestD1()
  db.raw.exec("INSERT INTO tenants (id,name) VALUES ('tenant-1','統括1'),('tenant-2','統括2'); INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret,is_active,tenant_id) VALUES ('account-1','channel-1','店舗1','token','secret',1,'tenant-1'),('account-2','channel-2','店舗2','token2','secret2',1,'tenant-2'); INSERT INTO staff_members (id,name,role,api_key,tenant_id) VALUES ('owner-1','オーナー','owner','owner-key','tenant-1'); INSERT INTO friend_add_rules (id,line_account_id,friend_kind,name,priority,status,current_version_id,created_at,updated_at) VALUES ('rule-1','account-1','first_time','店頭QR',1,'published','version-1','2026-10-18','2026-10-18');")
  db.raw.prepare("INSERT INTO friend_add_rule_versions (id,rule_id,version_number,definition_snapshot,status,published_at) VALUES ('version-1','rule-1',1,?,'published','2026-10-18')").run(JSON.stringify(definition))
})
afterEach(() => db.raw.close())

it('公開中の元を変えずに独立した下書きを複製し、別経路へ変更できる', async () => {
  const before = db.raw.prepare("SELECT * FROM friend_add_rules WHERE id='rule-1'").get()
  const originalVersion = db.raw.prepare("SELECT * FROM friend_add_rule_versions WHERE id='version-1'").get()
  const response = await request()
  expect(response.status).toBe(201)
  const { data } = await response.json() as { data: { id: string; status: string } }
  expect(data.id).not.toBe('rule-1')
  expect(data.status).toBe('draft')
  const copy = db.raw.prepare('SELECT * FROM friend_add_rule_versions WHERE rule_id=?').get(data.id) as { id: string; definition_snapshot: string }
  expect(JSON.parse(copy.definition_snapshot)).toMatchObject(definition)
  db.raw.prepare('UPDATE friend_add_rule_versions SET definition_snapshot=? WHERE id=?').run(JSON.stringify({ ...definition, routeIds: ['route-2'] }), copy.id)
  expect(db.raw.prepare("SELECT * FROM friend_add_rules WHERE id='rule-1'").get()).toEqual(before)
  expect(db.raw.prepare("SELECT * FROM friend_add_rule_versions WHERE id='version-1'").get()).toEqual(originalVersion)
})

it('所属外と古い版を断り、複製を増やさない', async () => {
  expect((await request('account-2')).status).toBe(404)
  expect((await request('account-1', 9)).status).toBe(409)
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM friend_add_rules').get()).toEqual({ n: 1 })
})

it('閲覧のみでは複製できない', async () => {
  const response = await app(true).request('/api/friend-add-rules/rule-1/duplicate?account_id=account-1', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'duplicate-u07-readonly' }, body: JSON.stringify({ expectedVersion: 1 }) })
  expect(response.status).toBe(403)
})
