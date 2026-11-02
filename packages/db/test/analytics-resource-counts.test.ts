import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { getAnalyticsUsageOverview } from '../src/analytics-overviews.js';
import { getTemplatesWithUsageCount } from '../src/templates.js';
import { getFormsWithStats } from '../src/forms/index.js';
import { getFriendFieldsForScope } from '../src/friend-fields.js';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { getTagsWithUsage } from '../src/tags/usage-references.js';
import { asD1 } from './d1-test-helper.js';

const context = {
  lineAccountId: 'account-a', timeZone: 'Asia/Tokyo', fromDate: '2026-11-01', toDate: '2026-11-01',
  from: '2026-10-31T15:00:00Z', toExclusive: '2026-11-01T15:00:00Z', dataCutoffAt: '2026-11-01T00:00:00Z',
};
let sqlite: Database.Database;
let db: D1Database;
beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
  sqlite.exec(`INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret)
    VALUES ('account-a','a','A','a','a'),('account-b','b','B','b','b');
    INSERT INTO friends (id,line_user_id,line_account_id) VALUES ('friend-a','Ua','account-a'),('friend-b','Ub','account-b');`);
  db = asD1(sqlite);
});
afterEach(() => sqlite.close());

it('テンプレートの作成数は選択中の一覧と一致し、保管と他店・所属なしを含めない', async () => {
  sqlite.exec(`INSERT INTO templates (id,name,message_type,message_content,line_account_id,deleted_at)
    VALUES ('a','現役','text','a','account-a',NULL),('draft','下書き','text','d','account-a',NULL),
    ('archived','保管','text','x','account-a','2026-10-31'),('other','別店','text','b','account-b',NULL),
    ('global','所属なし','text','g',NULL,NULL);`);
  const list = await getTemplatesWithUsageCount(db, undefined, { accountIds: ['account-a'], includeUnassigned: false });
  expect(list.total).toBe(2);
  const overview = await getAnalyticsUsageOverview(db, context);
  expect(overview.data.categories.find(item => item.key === 'templates')?.created.value).toBe(list.total);
});

it('回答のない下書きと複数店共有のフォームも一覧の作成数へ数える', async () => {
  sqlite.exec(`INSERT INTO forms (id,name,fields,is_active,status) VALUES
    ('draft','下書き','[]',0,'active'),('shared','共有','[]',1,'active'),
    ('archived','保管','[]',0,'archived'),('other','別店','[]',1,'active'),('global','所属なし','[]',1,'active');
    INSERT INTO form_accounts (form_id,line_account_id) VALUES
    ('draft','account-a'),('shared','account-a'),('shared','account-b'),('archived','account-a'),('other','account-b');`);
  const list = await getFormsWithStats(db, { lineAccountIds: ['account-a'] });
  expect(list.map(item => item.id).sort()).toEqual(['draft','shared']);
  const overview = await getAnalyticsUsageOverview(db, context);
  expect(overview.data.categories.find(item => item.key === 'forms')?.created).toMatchObject({ value: list.length, state: 'available' });
});

it('タグは選択店の現役だけを数え、友だち付与と参照の両方を未使用から外す', async () => {
  sqlite.exec(`INSERT INTO tags (id,name,line_account_id,status) VALUES
    ('assigned','付与','account-a','active'),('referenced','参照','account-a','active'),('unused','未使用','account-a','active'),
    ('archived','保管','account-a','archived'),('other','他店','account-b','active'),('global','共通',NULL,'active');
    INSERT INTO friend_tags (friend_id,tag_id) VALUES ('friend-a','assigned'),('friend-b','other');
    INSERT INTO forms (id,name,fields,on_submit_tag_id) VALUES ('ref','タグを使うフォーム','[]','referenced');
    INSERT INTO form_accounts (form_id,line_account_id) VALUES ('ref','account-a');`);
  const list = (await getTagsWithUsage(db, { allowedAccountIds: ['account-a'], canSeeUnassigned: false })).filter(item => item.status !== 'archived');
  expect(list).toHaveLength(3);
  const data = (await getAnalyticsUsageOverview(db, context)).data;
  const attributes = data.categories.find(item => item.key === 'friend_attributes')!;
  expect(attributes.breakdown?.find(item => item.key === 'tags')).toMatchObject({
    created: { value: list.length, state: 'available' }, inUse: { value: 2 },
    unused: { value: list.filter(item => item.cleanup_reasons.includes('unused')).length },
  });
});

it('友だち情報欄は値の行数でなく現役定義数を数え、保管・他店・他社の定義を混ぜない', async () => {
  sqlite.exec(`INSERT INTO tenants (id,name) VALUES ('other-tenant','他社');
    INSERT INTO friend_fields (id,name,field_key,type,status) VALUES
    ('own','自店','count_own','text','active'),('empty','未入力','count_empty','text','active'),
    ('archived','保管','count_archived','text','archived'),('other','別店','count_other','text','active'),('foreign','他社','count_foreign','text','active');
    INSERT INTO friend_field_scopes (field_id,tenant_id,line_account_id,created_at) VALUES
    ('own','${DEFAULT_TENANT_ID}','account-a','2026-11-01'),('empty','${DEFAULT_TENANT_ID}','account-a','2026-11-01'),
    ('archived','${DEFAULT_TENANT_ID}','account-a','2026-11-01'),('other','${DEFAULT_TENANT_ID}','account-b','2026-11-01'),('foreign','other-tenant',NULL,'2026-11-01');
    INSERT INTO friend_field_values (friend_id,field_id,value) VALUES ('friend-a','own','a'),('friend-b','other','b');`);
  const allDefinitions = await getFriendFieldsForScope(db, { tenantId: DEFAULT_TENANT_ID, lineAccountId: 'account-a' });
  expect(allDefinitions.some(item => item.id === 'archived')).toBe(true);
  const list = allDefinitions.filter(item => item.status !== 'archived');
  const attributes = (await getAnalyticsUsageOverview(db, context)).data.categories.find(item => item.key === 'friend_attributes')!;
  const fields = attributes.breakdown?.find(item => item.key === 'fields');
  expect(fields).toMatchObject({ created: { value: list.length, state: 'available' }, inUse: { value: 1, state: 'partial' } });
  expect(list.map(item => item.id)).toContain('empty');
  expect(list.map(item => item.id)).not.toContain('foreign');
  expect(attributes.created.value).toBe(attributes.breakdown!.reduce((sum, item) => sum + item.created.value!, 0));
});

