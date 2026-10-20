import { Hono } from 'hono';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { HqTemplate } from '@line-crm/db';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { hqTemplates } from './hq-templates.js';
import { hqFormTests } from './hq-form-tests.js';

let sql: ReturnType<typeof createTestD1>, app: Hono<Env>, staff: Env['Variables']['staff'];
interface Envelope<T> { success: boolean; data: T; code?: string; archive_counts: {active: number; archived: number}; stats: {totalTemplates: number; distributedAccountCount: number} }
async function call<T = unknown>(path: string, method = 'GET', body?: unknown) {
  const response = await app.request(`https://worker.test/api/hq/templates${path}`, {
    method, headers: {'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  }, {DB: sql.db} as Env['Bindings']);
  return {status: response.status, body: await response.json() as Envelope<T>};
}
const definitions = {
  mark: {schemaVersion: 1, mark: {name: '相談中', isDefault: true, autoOnInbound: true}},
  tag: {schemaVersion: 1, tag: {name: '常連'}, folders: []},
  friend_field: {schemaVersion: 1, field: {name: 'ペット名', fieldKey: 'pet_name', type: 'text'}, folders: []},
  form: {schemaVersion: 1, form: {name: '相談', description: null, fields: [{name: 'name', label: '名前', type: 'text'}], layout: null, on_submit_tag_id: null, on_submit_scenario_id: null, save_to_metadata: false}},
};
async function create(type: keyof typeof definitions = 'mark', folderId?: string) {
  const result = await call<{template: HqTemplate}>('', 'POST', {type, name: type, definition: definitions[type], folderId, requestId: crypto.randomUUID()});
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body.data.template;
}
async function archive(template: HqTemplate) {
  expect((await call(`/${template.id}`, 'DELETE', {expectedRevision: template.revision})).status).toBe(200);
  return template.revision + 1;
}
beforeEach(() => {
  sql = createTestD1({foreignKeys: true});
  sql.raw.exec("INSERT INTO tenants(id,name) VALUES('t','HQ'),('other','Other'); INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','Owner','owner','fixture','t'); INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES('a','Store','a','fixture','fixture','t')");
  staff = {id: 'owner', name: 'Owner', role: 'owner', tenantId: 't', readOnly: false};
  app = new Hono<Env>();
  app.use('*', async (c, next) => {c.set('staff', staff); await next();});
  app.route('/', hqTemplates);
  vi.stubGlobal('fetch', vi.fn(() => {throw new Error('External service must not run');}));
});
afterEach(() => {sql.raw.close(); vi.unstubAllGlobals();});

test.each(['mark', 'friend_field', 'tag'] as const)('%s: archive list/counts and restore preserve the saved version', async type => {
  const tables = ['messages_log', 'hq_template_distribution_runs', 'support_marks', 'friend_fields', 'tags'];
  const before = tables.map(table => sql.raw.prepare(`SELECT * FROM ${table}`).all());
  const template = await create(type), versions = sql.raw.prepare('SELECT * FROM hq_template_versions').all();
  const revision = await archive(template);
  const active = await call<HqTemplate[]>(`?type=${type}`);
  expect(active.body.data).toEqual([]);
  expect(active.body.archive_counts).toEqual({active: 0, archived: 1});
  const archived = await call<HqTemplate[]>(`?type=${type}&status=archived`);
  expect(archived.body.data).toMatchObject([{id: template.id, revision, current_version_id: template.current_version_id}]);
  expect(archived.body.data[0].archived_at).toBeTruthy();
  expect(JSON.stringify(archived.body)).not.toContain('definition_json');
  expect((await call(`/${template.id}`)).status).toBe(404);
  expect((await call(`/${template.id}`, 'PATCH', {name: 'changed', definition: definitions[type], expectedRevision: revision})).status).toBe(404);
  expect((await call(`/${template.id}/preflight`, 'POST', {accountIds: ['a']})).status).toBe(404);
  const restored = await call(`/${template.id}/restore`, 'POST', {expectedRevision: revision});
  expect(restored.body.data).toEqual({id: template.id, archived: false, revision: revision + 1});
  expect((await call<HqTemplate[]>(`?type=${type}`)).body.data[0]).toMatchObject({id: template.id, archived_at: null, current_version_id: template.current_version_id});
  expect((await call<HqTemplate[]>(`?type=${type}&status=archived`)).body.data).toEqual([]);
  expect(sql.raw.prepare('SELECT * FROM hq_template_versions').all()).toEqual(versions);
  expect(sql.raw.prepare("SELECT count(*) n FROM audit_events WHERE action='hq_template.restored'").get()).toEqual({n: 1});
  tables.forEach((table, i) => expect(sql.raw.prepare(`SELECT * FROM ${table}`).all()).toEqual(before[i]));
  expect(fetch).not.toHaveBeenCalled();
  expect(sql.raw.pragma('foreign_key_check')).toEqual([]);
});

test('counts use the requested type/kind and status does not leak into other pickers', async () => {
  const archivedMark = await create(), activeMark = await create(), tag = await create('tag');
  await archive(archivedMark); await archive(tag); await create('friend_field');
  for (const status of ['active', 'archived', 'all']) {
    const result = await call<HqTemplate[]>(`?kind=support_mark&status=${status}`);
    expect(result.body.archive_counts).toEqual({active: 1, archived: 1});
    expect(result.body.data.map(row => row.id).sort()).toEqual((status === 'all' ? [activeMark.id, archivedMark.id] : [status === 'active' ? activeMark.id : archivedMark.id]).sort());
    expect(result.body.stats.totalTemplates).toBe(status === 'all' ? 2 : 1);
  }
  const tags = await call<HqTemplate[]>('?kind=tag&status=archived');
  expect(tags.body.data.map(row => row.id)).toEqual([tag.id]);
  expect(tags.body.archive_counts).toEqual({active: 0, archived: 1});
  expect((await call('/attribute-kind-counts')).body.data).toEqual({tag: 0, friend_field: 1, support_mark: 1});
  expect((await call('?status=invalid')).status).toBe(400);
});

test.each(['mark', 'tag'] as const)('distributed %s remains in the store; expired confirmations cannot be reused', async type => {
  const template = await create(type), table = type === 'mark' ? 'support_marks' : 'tags';
  const preflight = await call<{preflightId: string; stores: {accountId: string; items: {sourceId: string}[]}[]}>(`/${template.id}/preflight`, 'POST', {accountIds: ['a']});
  const input = {preflightId: preflight.body.data.preflightId, resolutions: preflight.body.data.stores.flatMap(store => store.items.map(item => ({accountId: store.accountId, sourceId: item.sourceId, mode: 'create'})))};
  expect((await call(`/${template.id}/distribute`, 'POST', input)).status).toBe(200);
  const storeBefore = sql.raw.prepare(`SELECT * FROM ${table}`).all();
  const pending = await call<{preflightId: string; stores: {accountId: string; items: {sourceId: string}[]}[]}>(`/${template.id}/preflight`, 'POST', {accountIds: ['a']});
  const revision = await archive(template);
  const archived = await call<{distributed_account_count: number}[]>(`?type=${type}&status=archived`);
  expect(archived.body.data[0].distributed_account_count).toBe(1);
  if (type === 'mark') expect(archived.body.stats.distributedAccountCount).toBe(1);
  expect((await call(`/${template.id}/restore`, 'POST', {expectedRevision: revision})).status).toBe(200);
  expect(sql.raw.prepare('SELECT status FROM hq_template_preflights WHERE idempotency_fingerprint=?').get(pending.body.data.preflightId)).toEqual({status: 'expired'});
  const stale = await call(`/${template.id}/distribute`, 'POST', {preflightId: pending.body.data.preflightId, resolutions: pending.body.data.stores.flatMap(store => store.items.map(item => ({accountId: store.accountId, sourceId: item.sourceId, mode: 'overwrite'})))});
  expect(stale.status).toBe(409);
  expect(sql.raw.prepare(`SELECT * FROM ${table}`).all()).toEqual(storeBefore);
  expect(sql.raw.prepare('SELECT count(*) n FROM hq_template_distribution_runs').get()).toEqual({n: 1});
});

test('concurrent restore and stale or invalid revisions produce only one audit/write', async () => {
  const template = await create(), revision = await archive(template);
  for (const expectedRevision of [null, undefined, '3', 0, -1, 1.5]) expect((await call(`/${template.id}/restore`, 'POST', {expectedRevision})).status).toBe(400);
  expect((await call(`/${template.id}/restore`, 'POST', {expectedRevision: revision - 1})).status).toBe(409);
  const results = await Promise.all([call(`/${template.id}/restore`, 'POST', {expectedRevision: revision}), call(`/${template.id}/restore`, 'POST', {expectedRevision: revision})]);
  expect(results.map(result => result.status).sort()).toEqual([200, 409]);
  expect(sql.raw.prepare("SELECT count(*) n FROM audit_events WHERE action='hq_template.restored'").get()).toEqual({n: 1});
  expect((await call(`/${template.id}/restore`, 'POST', {expectedRevision: revision + 1})).status).toBe(409);
  expect((await call('/missing/restore', 'POST', {expectedRevision: revision})).status).toBe(404);
});

test('read-only, account-scoped, inactive and foreign identities cannot restore', async () => {
  const template = await create(), expectedRevision = await archive(template), path = `/${template.id}/restore`;
  staff.readOnly = true;
  expect((await call('?type=mark&status=archived')).status).toBe(200);
  expect((await call(path, 'POST', {expectedRevision})).status).toBe(403);
  staff.readOnly = false;
  for (const change of ["access_level='read_only'", "access_level='full',account_scope='accounts'", "account_scope='all',role='staff'", "role='owner',is_active=0"]) {
    sql.raw.exec(`UPDATE staff_members SET ${change} WHERE id='owner'`);
    expect((await call(path, 'POST', {expectedRevision})).status).toBe(403);
  }
  sql.raw.exec("UPDATE staff_members SET is_active=1,tenant_id='other' WHERE id='owner'");
  expect((await call(path, 'POST', {expectedRevision})).status).toBe(403);
  staff.tenantId = 'other';
  expect((await call<HqTemplate[]>('?status=all')).body.data).toEqual([]);
  expect((await call(path, 'POST', {expectedRevision})).status).toBe(404);
  expect(sql.raw.prepare("SELECT count(*) n FROM audit_events WHERE action='hq_template.restored'").get()).toEqual({n: 0});
});

test('restore keeps a valid folder and falls back to unfiled after its removal', async () => {
  sql.raw.exec("INSERT INTO hq_template_folders(id,tenant_id,name) VALUES('f','t','Folder')");
  const template = await create('mark', 'f');
  let revision = await archive(template);
  expect((await call(`/${template.id}/restore`, 'POST', {expectedRevision: revision})).status).toBe(200);
  expect((await call<{template: HqTemplate}>(`/${template.id}`)).body.data.template.folder_id).toBe('f');
  revision = await archive({...template, revision: revision + 1});
  sql.raw.exec("UPDATE hq_template_folders SET archived_at='2026-10-15' WHERE id='f'");
  expect((await call(`/${template.id}/restore`, 'POST', {expectedRevision: revision})).status).toBe(200);
  expect((await call<{template: HqTemplate}>(`/${template.id}`)).body.data.template.folder_id).toBeNull();
});

test('restoring a form revokes old public test tokens; failure rolls back the whole operation', async () => {
  const template = await create('form');
  const issued = await call<{id: string; token: string}>(`/${template.id}/test-token`, 'POST', {expectedRevision: template.revision});
  expect(issued.status).toBe(201);
  const publicApp = new Hono<Env>(); publicApp.route('/', hqFormTests);
  const read = () => publicApp.request(`/api/liff/hq-form-tests/${template.id}`, {headers: {'X-Form-Test-Token': issued.body.data.token}}, {DB: sql.db} as Env['Bindings']);
  expect((await read()).status).toBe(200);
  const expectedRevision = await archive(template);
  expect((await read()).status).toBe(404);
  sql.raw.exec("CREATE TRIGGER fail_restore BEFORE INSERT ON audit_events WHEN NEW.action='hq_template.restored' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  expect((await call(`/${template.id}/restore`, 'POST', {expectedRevision})).status).toBe(500);
  expect(sql.raw.prepare('SELECT revoked_at FROM hq_form_test_tokens').get()).toEqual({revoked_at: null});
  expect((await call<HqTemplate[]>('?status=archived')).body.data[0].revision).toBe(expectedRevision);
  sql.raw.exec('DROP TRIGGER fail_restore');
  expect((await call(`/${template.id}/restore`, 'POST', {expectedRevision})).status).toBe(200);
  expect((await read()).status).toBe(404);
  expect((sql.raw.prepare('SELECT revoked_at FROM hq_form_test_tokens').get() as {revoked_at: string}).revoked_at).toBeTruthy();
  const newToken = await call(`/${template.id}/test-token`, 'POST', {expectedRevision: expectedRevision + 1});
  expect(newToken.status).toBe(201);
  expect(fetch).not.toHaveBeenCalled();
});

 test('distribution targets include unserved active accounts without making a confirmation',async()=>{
  const t=await create('tag');
  sql.raw.exec("INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id) VALUES('b','Other','b','x','x','t'),('foreign','Hidden','f','x','x','other')");
  const before=sql.raw.prepare('SELECT count(*) n FROM hq_template_preflights').get();
  const result=await call<{requiresPreflight:boolean;stores:{accountId:string;targetVersion:{version:number|null;status:string}}[]}>(`/${t.id}/distribution-targets`);
  expect(result.status).toBe(200);expect(result.body.data.requiresPreflight).toBe(true);
  expect(result.body.data.stores.map(s=>s.accountId).sort()).toEqual(['a','b']);
  expect(result.body.data.stores.every(s=>s.targetVersion.version===null&&s.targetVersion.status==='undistributed')).toBe(true);
  expect((await call(`/${t.id}/distribution-targets?accountIds=foreign`)).status).toBe(404);
  expect((await call(`/${t.id}/distribution-targets?accountIds=a,a`)).status).toBe(400);
  expect(sql.raw.prepare('SELECT count(*) n FROM hq_template_preflights').get()).toEqual(before);
 });
