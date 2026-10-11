import { afterEach, beforeEach, expect, test } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID, emptyLayout, type FormLayout } from '@line-crm/shared';
import { setFriendFieldValue, saveVersionedAccountSetting } from '@line-crm/db';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { authMiddleware } from '../middleware/auth.js';
import { forms } from './forms.js';
import { friendFields } from './friend-fields.js';
import type { Env } from '../index.js';

let fixture: SqliteD1;
let app: Hono<Env>;
function request(path: string, method = 'GET', body?: unknown, key = 'owner-key') {
  return app.request(path, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { DB: fixture.db } as Env['Bindings']);
}
beforeEach(() => {
  fixture = createTestD1({ foreignKeys: true });
  fixture.raw.prepare("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES ('a','ch','本店','token','secret',?)").run(DEFAULT_TENANT_ID);
  fixture.raw.prepare("INSERT INTO staff_members(id,name,role,api_key,tenant_id,account_scope) VALUES ('owner','店長','owner','owner-key',?,'all'),('viewer','閲覧','staff','viewer-key',?,'all')").run(DEFAULT_TENANT_ID, DEFAULT_TENANT_ID);
  fixture.raw.exec(`UPDATE staff_members SET view_permission_keys='["/friends","/tags"]' WHERE id='viewer'`);
  insertFriend(fixture.raw, 'f', { line_account_id: 'a' });
  fixture.raw.exec("INSERT INTO forms(id,name,fields) VALUES ('form','登録フォーム','[]'); INSERT INTO form_accounts(form_id,line_account_id) VALUES ('form','a')");
  app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', forms);
  app.route('/', friendFields);
});
afterEach(() => fixture.raw.close());

test('友だち詳細に他店の欄を混ぜず、直接IDで送ってもまとめて保存しない',async()=>{
  fixture.raw.prepare("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('b','b','他店','t','s',?)").run(DEFAULT_TENANT_ID);
  fixture.raw.prepare("INSERT INTO friend_fields(id,name,field_key,type) VALUES('other','他店の欄','other','text')").run();
  fixture.raw.prepare("INSERT INTO friend_field_scopes(field_id,tenant_id,line_account_id,created_at) VALUES('other',?,'b','now')").run(DEFAULT_TENANT_ID);
  expect(JSON.stringify(await (await request('/api/friends/f/fields')).json())).not.toContain('他店の欄');
  expect((await request('/api/friends/f/fields','PUT',{values:{'other':'漏らさない','fixed-name':'保存しない'}})).status).toBe(403);
  expect(fixture.raw.prepare("SELECT real_name FROM friends WHERE id='f'").get()).toEqual({real_name:null});
});

test('公開版では配布先のアレルギー選択肢を返し、下書きと旧いfieldsを壊さない',async()=>{
  const layout=emptyLayout(); layout.sections[0].blocks=[{id:'a',kind:'input',type:'checkbox',name:'allergy',label:'アレルギー',fixedField:'allergy',choices:[{id:'old',label:'古い選択肢'},{id:'other',label:'そのほか',isOther:true}]}];
  await saveVersionedAccountSetting(fixture.db,{accountId:'a',key:'friend.allergy_options_v1',data:['キウイ'],expectedVersion:0});
  expect((await request('/api/forms/form?account_id=a','PUT',{expectedContentRevision:1,layout})).status).toBe(200);
  expect((await request('/api/forms/form/publish?account_id=a','POST',{expectedContentRevision:2})).status).toBe(200);
  const publicRead=await request('/api/forms/form');
  expect(await publicRead.json()).toMatchObject({data:{fields:[{options:['キウイ','そのほか（自由に書く）']}],layout:{sections:[{blocks:[{choices:[{label:'キウイ'},{isOther:true}]}]}]}}});
  expect(await (await request('/api/forms/form?account_id=a')).json()).toMatchObject({data:{layout:{sections:[{blocks:[{choices:[{label:'古い選択肢'},{label:'そのほか'}]}]}]}}});
});

test('複数アレルギーを手で保存・読める。型違いは部分保存せず閲覧のみは403', async () => {
  expect((await request('/api/friends/f/fields','PUT',{values:{'fixed-allergy':['卵','乳','キウイ']}})).status).toBe(200);
  const read=await request('/api/friends/f/fields');
  expect(await read.json()).toMatchObject({data:{items:expect.arrayContaining([expect.objectContaining({fixedKey:'allergy',type:'multi_select',value:'["卵","乳","キウイ"]'})])}});
  expect((await request('/api/friends/f/fields','PUT',{values:{'fixed-allergy':['卵',42],'fixed-name':'変えない'}})).status).toBe(422);
  expect(fixture.raw.prepare("SELECT real_name FROM friends WHERE id='f'").get()).toEqual({real_name:null});
  expect((await request('/api/friends/f/fields','PUT',{values:{'fixed-allergy':[]}},'viewer-key')).status).toBe(403);
});