it('オートメーションと共通アクションも保管を除き、下書きと停止中の定義を残す', async () => {
  sqlite.exec(`INSERT INTO automation_definitions (id,name,line_account_id,status) VALUES
    ('draft','下書き','account-a','draft'),('active','稼働','account-a','active'),('stopped','停止','account-a','stopped'),
    ('archived','保管','account-a','archived'),('other','他店','account-b','active');
    INSERT INTO common_actions (id,name,line_account_id,status) VALUES
    ('draft-action','下書き','account-a','draft'),('published-action','公開','account-a','published'),('archived-action','保管','account-a','archived');`);
  const row = (await getAnalyticsUsageOverview(db, context)).data.categories.find(item => item.key === 'automations');
  expect(row).toMatchObject({ created: { value: 5 }, inUse: { value: 2 }, unused: { value: 3 } });
});

it('フォームの利用中は現役定義の本番回答だけで、他店の回答とテスト回答を数えない', async () => {
  sqlite.exec(`INSERT INTO forms (id,name,fields,status) VALUES
    ('own','本番回答あり','[]','active'),('test','テストのみ','[]','active'),('shared','別店のみ','[]','active'),('archived','保管','[]','archived');
    INSERT INTO form_accounts (form_id,line_account_id) VALUES ('own','account-a'),('test','account-a'),('shared','account-a'),('shared','account-b'),('archived','account-a');
    INSERT INTO form_submissions (id,form_id,friend_id,is_test,created_at) VALUES
    ('real','own','friend-a',0,'2026-10-30'),('test-only','test','friend-a',1,'2026-11-01'),
    ('other','shared','friend-b',0,'2026-11-02'),('archived','archived','friend-a',0,'2026-11-03');`);
  const row = (await getAnalyticsUsageOverview(db, context)).data.categories.find(item => item.key === 'forms');
  expect(row).toMatchObject({ created: { value: 3 }, inUse: { value: 1 }, unused: { value: 2 }, lastUsedAt: { value: '2026-10-30' } });
});

it('別テナントの店では既定テナントの旧共通欄も見えず、その店の一覧と定義数が一致する', async () => {
  sqlite.exec(`INSERT INTO tenants (id,name) VALUES ('tenant-b','他社');
    UPDATE line_accounts SET tenant_id='tenant-b' WHERE id='account-b';
    INSERT INTO friend_fields (id,name,field_key,type) VALUES ('inherited-b','他社共通','count_b','text');
    INSERT INTO friend_field_scopes (field_id,tenant_id,line_account_id,created_at) VALUES ('inherited-b','tenant-b',NULL,'2026-11-01');`);
  const list = (await getFriendFieldsForScope(db,{tenantId:'tenant-b',lineAccountId:'account-b'})).filter(field => field.status !== 'archived');
  expect(list.map(field => field.id)).toEqual(['inherited-b']);
  const overview = await getAnalyticsUsageOverview(db,{...context,lineAccountId:'account-b'});
  expect(overview.data.categories.find(item => item.key === 'friend_attributes')?.breakdown?.find(item => item.key === 'fields')?.created.value).toBe(1);
});

it('最終利用日は選択店の現役タグと所属する現役情報欄だけから求める', async () => {
  sqlite.exec(`INSERT INTO tenants (id,name) VALUES ('tenant-other','他社');
    INSERT INTO tags (id,name,line_account_id,status) VALUES
      ('tag-a','自店','account-a','active'),('tag-old','保管','account-a','archived'),('tag-b','別店','account-b','active');
    INSERT INTO friend_tags (friend_id,tag_id,assigned_at) VALUES
      ('friend-a','tag-a','2026-10-01'),('friend-a','tag-old','2026-12-01'),('friend-a','tag-b','2026-12-02');
    INSERT INTO friend_fields (id,name,field_key,type,status) VALUES
      ('field-a','自店','use_a','text','active'),('field-old','保管','use_old','text','archived'),('field-b','他社','use_b','text','active');
    INSERT INTO friend_field_scopes (field_id,tenant_id,line_account_id,created_at) VALUES
      ('field-a','${DEFAULT_TENANT_ID}','account-a','2026-01-01'),('field-old','${DEFAULT_TENANT_ID}','account-a','2026-01-01'),('field-b','tenant-other',NULL,'2026-01-01');
    INSERT INTO friend_field_values (friend_id,field_id,value,updated_at) VALUES
      ('friend-a','field-a','x','2026-10-02'),('friend-a','field-old','x','2026-12-03'),('friend-a','field-b','x','2026-12-04'),('friend-b','field-a','x','2026-12-05');`);
  const row = (await getAnalyticsUsageOverview(db, context)).data.categories.find(item => item.key === 'friend_attributes')!;
  expect(row.lastUsedAt.value).toBe('2026-10-02');
  expect(row.breakdown?.find(item => item.key === 'fields')?.inUse.value).toBe(1);
});
