import { afterEach, beforeEach, expect, test } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { chats } from './chats.js';
let fixture: SqliteD1;
beforeEach(() => {
  fixture = createTestD1({ foreignKeys: true });
  fixture.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES ('shop-a','a','店A','x','x'),('shop-b','b','店B','x','x');
    INSERT INTO staff_members(id,name,role,api_key,account_scope,permission_keys) VALUES
    ('actor','管理者','owner','key1','all','[]'),
    ('a-only','A担当','staff','key2','accounts','["/chats"]'),
    ('b-only','B担当','staff','key3','accounts','["/chats"]'),
    ('viewer','閲覧者','staff','key4','all','["/chats"]');
    UPDATE staff_members SET access_level='read_only' WHERE id='viewer';
    INSERT INTO staff_account_scopes(staff_id,line_account_id,created_at) VALUES ('a-only','shop-a','2026'),('b-only','shop-b','2026');`);
});
afterEach(() => fixture.raw.close());
function app() { const a = new Hono<Env>(); a.use('*', async (c,next) => { c.set('staff',{id:'actor',name:'管理者',role:'owner',readOnly:false}); await next(); }); a.route('/',chats); return a; }
test('担当の候補は選択した店で対応できるログインユーザーだけ', async () => {
  const response = await app().request('/api/operators?lineAccountId=shop-a',{}, {DB:fixture.db});
  expect(response.status).toBe(200);
  const data = await response.json() as {data:{id:string;name:string}[]};
  expect(data.data.map(x=>x.id).sort()).toEqual(['staff:a-only','staff:actor']);
});
test('別の店の人は指定できず、許可された人は新しい欄へ保存し旧記録を残す', async () => {
  fixture.raw.exec(`INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES ('friend','line','友だち','shop-a');
    INSERT INTO operators(id,name,email) VALUES ('old','旧名簿','old@example.test');
    INSERT INTO chats(id,friend_id,operator_id,status,created_at,updated_at) VALUES ('chat','friend','old','unread','2026','2026');`);
  const put = (operatorId:string|null,revision=0) => app().request('/api/chats/chat',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({operatorId,revision})},{DB:fixture.db});
  expect((await put('staff:b-only')).status).toBe(400);
  expect(fixture.raw.prepare('SELECT operator_id,assignee_staff_id FROM chats WHERE id=?').get('chat')).toEqual({operator_id:'old',assignee_staff_id:null});
  expect((await put('staff:a-only')).status).toBe(200);
  expect(fixture.raw.prepare('SELECT operator_id,assignee_staff_id FROM chats WHERE id=?').get('chat')).toEqual({operator_id:'old',assignee_staff_id:'a-only'});
  const details = await (await app().request('/api/chats/chat',{}, {DB:fixture.db})).json() as {data:{operatorId:string}};
  expect(details.data.operatorId).toBe('staff:a-only');
});
test('旧名簿のIDがユーザーIDと重なっても別人として扱う', async () => {
  fixture.raw.exec(`INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES ('friend','line','友だち','shop-a');
    INSERT INTO operators(id,name,email) VALUES ('a-only','旧担当','old@example.test');
    INSERT INTO chats(id,friend_id,operator_id,status,created_at,updated_at) VALUES ('chat','friend','a-only','unread','2026','2026');`);
  const res = await app().request('/api/chats/chat',{}, {DB:fixture.db});
  const data = await res.json() as {data:{operatorId:string}};
  expect(data.data.operatorId).toBe('a-only');
});
test('他の会社のユーザーや無効・権限なしの人を候補に含めない', async () => {
  fixture.raw.exec(`INSERT INTO tenants(id,name) VALUES('outside','別会社');
  INSERT INTO staff_members(id,name,role,api_key,tenant_id,account_scope,permission_keys) VALUES
  ('foreign','別会社','owner','key5','outside','all','[]'),
  ('disabled','停止','staff','key6',NULL,'all','["/chats"]'),
  ('no-chats','権限なし','staff','key7',NULL,'all','[]');
  UPDATE staff_members SET is_active=0 WHERE id='disabled';`);
  const response=await app().request('/api/operators?lineAccountId=shop-a',{}, {DB:fixture.db});
  expect(((await response.json()) as {data:{id:string}[]}).data.map(x=>x.id).sort()).toEqual(['staff:a-only','staff:actor']);
});
test('一覧・絞り込み・未読統計が新旧の担当を同じ意味で数える', async () => {
  fixture.raw.exec(`INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES ('f-new','line1','新担当','shop-a'),('f-old','line2','旧担当','shop-a');
  INSERT INTO operators(id,name,email) VALUES ('a-only','旧名簿の人','old@example.test');
  INSERT INTO chats(id,friend_id,operator_id,assignee_staff_id,status,last_message_at,created_at,updated_at) VALUES
  ('new','f-new',NULL,'a-only','unread','2026','2026','2026'),('old','f-old','a-only',NULL,'unread','2026','2026','2026');`);
  const req=async(path:string)=> (await app().request(path,{}, {DB:fixture.db})).json() as Promise<{data:any}>;
  const fresh=await req('/api/chats?lineAccountId=shop-a&operatorId=staff%3Aa-only');
  expect(fresh.data.map((x:{friendId:string})=>x.friendId)).toEqual(['f-new']);
  const old=await req('/api/chats?lineAccountId=shop-a&operatorId=a-only');
  expect(old.data.map((x:{friendId:string})=>x.friendId)).toEqual(['f-old']);
  const stats=await req('/api/chats/stats');
  expect(stats.data.assigneeUnread).toEqual(expect.arrayContaining([
    expect.objectContaining({operatorId:'staff:a-only',operatorName:'A担当',unread:1}),
    expect.objectContaining({operatorId:'a-only',operatorName:'旧名簿の人',unread:1}),
  ]));
});
test('担当ユーザーが削除されても過去の別人が新しい担当として復活しない', async () => {
  fixture.raw.exec(`INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES ('friend','line','友だち','shop-a');
    INSERT INTO operators(id,name,email) VALUES ('old','旧名簿','old@example.test');
    INSERT INTO chats(id,friend_id,operator_id,assignee_staff_id,status,created_at,updated_at) VALUES ('chat','friend','old','a-only','unread','2026','2026');
    DELETE FROM staff_members WHERE id='a-only';`);
  const data = await (await app().request('/api/chats/chat',{}, {DB:fixture.db})).json() as {data:{operatorId:string}};
  expect(data.data.operatorId).toBe('staff:a-only');
  const stats = await (await app().request('/api/chats/stats',{}, {DB:fixture.db})).json() as {data:{assigneeUnread:{operatorId:string;operatorName:string}[]}};
  expect(stats.data.assigneeUnread).toEqual(expect.arrayContaining([expect.objectContaining({operatorId:'staff:a-only',operatorName:'担当者不明'})]));
});
test('担当別の未読数は選択した店だけを数える', async () => {
  fixture.raw.exec(`INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES ('fa','la','A','shop-a'),('fb','lb','B','shop-b');
  INSERT INTO chats(id,friend_id,assignee_staff_id,status,created_at,updated_at) VALUES ('ca','fa','actor','unread','2026','2026'),('cb','fb','actor','unread','2026','2026');`);
  const res=await app().request('/api/chats/stats?lineAccountId=shop-a',{}, {DB:fixture.db});
  const body=await res.json() as {data:{assigneeUnread:{operatorId:string;unread:number}[]}};
  expect(body.data.assigneeUnread).toEqual(expect.arrayContaining([expect.objectContaining({operatorId:'staff:actor',unread:1})]));
});
test('担当を変えずメモだけ保存すると、旧名簿の記録は残る', async () => {
  fixture.raw.exec(`INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES ('friend','line','友だち','shop-a');
    INSERT INTO operators(id,name,email) VALUES ('old','旧名簿','old@example.test');
    INSERT INTO chats(id,friend_id,operator_id,status,created_at,updated_at) VALUES ('chat','friend','old','unread','2026','2026');`);
  const response=await app().request('/api/chats/chat',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({operatorId:'old',notes:'確認中',revision:0})},{DB:fixture.db});
  expect(response.status).toBe(200);
  expect(fixture.raw.prepare('SELECT operator_id,assignee_staff_id,notes FROM chats WHERE id=?').get('chat')).toEqual({operator_id:'old',assignee_staff_id:null,notes:'確認中'});
});
test('メールの担当候補は共通の受信箱を扱える人で、特定の店だけの人は除く', async () => {
  const res=await app().request('/api/operators?channel=email',{}, {DB:fixture.db});
  expect(res.status).toBe(200);
  expect(((await res.json()) as {data:{id:string}[]}).data.map(x=>x.id)).toEqual(['staff:actor']);
});
test('旧名簿の表示名を使い、ユーザー管理の人物と混同しない', async () => {
  fixture.raw.exec(`INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES ('friend','line','友だち','shop-a');
    INSERT INTO operators(id,name,email) VALUES ('a-only','以前の担当','old@example.test');
    INSERT INTO chats(id,friend_id,operator_id,status,created_at,updated_at) VALUES ('chat','friend','a-only','unread','2026','2026');`);
  const data=await (await app().request('/api/chats/chat',{}, {DB:fixture.db})).json() as {data:{operatorId:string;operatorName:string}};
  expect(data.data).toMatchObject({operatorId:'a-only',operatorName:'以前の担当'});
});
test('空文字の担当IDは受け付けず旧記録を残す', async () => {
  fixture.raw.exec(`INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES ('friend','line','友だち','shop-a');
    INSERT INTO operators(id,name,email) VALUES ('old','旧名簿','old@example.test');
    INSERT INTO chats(id,friend_id,operator_id,status,created_at,updated_at) VALUES ('chat','friend','old','unread','2026','2026');`);
  const res=await app().request('/api/chats/chat',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({operatorId:'',revision:0})},{DB:fixture.db});
  expect(res.status).toBe(400);
  expect(fixture.raw.prepare('SELECT operator_id FROM chats WHERE id=?').get('chat')).toEqual({operator_id:'old'});
});