test.each([
  { id: 'x', kind: 'iframe' },
  { id: 'x', kind: 'input', type: 'unsupported', name: 'q', label: '質問' },
  { id: 'x', kind: 'input', type: 'radio', name: 'q', label: '名前', fixedField: 'name' },
])('未知のブロックを作成・更新とも保存せず元の版を保つ: %j', async block => {
  const layout = emptyLayout();
  layout.sections[0].blocks = [block as never];
  const before = fixture.raw.prepare("SELECT * FROM forms WHERE id='form'").get();
  expect((await request('/api/forms', 'POST', { name: '拒否', accountId: 'a', layout })).status).toBe(400);
  expect((await request('/api/forms/form?account_id=a', 'PUT', { expectedContentRevision: 1, layout })).status).toBe(400);
  expect(fixture.raw.prepare("SELECT * FROM forms WHERE id='form'").get()).toEqual(before);
  expect(fixture.raw.prepare('SELECT COUNT(*) n FROM forms').get()).toEqual({ n: 1 });
});

test('旧いfieldsだけを使う保存口でも未知の種類を拒否する', async () => {
  const fields = [{ name: 'q', label: '質問', type: 'unsupported' }];
  expect((await request('/api/forms', 'POST', { name: '拒否', accountId: 'a', fields })).status).toBe(400);
  expect((await request('/api/forms/form?account_id=a', 'PUT', { expectedContentRevision: 1, fields })).status).toBe(400);
});

test('固定項目と画像の設定は保存・再取得で失われない', async () => {
  const layout = emptyLayout();
  layout.sections[0].blocks = [
    { id: 'q', kind: 'input', type: 'date', name: 'birth', label: '生年月日', fixedField: 'birthday' },
    { id: 'img', kind: 'image', mediaUrl: 'https://example.test/photo.png', size: 'full', alt: '案内の写真', linkUrl: 'https://example.test/guide' },
  ];
  const saved = await request('/api/forms/form?account_id=a', 'PUT', { expectedContentRevision: 1, layout });
  expect(saved.status).toBe(200);
  const read = await request('/api/forms/form?account_id=a');
  expect(read.status).toBe(200);
  expect((await read.json() as { data: { layout: FormLayout } }).data.layout.sections[0].blocks).toEqual(layout.sections[0].blocks);
});

test('基本7欄と回答の出どころ・日時を返し、個人情報の閲覧権限を守る', async () => {
  await setFriendFieldValue(fixture.db, { friendId: 'f', fieldId: 'fixed-email', value: 'a@example.test', updatedBy: 'form', sourceType: 'form', sourceId: 'form' });
  const read = await request('/api/friends/f/fields');
  expect(read.status).toBe(200);
  const data = (await read.json() as { data: { items: Record<string, unknown>[] } }).data;
  expect(data.items.filter(field => field.fixedKey)).toHaveLength(10);
  expect(data.items.find(field => field.fixedKey === 'email')).toMatchObject({ value: 'a@example.test', valueUpdatedAt: expect.any(String), valueSource: { type: 'form', id: 'form', name: '登録フォーム' } });
  const hidden = await request('/api/friends/f/fields', 'GET', undefined, 'viewer-key');
  expect(hidden.status).toBe(200);
  expect(await hidden.json()).toMatchObject({ data: { items: [], hiddenPersonalCount: 10 } });
  expect((await request('/api/friends/f/fields', 'PUT', { values: { 'fixed-email': 'b@example.test' } }, 'viewer-key')).status).toBe(403);
});

test('手動保存は回答の出どころを消し、名前を本名と同じ値へ更新する。不正値は部分保存しない', async () => {
  await setFriendFieldValue(fixture.db, { friendId: 'f', fieldId: 'fixed-name', value: '回答の名前', updatedBy: 'form', sourceType: 'form', sourceId: 'form' });
  expect((await request('/api/friends/f/fields', 'PUT', { values: { 'fixed-name': '手動の名前', 'fixed-age': '151' } })).status).toBe(422);
  expect(fixture.raw.prepare("SELECT real_name FROM friends WHERE id='f'").get()).toEqual({ real_name: '回答の名前' });
  expect((await request('/api/friends/f/fields', 'PUT', { values: { 'fixed-name': '手動の名前', 'fixed-age': '18' } })).status).toBe(200);
  expect(fixture.raw.prepare("SELECT real_name FROM friends WHERE id='f'").get()).toEqual({ real_name: '手動の名前' });
  expect(fixture.raw.prepare("SELECT source_type,source_id FROM friend_field_values WHERE friend_id='f' AND field_id='fixed-name'").get()).toEqual({ source_type: null, source_id: null });
});
