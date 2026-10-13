import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { createFriendAddRuleDraft, getFriendAddRule, archiveFriendAddRule, listFriendAddRulesPage } from '@line-crm/db';
import { createCommonAction, listCommonActions } from '../services/common-actions.js';
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: async (_db: unknown, _staff: unknown, ids: string[]) => ids.every(id => id === 'a'),
  getVisibleLineAccountScope: async () => ({ ids: ['a'] }),
}));
import events from './events.js';
import booking from './booking.js';
import { friendAddRules } from './friend-add-rules.js';
let sql: SqliteD1;
function app(role: 'owner' | 'staff' = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c,next) => { c.set('staff', { id:'o', name:'Owner', role, readOnly: role === 'staff', permissionKeys: [], tenantId: 't' }); await next(); });
  app.route('/',events); app.route('/',booking); app.route('/',friendAddRules);
  return app;
}
function request(path: string, method: string, body?: unknown, role: 'owner' | 'staff' = 'owner', key?: string) {
  return app(role).request(path, { method, headers:{'content-type':'application/json', ...(key ? {'Idempotency-Key':key}: {})},body:body === undefined ? undefined : JSON.stringify(body) }, {DB:sql.db});
}
beforeEach(() => {
  sql=createTestD1();
  for (const id of ['a','b']) sql.raw.prepare('INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret) VALUES (?,?,?,?,?)').run(id,id,id,'token','secret');
});
afterEach(() => sql.raw.close());
it('イベントは枠と設定を複製し、公開や申込は引き継がず、版・権限・アカウントの違いを拒否する',async () => {
  sql.raw.exec(`INSERT INTO events(id,line_account_id,name,venue_address,is_published,lifecycle_status,questions_json) VALUES ('ev','a','教室','住所',1,'published','[]');
    INSERT INTO event_slots(id,event_id,starts_at,ends_at,capacity) VALUES ('slot','ev','2099-01-01T01:00:00Z','2099-01-01T02:00:00Z',20);`);
  const path='/api/events/admin/events/ev/duplicate?account_id=a';
  expect((await request(path,'POST',{expectedVersion:2})).status).toBe(409);
  expect((await request(path,'POST',{expectedVersion:1},'staff')).status).toBe(403);
  expect((await request('/api/events/admin/events/ev/duplicate?account_id=b','POST',{expectedVersion:1})).status).toBe(403);
  const response=await request(path,'POST',{expectedVersion:1}); expect(response.status).toBe(201);
  const copy=await response.json() as {id:string};
  expect(sql.raw.prepare('SELECT name,venue_address,is_published,lifecycle_status,version FROM events WHERE id=?').get(copy.id)).toMatchObject({name:'教室（複製）',venue_address:'住所',is_published:0,lifecycle_status:'draft',version:1});
  expect(sql.raw.prepare('SELECT capacity FROM event_slots WHERE event_id=?').all(copy.id)).toEqual([{capacity:20}]);
  expect(sql.raw.prepare('SELECT COUNT(*) n FROM event_bookings WHERE event_id=?').get(copy.id)).toEqual({n:0});
});
it('予約メニューは未使用だけ削除し、予約履歴がある場合と他アカウントは拒否する',async () => {
  sql.raw.exec(`INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES ('free','a','未使用',60,0),('used','a','使用済み',60,0),('other','b','他店',60,0);
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','u','a');
    INSERT INTO staff(id,line_account_id,name,display_name,role) VALUES('o','a','Owner','Owner','owner');
    INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at)
      VALUES('reservation','a','f','o','used','2099-01-01','2099-01-02','2099-01-02','cancelled',0,'2026-10-09');`);
  const path=(id:string)=>`/api/booking/admin/menus/${id}?account_id=a`;
  expect((await request(path('used'),'DELETE')).status).toBe(409);
  expect(sql.raw.prepare("SELECT deleted_at FROM menus WHERE id='used'").get()).toEqual({deleted_at:null});
  expect((await request(path('other'),'DELETE')).status).toBe(404);
  expect((await request(path('free'),'DELETE')).status).toBe(200);
  expect(sql.raw.prepare("SELECT deleted_at FROM menus WHERE id='free'").get()).not.toEqual({deleted_at:null});
});
it('初回案内の保管一覧・復元は下書きと未テストに戻し、古い版を拒否する',async () => {
  const rule=await createFriendAddRuleDraft(sql.db,{lineAccountId:'a',friendKind:'first_time',name:'案内',priority:1});
  sql.raw.prepare("UPDATE friend_add_rule_versions SET last_test_status='succeeded' WHERE rule_id=?").run(rule.id);
  await archiveFriendAddRule(sql.db,{lineAccountId:'a',ruleId:rule.id});
  expect((await listFriendAddRulesPage(sql.db,{lineAccountId:'a',friendKind:'first_time',status:'archived'})).items.map(x=>x.id)).toContain(rule.id);
  const archived=await getFriendAddRule(sql.db,{lineAccountId:'a',ruleId:rule.id,includeArchived:true});
  const path=`/api/friend-add-rules/${rule.id}/unarchive?account_id=a`;
  expect((await request(path,'POST',{expectedVersion:rule.lock_version})).status).toBe(409);
  expect((await request(path,'POST',{expectedVersion:archived!.lock_version},'staff')).status).toBe(403);
  expect((await request(path,'POST',{expectedVersion:archived!.lock_version})).status).toBe(200);
  expect(await getFriendAddRule(sql.db,{lineAccountId:'a',ruleId:rule.id})).toMatchObject({status:'draft',archived_at:null,last_test_status:null});
});
it('初回案内の複製は保存済み内容を下書きへ写し、同じ操作の再送で増えない',async () => {
  const rule=await createFriendAddRuleDraft(sql.db,{lineAccountId:'a',friendKind:'returning',name:'再登録',priority:3});
  const path=`/api/friend-add-rules/${rule.id}/duplicate?account_id=a`;
  expect((await request(path,'POST',{expectedVersion:2},'owner','operation-key-1234')).status).toBe(409);
  const first=await request(path,'POST',{expectedVersion:1},'owner','operation-key-1234');expect(first.status).toBe(201);
  const second=await request(path,'POST',{expectedVersion:1},'owner','operation-key-1234');expect(await second.json()).toEqual(await first.json());
  expect(sql.raw.prepare('SELECT COUNT(*) n FROM friend_add_rules').get()).toEqual({n:2});
});
it('公開していた初回案内の復元は、新しい未テスト版を作り、公開履歴を残す', async () => {
  const rule = await createFriendAddRuleDraft(sql.db, { lineAccountId: 'a', friendKind: 'first_time', name: '公開案内', priority: 2 });
  sql.raw.prepare("UPDATE friend_add_rule_versions SET status='published', last_test_status='succeeded' WHERE rule_id=?").run(rule.id);
  sql.raw.prepare("UPDATE friend_add_rules SET current_version_id=?, status='published' WHERE id=?").run(rule.version_id, rule.id);
  await archiveFriendAddRule(sql.db, { lineAccountId: 'a', ruleId: rule.id });
  const archived = await getFriendAddRule(sql.db, { lineAccountId: 'a', ruleId: rule.id, includeArchived: true });
  const response = await request(`/api/friend-add-rules/${rule.id}/unarchive?account_id=a`, 'POST', { expectedVersion: archived!.lock_version });
  expect(response.status).toBe(200);
  expect(await getFriendAddRule(sql.db, { lineAccountId: 'a', ruleId: rule.id })).toMatchObject({ status: 'draft', version_status: 'draft', version_number: 2, last_test_status: null });
  expect(sql.raw.prepare("SELECT status, last_test_status FROM friend_add_rule_versions WHERE id=?").get(rule.version_id)).toEqual({ status: 'published', last_test_status: 'succeeded' });
});
it('追加した操作も不正な版番号は欄ごとのエラーで返す', async () => {
  sql.raw.exec("INSERT INTO events(id,line_account_id,name) VALUES ('ev','a','教室')");
  const response = await request('/api/events/admin/events/ev/duplicate?account_id=a', 'POST', { expectedVersion: '1' });
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ fields: { expectedVersion: expect.any(String) } });
});
it('共通アクションのフォルダ絞り込みはページと件数が一致し、未分類と他店を混ぜない',async () => {
  sql.raw.exec("INSERT INTO folders(id,kind,name,account_id) VALUES('folder','common_action','分類','a')");
  const a=await createCommonAction(sql.db,{lineAccountId:'a',name:'分類内',actions:[{id:'wait',type:'wait',params:{minutes:5},onFailure:'stop'}]});
  await createCommonAction(sql.db,{lineAccountId:'a',name:'未分類',actions:[{id:'wait',type:'wait',params:{minutes:5},onFailure:'stop'}]});
  await createCommonAction(sql.db,{lineAccountId:'b',name:'他店',actions:[{id:'wait',type:'wait',params:{minutes:5},onFailure:'stop'}]});
  sql.raw.prepare('UPDATE common_actions SET folder_id=? WHERE id=?').run('folder',a.id);
  const found=await listCommonActions(sql.db,{lineAccountId:'a',folderId:'folder',limit:1});
  expect(found.total).toBe(1);expect(found.items.map(x=>x.id)).toEqual([a.id]);
  const unfiled=await listCommonActions(sql.db,{lineAccountId:'a',folderId:'__unfiled__'});
  expect(unfiled.total).toBe(1);expect(unfiled.items.map(x=>x.name)).toEqual(['未分類']);
});

