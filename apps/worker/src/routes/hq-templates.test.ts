import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { hqTemplates } from './hq-templates.js';
import { routeClassification } from '../middleware/feature-enforcement.js';

const definition = { schemaVersion: 1, tag: { name: '常連', color: '#123456', description: 'ご案内', folderId: 'child' }, folders: [{ id: 'child', name: 'ご利用', parentId: 'root' }, { id: 'root', name: 'お客様' }] };
let sql: Database.Database, db: D1Database, app: Hono<Env>, staff: AuthenticatedStaff, images: R2Bucket;
function count(table: string) { return (sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n; }
async function request(path: string, method = 'GET', body?: unknown, extraHeaders: Record<string,string> = {}) {
  const response = await app.request(`/api/hq/templates${path}`, { method, headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: db, IMAGES: images, WORKER_URL: 'https://worker.test' } as Env['Bindings']);
  return { status: response.status, body: await response.json() as any };
}
async function create() {
  const result = await request('', 'POST', { type: 'tag', name: 'ご利用タグ', definition, requestId: crypto.randomUUID() });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body.data.template;
}
async function preflight(id: string, accounts = ['a1','a2','a3']) {
  const r = await request(`/${id}/preflight`, 'POST', { accountIds: accounts });
  expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.data;
}
function selections(p: any, duplicateMode = 'overwrite') {
  return p.stores.flatMap((s: any) => s.items.map((i: any) => ({ accountId: s.accountId, sourceId: i.sourceId, mode: i.duplicate ? duplicateMode : 'create' })));
}
async function execute(id: string, p: any, selected = selections(p)) {
  return request(`/${id}/distribute`, 'POST', { preflightId: p.preflightId, resolutions: selected });
}
beforeEach(() => {
  const fixture = createTestD1({ foreignKeys: true }); sql = fixture.raw; db = fixture.db;
  sql.exec("INSERT INTO tenants(id,name) VALUES ('tenant-a','統括A'),('tenant-b','統括B')");
  for (const id of ['a1','a2','a3','b1']) sql.prepare(`INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id,liff_id) VALUES (?,?,?,'fixture','fixture',?,?)`).run(id, id, `fixture-${id}`, id === 'b1' ? 'tenant-b' : 'tenant-a', `liff-${id}`);
  sql.exec("INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES ('owner','管理者','owner','fixture-owner','tenant-a')");
  staff = { id: 'owner', name: '管理者', role: 'owner', readOnly: false, tenantId: 'tenant-a' };
  images = { head: async () => null, get: async () => null, put: async () => null, delete: async () => undefined } as unknown as R2Bucket;
  app = new Hono<Env>();
  app.use('*', async (c,next) => { c.set('staff', staff); await next(); }); app.route('/', hqTemplates);
});
afterEach(() => sql.close());

describe('HQ tag HTTP and real SQLite boundaries', () => {
  test('CRUD, immutable versions, tenant list and logical archive are audited', async () => {
    const t = await create(); expect(t.template_type).toBe('tag');
    expect((await request('')).body.data.map((t: any) => t.id)).toEqual([t.id]);
    const accounts = await request('/accounts'); expect(accounts.body.data.map((a: any) => a.id)).toEqual(['a1','a2','a3']);
    expect(JSON.stringify(accounts.body)).not.toContain('channel_');
    const update = await request(`/${t.id}`, 'PATCH', { name: '改訂', definition, expectedRevision: t.revision });
    expect(update.status).toBe(200); expect(count('hq_template_versions')).toBe(2);
    expect((await request(`/${t.id}`, 'PATCH', { name: '古い編集', definition, expectedRevision: t.revision })).status).toBe(409);
    expect((await request(`/${t.id}`, 'DELETE', { expectedRevision: update.body.data.template.revision })).status).toBe(200);
    expect((await request(`/${t.id}`)).status).toBe(404); expect(count('hq_templates')).toBe(1); expect(count('audit_events')).toBe(3);
    expect(routeClassification('/api/hq/templates/x/distribute','POST')?.kind).toBe('core');
  });
  test('creation response loss retries the same ID, version and audit once', async () => {
    const body = {requestId:crypto.randomUUID(),type:'tag',name:'再送検査',definition}, original=db.batch.bind(db); let lost=false;
    db.batch = (async statements => { const result=await original(statements); if(!lost){lost=true;throw new Error('response lost');}return result; }) as D1Database['batch'];
    const first=await request('','POST',body), replay=await request('','POST',body);
    expect(first.status).toBe(201); expect(replay).toEqual(first);
    expect(count('hq_templates')).toBe(1);expect(count('hq_template_versions')).toBe(1);expect(count('operation_request_receipts')).toBe(1);expect(count('audit_events')).toBe(1);
  });
  test('creation keys bind the entire payload but JSON member order is immaterial', async () => {
    const body={requestId:crypto.randomUUID(),type:'tag',name:'元の名前',definition};
    const first=await request('','POST',body);expect(first.status).toBe(201);
    expect(await request('','POST',{definition,name:body.name,type:body.type,requestId:body.requestId})).toEqual(first);
    for(const change of [{name:'別の名前'},{type:'form'},{definition:null},{description:'新しい説明'},{ignoredExtra:'different'}]){
      const r=await request('','POST',{...body,...change});expect(r.status).toBe(409);expect(r.body.code).toBe('IDEMPOTENCY_CONFLICT');
    }
    expect(count('hq_templates')).toBe(1);expect(count('hq_template_versions')).toBe(1);
  });
  test('same key replays across authorized actors in one tenant but is independent across tenants', async () => {
    const body={requestId:crypto.randomUUID(),type:'tag',name:'統括単位',definition},first=await request('','POST',body);
    sql.exec("INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES ('admin2','別管理者','admin','fixture-admin2','tenant-a'),('owner-b','別統括','owner','fixture-owner-b','tenant-b')");
    staff={id:'admin2',name:'別管理者',role:'admin',readOnly:false,tenantId:'tenant-a'};expect(await request('','POST',body)).toEqual(first);
    staff={id:'owner-b',name:'別統括',role:'owner',readOnly:false,tenantId:'tenant-b'};const second=await request('','POST',body);
    expect(second.status).toBe(201);expect(second.body.data.template.id).not.toBe(first.body.data.template.id);expect(count('hq_templates')).toBe(2);
    staff.readOnly=true;expect((await request('','POST',body)).status).toBe(403);
    staff.readOnly=false;staff.tenantId='tenant-a';expect((await request('','POST',body)).status).toBe(403);
  });
  test('edits and archive do not change or recreate the original creation result', async () => {
    const body={requestId:crypto.randomUUID(),type:'tag',name:'元のひな形',definition},first=await request('','POST',body),t=first.body.data.template;
    const changed=await request(`/${t.id}`,'PATCH',{name:'編集済み',definition,expectedRevision:t.revision});
    expect(changed.status).toBe(200);expect(await request('','POST',body)).toEqual(first);
    await request(`/${t.id}`,'DELETE',{expectedRevision:changed.body.data.template.revision});
    expect(await request('','POST',body)).toEqual(first);expect(count('hq_templates')).toBe(1);
    expect((await request(`/${t.id}`)).status).toBe(404);
  });
  test('simultaneous create requests converge and failed transactions keep the key reusable', async () => {
    const body={requestId:crypto.randomUUID(),type:'tag',name:'同時作成',definition},original=db.batch.bind(db);let tail:Promise<unknown>=Promise.resolve();
    db.batch=((statements:D1PreparedStatement[])=>{const next=tail.then(()=>original(statements));tail=next.catch(()=>{});return next;}) as D1Database['batch'];
    const replies=await Promise.all([request('','POST',body),request('','POST',body)]);expect(replies[0].status).toBe(201);expect(replies[1]).toEqual(replies[0]);expect(count('hq_templates')).toBe(1);
    sql.exec("CREATE TRIGGER reject_create BEFORE INSERT ON hq_template_versions BEGIN SELECT RAISE(ABORT,'synthetic'); END");
    const retryBody={...body,requestId:crypto.randomUUID()};expect((await request('','POST',retryBody)).status).toBe(500);expect(count('operation_request_receipts')).toBe(1);
    sql.exec('DROP TRIGGER reject_create');expect((await request('','POST',retryBody)).status).toBe(201);expect(count('hq_templates')).toBe(2);
  });
  test('header keys work, missing/conflicting keys fail, and receipt loss cannot duplicate resources', async () => {
    const key=crypto.randomUUID(),body={type:'tag',name:'ヘッダー',definition};
    expect((await request('','POST',body)).status).toBe(400);
    expect((await request('','POST',{...body,requestId:'another-key'},{'Idempotency-Key':key})).status).toBe(400);
    const first=await request('','POST',body,{'Idempotency-Key':key});expect(first.status).toBe(201);
    expect(await request('','POST',{...body,requestId:key})).toEqual(first);
    sql.exec("DELETE FROM operation_request_receipts WHERE action='hq_template.create'");
    const lost=await request('','POST',body,{'Idempotency-Key':key});expect(lost.status).toBe(409);expect(lost.body.code).toBe('CREATE_RECEIPT_UNAVAILABLE');expect(count('hq_templates')).toBe(1);
  });
  test('three stores receive same name and mapped folders; retry is exactly once', async () => {
    const t = await create(), p = await preflight(t.id), result = await execute(t.id,p);
    expect(result.status, JSON.stringify(result.body)).toBe(200); expect(result.body.data.status).toBe('completed');
    expect(result.body.data.stores.every((s: any) => s.counts.created === 3)).toBe(true);
    expect(count('tags')).toBe(3); expect(count('folders')).toBe(6);
    const rows = sql.prepare(`SELECT t.line_account_id,f.account_id,p.account_id AS parent_account FROM tags t JOIN folders f ON f.id=t.folder_id JOIN folders p ON p.id=f.parent_id`).all() as any[];
    expect(rows.every(r => r.line_account_id === r.account_id && r.account_id === r.parent_account)).toBe(true);
    expect((await execute(t.id,p)).body.data).toEqual(result.body.data); expect(count('tags')).toBe(3);
    expect((await request(`/${t.id}/distributions/${p.preflightId}`)).body.data).toEqual(result.body.data);
    expect(count('audit_events')).toBe(5);
    expect(sql.prepare("SELECT after_json FROM audit_events WHERE action='hq_template.distributed'").all()).toEqual(Array(3).fill({ after_json: JSON.stringify({ runId: p.preflightId }) }));
    expect(() => sql.prepare("INSERT INTO tags(id,name,normalized_name,line_account_id) VALUES ('bad','常連 ','常連','a1')").run()).toThrow();
    expect(sql.pragma('foreign_key_check')).toEqual([]);
  });
  test('overwrite keeps tag ID, friend assignment and unrelated settings', async () => {
    const t = await create(); await execute(t.id,await preflight(t.id,['a1']));
    const tag = sql.prepare("SELECT * FROM tags WHERE line_account_id='a1'").get() as any;
    sql.prepare("UPDATE tags SET mileage_reward=71,manual_assignment_allowed=0 WHERE id=?").run(tag.id);
    sql.exec("INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('friend','fixture-friend','a1')");
    sql.prepare("INSERT INTO friend_tags(friend_id,tag_id,assigned_at) VALUES ('friend',?,'original')").run(tag.id);
    const p = await preflight(t.id,['a1']); expect(p.stores[0].items.every((i: any) => i.duplicate)).toBe(true);
    const r = await execute(t.id,p); expect(r.body.data.status).toBe('completed');
    expect(sql.prepare('SELECT id,mileage_reward,manual_assignment_allowed FROM tags').get()).toEqual({ id: tag.id, mileage_reward: 71, manual_assignment_allowed: 0 });
    expect(sql.prepare('SELECT * FROM friend_tags').get()).toEqual({ friend_id:'friend',tag_id:tag.id,assigned_at:'original' });
  });
  test('aliases use (2), (3) per store and map folders to new parents', async () => {
    const t = await create(); await execute(t.id,await preflight(t.id,['a1']));
    for (let n = 2; n <= 3; n++) { const p = await preflight(t.id,['a1']); const r = await execute(t.id,p,selections(p,'alias')); expect(r.body.data.status).toBe('completed'); }
    expect(sql.prepare('SELECT name FROM tags ORDER BY name').all()).toEqual([{name:'常連'},{name:'常連 (2)'},{name:'常連 (3)'}]);
    expect(count('folders')).toBe(6); expect(sql.pragma('foreign_key_check')).toEqual([]);
  });
  test('mixed tenant targets fail before all writes and return no secret details', async () => {
    const t = await create(); const p = await request(`/${t.id}/preflight`,'POST',{accountIds:['a1','b1']});
    expect(p.status).toBe(403); expect(count('hq_template_preflights')).toBe(0); expect(count('tags')).toBe(0);
    const valid = await preflight(t.id,['a1','a2']); sql.exec("UPDATE line_accounts SET tenant_id='tenant-b' WHERE id='a2'");
    expect((await execute(t.id,valid)).status).toBe(403); expect(count('hq_template_distribution_runs')).toBe(0);
    staff.tenantId = 'tenant-b'; expect((await request(`/${t.id}`)).status).toBe(403);
  });
  test('active admin has the same tenant-wide boundary as owner', async () => {
    sql.exec("UPDATE staff_members SET role='admin'"); staff.role='admin';
    const t = await create(); expect((await execute(t.id,await preflight(t.id,['a1']))).body.data.status).toBe('completed');
  });
  test.each(['readOnly','databaseReadOnly','staff','scoped','inactive','missingTenant','missingActor'])('%s cannot read or mutate any HQ API', async kind => {
    const t = await create();
    if (kind==='readOnly') staff.readOnly=true;
    if (kind==='databaseReadOnly') sql.exec("UPDATE staff_members SET access_level='read_only'");
    if (kind==='staff') sql.exec("UPDATE staff_members SET role='staff'");
    if (kind==='scoped') sql.exec("UPDATE staff_members SET account_scope='accounts'");
    if (kind==='inactive') sql.exec('UPDATE staff_members SET is_active=0');
    if (kind==='missingTenant') staff.tenantId=null;
    if (kind==='missingActor') staff.id='unknown';
    for (const [path,method] of [['','GET'],['/accounts','GET'],[`/${t.id}`,'GET'],['','POST'],[`/${t.id}`,'PATCH'],[`/${t.id}`,'DELETE'],[`/${t.id}/preflight`,'POST'],[`/${t.id}/distribute`,'POST'],[`/${t.id}/distributions/run`,'GET']]) {
      expect((await request(path,method,method==='GET'?undefined:{})).status).toBe(403);
    }
    expect(count('hq_template_versions')).toBe(1); expect(count('hq_template_preflights')).toBe(0);
  });
  test('one stale store fails while others finish; failed-only new preflight does not repeat successes', async () => {
    const t = await create(), p = await preflight(t.id);
    sql.exec("INSERT INTO tags(id,name,normalized_name,line_account_id) VALUES ('parallel','別編集','別編集','a2')");
    const r = await execute(t.id,p); expect(r.body.data.status).toBe('partial');
    expect(r.body.data.stores.map((s: any) => s.status)).toEqual(['succeeded','version_conflict','succeeded']);
    const retry = await execute(t.id,await preflight(t.id,['a2'])); expect(retry.body.data.status).toBe('completed');
    expect(count('tags')).toBe(4); expect((await execute(t.id,p)).body.data).toEqual(r.body.data);
  });
  test('SQL failure rolls back all folders for one store, records public failure and continues', async () => {
    const t = await create(), p = await preflight(t.id);
    sql.exec("CREATE TRIGGER synthetic_failure BEFORE INSERT ON tags WHEN NEW.line_account_id='a2' BEGIN SELECT RAISE(ABORT,'internal-sensitive-diagnostic'); END");
    const r = await execute(t.id,p); expect(r.body.data.status).toBe('partial');
    expect(r.body.data.stores[1].status).toBe('failed'); expect(JSON.stringify(r.body)).not.toContain('internal-sensitive');
    expect(sql.prepare("SELECT count(*) AS n FROM folders WHERE account_id='a2'").get()).toEqual({n:0});
    expect(count('tags')).toBe(2); expect(count('hq_template_distribution_results')).toBe(3);
    sql.exec('DROP TRIGGER synthetic_failure'); expect((await execute(t.id,await preflight(t.id,['a2']))).body.data.status).toBe('completed');
  });
  test('response loss after successful transaction is recovered without duplicate writes', async () => {
    const t = await create(), p = await preflight(t.id,['a1']), original = db.batch.bind(db); let lost=false;
    db.batch = (async statements => { const result = await original(statements); if (!lost && count('hq_template_distribution_results')===1) {lost=true; throw new Error('response lost');} return result; }) as D1Database['batch'];
    const r = await execute(t.id,p); expect(lost).toBe(true); expect(r.body.data.status).toBe('completed');
    expect((await execute(t.id,p)).body.data).toEqual(r.body.data); expect(count('tags')).toBe(1);
  });
  test('last-moment concurrent edit is checked inside store transaction', async () => {
    const t = await create(), p = await preflight(t.id,['a1']), original = db.batch.bind(db); let changed=false;
    db.batch = (async statements => { if (!changed) { changed=true; sql.exec("INSERT INTO tags(id,name,normalized_name,line_account_id) VALUES ('race','同時編集','同時編集','a1')"); } return original(statements); }) as D1Database['batch'];
    const r = await execute(t.id,p); expect(r.body.data.stores[0].status).toBe('version_conflict');
    expect(count('folders')).toBe(0); expect(count('tags')).toBe(1);
  });
  test('expired preflight, archived duplicate, and missing or changed selections cannot implement silently', async () => {
    const t = await create(), p = await preflight(t.id,['a1']);
    expect((await execute(t.id,p,[])).status).toBe(409); expect(count('hq_template_distribution_runs')).toBe(0);
    sql.exec("UPDATE hq_template_preflights SET expires_at='2000-01-01T00:00:00.000Z'");
    expect((await execute(t.id,p)).body.data.stores[0].status).toBe('version_conflict'); expect(count('tags')).toBe(0);
    const fresh = await preflight(t.id,['a1']); await execute(t.id,fresh);
    expect((await execute(t.id,fresh,selections(fresh).map((s: any)=>({...s,mode:'alias'})))).status).toBe(409);
    sql.exec("UPDATE tags SET status='archived'"); const archived = await preflight(t.id,['a1']);
    expect(archived.stores[0].items.find((i: any)=>i.itemKind==='tag').allowedModes).toEqual(['alias']);
    expect((await execute(t.id,archived)).body.data.stores[0].status).toBe('failed');
    expect(count('tags')).toBe(1);
  });
  test('simultaneous same request converges on one store result', async () => {
    const t = await create(), p = await preflight(t.id,['a1']);
    // D1 serializes whole batches. Keep that property in the asynchronous SQLite adapter.
    const original = db.batch.bind(db); let tail: Promise<unknown> = Promise.resolve();
    db.batch = ((statements: D1PreparedStatement[]) => { const next = tail.then(() => original(statements)); tail = next.catch(() => {}); return next; }) as D1Database['batch'];
    const responses = await Promise.all([execute(t.id,p),execute(t.id,p)]);
    expect(responses.map(r => r.status)).toEqual([200,200]); expect(responses[0].body.data).toEqual(responses[1].body.data);
    expect(count('tags')).toBe(1); expect(count('hq_template_distribution_results')).toBe(1);
  });
  test('concurrent different decisions are bound before the first store writes', async () => {
    const t = await create(); await execute(t.id,await preflight(t.id,['a1']));
    const p = await preflight(t.id,['a1']);
    const responses = await Promise.all([execute(t.id,p,selections(p,'overwrite')),execute(t.id,p,selections(p,'alias'))]);
    expect(responses.map(r => r.status).sort()).toEqual([200,409]);
    expect(count('tags')).toBe(1); expect(count('hq_template_distribution_results')).toBe(2);
  });
  test('interrupted run retains its decision claim and resumes only the same request', async () => {
    const t = await create(); await execute(t.id,await preflight(t.id,['a1']));
    const p = await preflight(t.id,['a1']), original = db.batch.bind(db);
    db.batch = (async () => { throw new Error('synthetic interruption'); }) as D1Database['batch'];
    expect((await execute(t.id,p)).status).toBe(500);
    const pending = await request(`/${t.id}/distributions/${p.preflightId}`);
    expect(pending.body.data.status).toBe('running'); expect(pending.body.data.stores[0].status).toBe('pending');
    db.batch = original;
    expect((await execute(t.id,p,selections(p,'alias'))).status).toBe(409);
    expect((await execute(t.id,p)).body.data.status).toBe('completed'); expect(count('tags')).toBe(1);
  });
  test('account moves after preflight reads are rejected before persisting its snapshot', async () => {
    const t = await create(), original = db.batch.bind(db);
    db.batch = (async statements => { sql.exec("UPDATE line_accounts SET tenant_id='tenant-b' WHERE id='a2'"); return original(statements); }) as D1Database['batch'];
    const response = await request(`/${t.id}/preflight`,'POST',{accountIds:['a1','a2']});
    expect(response.status).toBe(500); expect(count('hq_template_preflights')).toBe(0);
    expect(response.body.data).toBeUndefined();
  });
  test('all four portable template types can be saved, replayed, filtered and edited', async () => {
    const definitions = {
      tag: definition,
      template: { schemaVersion: 1, template: { id: 'notice', name: 'お知らせ', messageType: 'text', messageContent: 'ご案内' }, media: [] },
      rich_menu: { schemaVersion: 1, richMenu: { id: 'menu', name: 'ご案内', chatBarText: 'メニュー', size: 'large', defaultPageId: 'page', pages: [{ id: 'page', name: 'メイン', imageR2Key: 'hq-templates/tenant-a/menu.png', areas: [{ id: 'area', bounds: { x: 0, y: 0, width: 100, height: 100 }, actionType: 'message', actionData: { text: 'ご案内' }, intent: 'text' }] }] } },
      form: { schemaVersion: 1, form: { name: 'アンケート', description: null, fields: [{ name: 'answer', label: '回答', type: 'text', required: true }], layout: null, on_submit_tag_id: null, on_submit_scenario_id: null, save_to_metadata: true } },
    } as const;
    for (const type of ['tag', 'template', 'rich_menu', 'form'] as const) {
      const input = { type, name: `${type}ひな形`, definition: definitions[type], requestId: crypto.randomUUID() };
      const created = await request('', 'POST', input);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body.data.template.template_type).toBe(type);
      expect(await request('', 'POST', input)).toEqual(created);
      const filtered = await request(`?type=${type}`);
      expect(filtered.body.data.map((item: any) => item.id)).toEqual([created.body.data.template.id]);
      if (type === 'form') {
        const checked = await request(`/${created.body.data.template.id}/preflight`, 'POST', { accountIds: ['a1', 'a2', 'a3'] });
        expect(checked.status, JSON.stringify(checked.body)).toBe(200);
        expect(checked.body.data.stores).toHaveLength(3);
        expect(checked.body.data.stores.every((store: any) => store.items[0].itemKind === 'form' && store.items[0].allowedModes[0] === 'create')).toBe(true);
      }
      const edited = await request(`/${created.body.data.template.id}`, 'PATCH', { name: `${type}改訂`, definition: definitions[type], expectedRevision: created.body.data.template.revision });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(edited.body.data.template.template_type).toBe(type);
    }
    expect(count('hq_templates')).toBe(4);
    expect(count('hq_template_versions')).toBe(8);
  });
  test('message templates preflight and distribute through the HTTP route without external sends', async () => {
    sql.exec("INSERT INTO templates(id,name,message_type,message_content,line_account_id) VALUES ('source-template','お知らせ','text','ご案内','a1')");
    const messageDefinition = { schemaVersion: 1, template: { id: 'source-template', name: 'お知らせ', category: 'general', messageType: 'text', messageContent: 'ご案内', carouselActionsJson: null, carouselTapLimitMode: 'none', carouselTapLimitText: null, questionJson: null, questionStatus: 'draft' }, media: [] };
    const created = await request('', 'POST', { type: 'template', name: 'お知らせ', definition: messageDefinition, requestId: crypto.randomUUID() });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const checked = await preflight(created.body.data.template.id, ['a2', 'a3']);
    expect(checked.stores.every((store: any) => store.items.length === 1 && store.items[0].itemKind === 'template')).toBe(true);
    const distributed = await execute(created.body.data.template.id, checked);
    expect(distributed.status, JSON.stringify(distributed.body)).toBe(200);
    expect(distributed.body.data.status).toBe('completed');
    expect(sql.prepare("SELECT line_account_id,name FROM templates ORDER BY line_account_id").all()).toEqual([
      { line_account_id: 'a1', name: 'お知らせ' }, { line_account_id: 'a2', name: 'お知らせ' }, { line_account_id: 'a3', name: 'お知らせ' },
    ]);
  });
  test('form templates distribute privately, bind reference choices on redistribution and isolate conflicts', async () => {
    sql.exec("INSERT INTO tags(id,name,line_account_id) VALUES ('source-tag','ご購入済み','a1'); INSERT INTO scenarios(id,name,trigger_type,line_account_id,is_active) VALUES ('source-scenario','ご購入後のご案内','manual','a1',1); INSERT INTO scenario_steps(id,scenario_id,step_order,message_type,message_content) VALUES ('source-step','source-scenario',1,'text','ありがとうございます')");
    const formDefinition = { schemaVersion: 1, form: { name: 'ご利用アンケート', description: '確認用', fields: [{ name: 'answer', label: '回答', type: 'text', required: true }], layout: null, on_submit_tag_id: 'source-tag', on_submit_scenario_id: 'source-scenario', save_to_metadata: true } };
    const created = await request('', 'POST', { type: 'form', name: '回答フォーム', definition: formDefinition, requestId: crypto.randomUUID() });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const first = await preflight(created.body.data.template.id);
    const distributed = await execute(created.body.data.template.id, first);
    expect(distributed.status, JSON.stringify(distributed.body)).toBe(200);
    expect(distributed.body.data.status).toBe('completed');
    expect(count('forms')).toBe(3);
    const mapped = sql.prepare(`SELECT fa.line_account_id AS account_id,f.is_active,t.line_account_id AS tag_account,s.line_account_id AS scenario_account FROM forms f JOIN form_accounts fa ON fa.form_id=f.id JOIN tags t ON t.id=f.on_submit_tag_id JOIN scenarios s ON s.id=f.on_submit_scenario_id ORDER BY fa.line_account_id`).all() as Array<{ account_id: string; is_active: number; tag_account: string; scenario_account: string }>;
    expect(mapped).toEqual(['a1','a2','a3'].map(account_id => ({ account_id, is_active: 0, tag_account: account_id, scenario_account: account_id })));
    expect((await execute(created.body.data.template.id, first)).body.data).toEqual(distributed.body.data);
    expect(count('forms')).toBe(3);
    const scenarioIds = sql.prepare("SELECT line_account_id,id FROM scenarios ORDER BY line_account_id").all();

    const second = await preflight(created.body.data.template.id);
    expect(second.stores.every((store: any) => store.items.some((item: any) => item.sourceId === 'scenario:source-scenario' && item.itemKind === 'scenario' && item.duplicate && item.allowedModes.includes('overwrite')))).toBe(true);
    const a2 = sql.prepare(`SELECT f.id FROM forms f JOIN form_accounts fa ON fa.form_id=f.id WHERE fa.line_account_id='a2'`).get() as { id: string };
    sql.prepare(`UPDATE forms SET content_revision=content_revision+1 WHERE id=?`).run(a2.id);
    const retried = await execute(created.body.data.template.id, second);
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body.data.status).toBe('partial');
    expect(retried.body.data.stores.map((store: any) => store.status)).toEqual(['succeeded','version_conflict','succeeded']);
    expect(count('forms')).toBe(3);
    expect(sql.prepare("SELECT line_account_id,id FROM scenarios ORDER BY line_account_id").all()).toEqual(scenarioIds);
    expect(sql.pragma('foreign_key_check')).toEqual([]);
  });
  test('a consumed form preflight keeps its immutable overwrite decision after bounded failure', async () => {
    const formDefinition = { schemaVersion: 1, form: { name: '再実行フォーム', description: null, fields: [{ name: 'answer', label: '回答', type: 'text', required: true }], layout: null, on_submit_tag_id: null, on_submit_scenario_id: null, save_to_metadata: true } };
    const created = await request('', 'POST', { type: 'form', name: '再実行フォーム', definition: formDefinition, requestId: crypto.randomUUID() });
    const first = await preflight(created.body.data.template.id, ['a1']);
    expect((await execute(created.body.data.template.id, first)).body.data.status).toBe('completed');
    const retry = await preflight(created.body.data.template.id, ['a1']);
    sql.exec("CREATE TRIGGER reject_form_update BEFORE UPDATE ON forms BEGIN SELECT RAISE(ABORT,'fixture'); END");
    const interrupted = await execute(created.body.data.template.id, retry, selections(retry, 'overwrite'));
    expect(interrupted.status).toBe(200);expect(interrupted.body.data.status).toBe('failed');
    const replay = await execute(created.body.data.template.id, retry, selections(retry, 'overwrite'));
    expect(replay.status).toBe(200);expect(replay.body.data.status).toBe('failed');
    sql.exec('DROP TRIGGER reject_form_update');
  });
  test('invalid definitions, cyclic or unrelated folders are rejected', async () => {
    expect((await request('','POST',{type:'form',name:'不正',definition,requestId:crypto.randomUUID()})).status).toBe(400);
    for (const folders of [[{id:'child',name:'循環',parentId:'child'}],[...definition.folders,{id:'unrelated',name:'不要'}]]) {
      expect((await request('','POST',{type:'tag',name:'不正',definition:{...definition,folders},requestId:crypto.randomUUID()})).status).toBe(400);
    }
    expect(count('hq_templates')).toBe(0);
  });
});