it('複製したイベントを先頭に出し、次ページと重複せず他店の行も出さない', async () => {
  sql.raw.exec("INSERT INTO events(id,line_account_id,name) VALUES ('first','a','A'),('copy','a','Z'),('other','b','他店')");
  const path = '/api/events/admin/events?account_id=a&sort=name&highlight=copy&limit=1';
  const first = await (await request(`${path}&page=1`, 'GET')).json() as { items: Array<{id:string}>; total:number };
  const second = await (await request(`${path}&page=2`, 'GET')).json() as { items: Array<{id:string}>; total:number };
  expect(first.items.map(item => item.id)).toEqual(['copy']);
  expect(second.items.map(item => item.id)).toEqual(['first']);
  expect(first.total).toBe(2);
});

it('初回案内は複製を先頭に出し、1件ずつのページ送りでも優先順位の低い行を飛ばさない', async () => {
  const first = await createFriendAddRuleDraft(sql.db, { lineAccountId: 'a', friendKind: 'first_time', name: '先の案内', priority: 1 });
  const copy = await createFriendAddRuleDraft(sql.db, { lineAccountId: 'a', friendKind: 'first_time', name: '複製', priority: 100 });
  const last = await createFriendAddRuleDraft(sql.db, { lineAccountId: 'a', friendKind: 'first_time', name: '次の案内', priority: 2 });
  const query = { lineAccountId: 'a', friendKind: 'first_time' as const, highlightId: copy.id, status: 'draft' as const, limit: 1 };
  const pages = [];
  let cursor: string | null = null;
  do {
    const page = await listFriendAddRulesPage(sql.db, { ...query, cursor });
    expect(page.total).toBe(3);
    pages.push(...page.items.map(item => item.id));
    cursor = page.nextCursor;
  } while (cursor && pages.length < 5);
  expect(pages).toEqual([copy.id, first.id, last.id]);
  const foreign = await listFriendAddRulesPage(sql.db, { ...query, lineAccountId: 'b' });
  expect(foreign.items).toEqual([]);
  const response = await request(`/api/friend-add-rules?account_id=a&kind=first_time&status=draft&limit=1&highlight=${copy.id}`, 'GET');
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: { items: [{ id: copy.id }] } });
});
