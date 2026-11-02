import { seedRestaurantFixture as seedRestaurantData } from '../test-utils/restaurant-fixture.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

type MockStaff = {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'staff';
  access_level: 'full' | 'read_only';
  permission_keys: string;
  assigned_line_account_id: string | null;
  can_access_descendant_accounts: number;
  tenant_id?: string | null;
};

const authMocks = vi.hoisted(() => ({
  getPlatformSetting: async () => 'false', // Explicit Off fixture for route authorization.
  getStaffByApiKey: vi.fn(async (): Promise<MockStaff | null> => null),
  getStaffByAdminSession: vi.fn(async (): Promise<MockStaff | null> => null),
  lineAccounts: [] as Array<Record<string, unknown>>,
}));

vi.mock('@line-crm/db', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/db')>('@line-crm/db');
  return {
    ...actual,
    getStaffByApiKey: authMocks.getStaffByApiKey,
    getStaffByAdminSession: authMocks.getStaffByAdminSession,
    getLineAccounts: vi.fn(async () => authMocks.lineAccounts),
    getLineAccountScopeEntries: vi.fn(async () => authMocks.lineAccounts),
  };
});

const { authMiddleware, sha256Hex } = await import('../middleware/auth.js');
const { restaurantTest } = await import('./restaurant-test.js');
type Env = import('../index.js').Env;

const here = dirname(fileURLToPath(import.meta.url));
let testDb: SqliteD1;
let env: Env['Bindings'];

const seedRestaurantFixture = (options?: Parameters<typeof seedRestaurantData>[1]) => seedRestaurantData(testDb, options);

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', restaurantTest);
  return instance;
}

function request(path: string, body?: unknown) {
  return requestAs(path, 'owner-key', body);
}

function requestAs(path: string, token: string, body?: unknown) {
  return app().request(path, body === undefined ? {
    headers: { Authorization: `Bearer ${token}` },
  } : {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env);
}

function requestWithMethod(path: string, method: string, body?: unknown, token = 'owner-key') {
  if((method==='PUT'&&path.includes('/tables/layout')||method==='PATCH'&&path.includes('/tables/'))&&body&&typeof body==='object'&&!('expectedVersion' in body)){const table=path.match(/\/tables\/([^/?]+)/)?.[1];const floor=table?testDb.raw.prepare('SELECT f.version FROM rt_floors f JOIN rt_tables t ON t.floor_id=f.id WHERE t.id=?').get(table):testDb.raw.prepare("SELECT version FROM rt_floors WHERE store_id=?").get((body as {storeId:string}).storeId);body={...body,expectedVersion:(floor as {version:number}|undefined)?.version??1}}

  const id=path.match(/^\/api\/restaurant-test\/reservations\/([^/?]+)(?:\?|$)/)?.[1];
  if(method==='PATCH'&&id&&body&&typeof body==='object'&&!('expectedVersion' in body))body={...body,expectedVersion:((testDb.raw.prepare('SELECT customer_version FROM rt_reservations WHERE id=?').get(id)) as {customer_version:number}|undefined)?.customer_version??1};

  return app().request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env);
}

beforeEach(() => {
  authMocks.getStaffByApiKey.mockReset();
  authMocks.getStaffByApiKey.mockResolvedValue(null);
  authMocks.getStaffByAdminSession.mockReset();
  authMocks.getStaffByAdminSession.mockResolvedValue(null);
  authMocks.lineAccounts = [
    { id: 'account-1', name: '統括', is_active: 1, channel_access_token: 'token-1' },
    { id: 'account-2', name: '店舗A', is_active: 1, channel_access_token: 'token-2' },
    { id: 'account-3', name: '店舗B', is_active: 1, channel_access_token: 'token-3' },
    { id: 'account-4', name: '予備', is_active: 1, channel_access_token: 'token-4' },
  ];
  testDb = createTestD1({ loginPolicy: 'off', foreignKeys: true });
  for (const id of ['account-1','account-2','account-3','account-4']) testDb.raw.prepare("INSERT OR IGNORE INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES(?,?,?,?,?,?)").run(id,id,id,'','','00000000-0000-4000-8000-000000000001');
  testDb.raw.exec(readFileSync(join(here, '../../../../packages/db/migrations/168_restaurant_test_foundation.sql'), 'utf8'));
  testDb.raw.exec(readFileSync(join(here, '../../../../packages/db/migrations/175_restaurant_terms_agreement.sql'), 'utf8'));
  testDb.raw.prepare(`UPDATE tenants SET feature_packs = '["restaurant"]' WHERE id = '00000000-0000-4000-8000-000000000001'`).run();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    endpoint: 'https://worker.example.test/webhook',
    active: true,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  env = {
    DB: testDb.db,
    API_KEY: 'owner-key',
    IMAGES: {} as R2Bucket,
    RAW_MAIL: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    RESTAURANT_INTAKE_DOMAIN: 'intake.example.test',
    DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: 'true',
    LINE_CHANNEL_SECRET: 'unused', LINE_CHANNEL_ACCESS_TOKEN: 'unused',
    LIFF_URL: 'https://example.test', LINE_CHANNEL_ID: 'unused',
    LINE_LOGIN_CHANNEL_ID: 'unused', LINE_LOGIN_CHANNEL_SECRET: 'unused',
    WORKER_URL: 'https://worker.example.test',
    LINE_CREDENTIAL_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  };
});

describe('参照のない卓とメニューの削除', () => {
  it('予約で参照される卓とメニューは取り消し済みでも削除を拒否する', async () => {
    seedRestaurantFixture();
    testDb.raw.prepare("UPDATE rt_reservations SET status='cancelled' WHERE id='reservation-ginza'").run();
    for (const [kind, id] of [['tables', 'table-ginza'], ['menus', 'menu-ginza']]) {
      const response = await requestWithMethod(`/api/restaurant-test/${kind}/${id}?account_id=account-1`, 'DELETE');
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'resource_in_use' });
    }
  });

  it('参照のない停止中の卓と公開済みメニューは削除できる', async () => {
    seedRestaurantFixture();
    testDb.raw.prepare("INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity,is_active) VALUES('unused-table','store-ginza','U','未使用','table',1,2,0)").run();
    testDb.raw.prepare("INSERT INTO rt_menu_items(id,store_id,kind,name,price,status,published_once) VALUES('unused-menu','store-ginza','course','未使用',1000,'active',1)").run();
    for (const [kind, id] of [['tables', 'unused-table'], ['menus', 'unused-menu']]) {
      const response = await requestWithMethod(`/api/restaurant-test/${kind}/${id}?account_id=account-1`, 'DELETE');
      expect(response.status).toBe(200);
    }
    expect(testDb.raw.prepare("SELECT id FROM rt_tables WHERE id='unused-table'").get()).toBeUndefined();
    expect(testDb.raw.prepare("SELECT id FROM rt_menu_items WHERE id='unused-menu'").get()).toBeUndefined();
  });

  it('予約ではない回答に同名のキーがあっても削除できる', async () => {
    seedRestaurantFixture();
    testDb.raw.exec(`INSERT INTO rt_menu_items(id,store_id,kind,name,price) VALUES('unrelated-menu','store-ginza','course','対象',1000);
      INSERT INTO forms(id,name) VALUES('other-form','回答');
      INSERT INTO form_submissions(id,form_id,data) VALUES('other-answer','other-form','{"x":{"courseId":"unrelated-menu"}}');`);
    expect((await requestWithMethod('/api/restaurant-test/menus/unrelated-menu?account_id=account-1','DELETE')).status).toBe(200);
  });

  it('回答処理中のメニューは削除できず、処理が終われば削除できる', async () => {
    seedRestaurantFixture();
    testDb.raw.exec("INSERT INTO rt_menu_items(id,store_id,kind,name,price) VALUES('claimed-menu','store-ginza','course','処理中',1000); INSERT INTO rt_resource_locks(resource_key,owner_token,expires_at) VALUES('form-course:claimed-menu:test','test','2099-01-01T00:00:00Z')");
    expect((await requestWithMethod('/api/restaurant-test/menus/claimed-menu?account_id=account-1','DELETE')).status).toBe(409);
    testDb.raw.prepare("DELETE FROM rt_resource_locks WHERE resource_key='form-course:claimed-menu:test'").run();
    expect((await requestWithMethod('/api/restaurant-test/menus/claimed-menu?account_id=account-1','DELETE')).status).toBe(200);
  });

  it('予約のスナップショットが残っているメニューは削除しない', async () => {
    seedRestaurantFixture();
    testDb.raw.prepare("UPDATE rt_reservations SET course_id=NULL WHERE id='reservation-ginza'").run();
    const response = await requestWithMethod('/api/restaurant-test/menus/menu-ginza?account_id=account-1', 'DELETE');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'resource_in_use' });
  });

  it('結合卓の予約リンクとキャンセル待ちリンクを守る', async () => {
    seedRestaurantFixture();
    testDb.raw.prepare("INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity) VALUES('linked-table','store-ginza','L','結合卓','table',1,4)").run();
    testDb.raw.prepare("INSERT INTO rt_reservation_table_links(reservation_id,table_id) VALUES('reservation-ginza','linked-table')").run();
    const response = await requestWithMethod('/api/restaurant-test/tables/linked-table?account_id=account-1', 'DELETE');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'resource_in_use' });
  });

  it('休業の卓の指定を守る', async () => {
    seedRestaurantFixture();
    testDb.raw.prepare("INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity) VALUES('closed-table','store-ginza','C','休業卓','table',1,4)").run();
    testDb.raw.prepare("INSERT INTO rt_closures(id,store_id,start_date,end_date,all_day,kind,table_ids_json,periods_json) VALUES('closure','store-ginza','2099-01-01','2099-01-01',1,'other',?,?)").run('["closed-table"]','[{"startsAt":"2099-01-01T00:00:00Z","endsAt":"2099-01-02T00:00:00Z"}]');
    const response = await requestWithMethod('/api/restaurant-test/tables/closed-table?account_id=account-1', 'DELETE');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'resource_in_use' });
  });


  it('キャンセル待ちの卓と結合卓の参照を守る', async () => {
    seedRestaurantFixture();
    testDb.raw.exec(`INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity) VALUES('waiting-table','store-ginza','W','待機卓','table',1,4),('waiting-link','store-ginza','WL','結合卓','table',1,4);
      INSERT INTO rt_seat_waitlist(id,store_id,starts_at,guest_count,customer_name,identity_key,status,table_id) VALUES('wait','store-ginza','2099-01-01T00:00:00Z',2,'テスト','test','cancelled','waiting-table');
      INSERT INTO rt_seat_waitlist_table_links(waitlist_id,table_id) VALUES('wait','waiting-link');`);
    for (const id of ['waiting-table','waiting-link']) {
      const response = await requestWithMethod(`/api/restaurant-test/tables/${id}?account_id=account-1`, 'DELETE');
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({code:'resource_in_use'});
    }
  });

  it('価格変更と支払い設定の参照を守る', async () => {
    seedRestaurantFixture();
    testDb.raw.exec(`INSERT INTO rt_menu_items(id,store_id,kind,name,price) VALUES('pay-menu','store-ginza','course','決済',1000),('approval-menu','store-ginza','course','申請',1000),('change-menu','store-ginza','course','価格',1000);
      INSERT INTO restaurant_course_payment_settings(menu_id,line_account_id,store_id,updated_by,updated_at) VALUES('pay-menu','account-2','store-ginza','test',datetime('now'));
      INSERT INTO rt_approval_requests(id,organization_id,store_id,kind,title,payload_json) VALUES('approval','org-fixture','store-ginza','menu_change','申請','{"menuId":"approval-menu"}'),('change','org-fixture','store-ginza','menu_change','価格','{}');
      INSERT INTO rt_menu_change_requests(id,approval_id,menu_id,store_id,before_price,after_price,requested_by) VALUES('change','change','change-menu','store-ginza',1000,1100,'test');`);
    for (const id of ['pay-menu','approval-menu','change-menu']) {
      const response = await requestWithMethod(`/api/restaurant-test/menus/${id}?account_id=account-1`, 'DELETE');
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({code:'resource_in_use'});
    }
  });

  it('店舗更新中は予約と削除が同時に進まない', async () => {
    seedRestaurantFixture();
    testDb.raw.exec("INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity) VALUES('locked-table','store-ginza','L','卓','table',1,4)");
    const { acquireLock, releaseLock } = await import('./restaurant-test-definition.js');
    expect(await acquireLock(testDb.db,'reservation:store-ginza','other')).toBe(true);
    const response = await requestWithMethod('/api/restaurant-test/tables/locked-table?account_id=account-1','DELETE');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:'resource_busy'});
    expect(testDb.raw.prepare("SELECT id FROM rt_tables WHERE id='locked-table'").get()).toBeTruthy();
    await releaseLock(testDb.db,'reservation:store-ginza','other');
  });


  it('外部キーの参照先一覧が変われば判定の見直しを促す', () => {
    const tables = testDb.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[];
    const refs = tables.flatMap(({name}) => (testDb.raw.prepare(`PRAGMA foreign_key_list("${name.replaceAll('"','""')}")`).all() as {table:string;from:string}[])
      .filter(f => f.table === 'rt_tables' || f.table === 'rt_menu_items').map(f => `${name}.${f.from}->${f.table}`)).sort();
    expect(refs).toEqual([
      'restaurant_course_payment_settings.menu_id->rt_menu_items', 'rt_menu_change_requests.menu_id->rt_menu_items',
      'rt_reservation_table_links.table_id->rt_tables', 'rt_reservations.course_id->rt_menu_items',
      'rt_reservations.table_id->rt_tables', 'rt_seat_waitlist.table_id->rt_tables',
      'rt_seat_waitlist_table_links.table_id->rt_tables',
    ]);
  });

  it('閲覧専用と担当者には削除を許可しない', async () => {
    seedRestaurantFixture();
    for (const [role, access] of [['staff','full'],['admin','read_only']] as const) {
      authMocks.getStaffByApiKey.mockResolvedValue({id:'viewer',name:'閲覧',role,access_level:access,permission_keys:'[]',assigned_line_account_id:null,can_access_descendant_accounts:1});
      for (const [kind,id] of [['tables','table-ginza'],['menus','menu-ginza']]) {
        expect((await requestWithMethod(`/api/restaurant-test/${kind}/${id}?account_id=account-1`,'DELETE',undefined,'viewer-key')).status).toBe(403);
      }
    }
  });

  it('店舗を限定した管理者は他店舗の対象を削除できない', async () => {
    seedRestaurantFixture();
    authMocks.getStaffByAdminSession.mockResolvedValue({id:'owner-session',name:'Owner',role:'owner',access_level:'full',permission_keys:'[]',assigned_line_account_id:null,can_access_descendant_accounts:1});
    testDb.raw.exec("INSERT INTO staff_members(id,name,role,api_key) VALUES('owner-session','Owner','owner','owner-session-key')");
    testDb.raw.prepare('INSERT INTO admin_sessions (token_hash,staff_id,expires_at) VALUES (?,?,?)').run(await sha256Hex('scope-token'),'owner-session','2099-01-01T00:00:00Z');
    const token='lh_session:scope-token';
    expect((await requestAs('/api/restaurant-test/stores/store-yokohama/select?account_id=account-1',token,{})).status).toBe(200);
    for (const [kind,id] of [['tables','table-ginza'],['menus','menu-ginza']]) {
      expect((await requestWithMethod(`/api/restaurant-test/${kind}/${id}?account_id=account-1`,'DELETE',undefined,token)).status).toBe(404);
    }
  });


  it('予約フォームの設定と保存済み回答の参照を守る', async () => {
    seedRestaurantFixture();
    testDb.raw.exec(`INSERT INTO rt_menu_items(id,store_id,kind,name,price) VALUES('form-menu','store-ginza','course','フォーム',1000),('answer-menu','store-ginza','course','回答',1000);
      INSERT INTO forms(id,name,layout) VALUES('form','予約','{"booking":{"kind":"seats","courseId":"form-menu"}}');
      INSERT INTO form_submissions(id,form_id,data) VALUES('answer','form','{"booking":{"kind":"seats","storeId":"store-ginza","courseId":"answer-menu"}}');`);
    for (const id of ['form-menu','answer-menu']) {
      const response = await requestWithMethod(`/api/restaurant-test/menus/${id}?account_id=account-1`, 'DELETE');
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({code:'resource_in_use'});
    }
  });


  it('予約の追加と削除が競合しても予約が消えた卓を指さない', async () => {
    seedRestaurantFixture();
    testDb.raw.exec("INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity) VALUES('race-table','store-ginza','R','競合卓','table',1,4)");
    const [deleted, booked] = await Promise.all([
      requestWithMethod('/api/restaurant-test/tables/race-table?account_id=account-1','DELETE'),
      request('/api/restaurant-test/reservations/manual?account_id=account-1',{storeId:'store-ginza',customerName:'検証',guestCount:2,startsAt:'2099-01-01T10:00:00Z',endsAt:'2099-01-01T12:00:00Z',tableId:'race-table'}),
    ]);
    expect(deleted.status === 200 || booked.status === 201).toBe(true);
    const broken = testDb.raw.prepare("SELECT COUNT(*) AS n FROM rt_reservations r LEFT JOIN rt_tables t ON t.id=r.table_id WHERE r.table_id='race-table' AND t.id IS NULL").get();
    expect(broken).toEqual({n:0});
    if (booked.status === 201) expect(deleted.status).toBe(409);
  });


  it('メニューの削除と予約が競合しても予約が消えたメニューを指さない', async () => {
    seedRestaurantFixture();
    testDb.raw.exec("INSERT INTO rt_menu_items(id,store_id,kind,name,price,status) VALUES('race-menu','store-ginza','course','競合',1000,'active')");
    const [deleted, booked] = await Promise.all([
      requestWithMethod('/api/restaurant-test/menus/race-menu?account_id=account-1','DELETE'),
      request('/api/restaurant-test/reservations/manual?account_id=account-1',{storeId:'store-ginza',customerName:'検証',guestCount:2,startsAt:'2099-01-01T10:00:00Z',endsAt:'2099-01-01T12:00:00Z',courseId:'race-menu'}),
    ]);
    expect(deleted.status === 200 || booked.status === 201).toBe(true);
    expect(testDb.raw.prepare("SELECT COUNT(*) AS n FROM rt_reservations r LEFT JOIN rt_menu_items m ON m.id=r.course_id WHERE r.course_id='race-menu' AND m.id IS NULL").get()).toEqual({n:0});
    if (booked.status === 201) expect(deleted.status).toBe(409);
  });


  it('公開済みフォームの版に残るメニューを守る', async () => {
    seedRestaurantFixture();
    testDb.raw.exec(`INSERT INTO rt_menu_items(id,store_id,kind,name,price) VALUES('version-menu','store-ginza','course','版',1000);
      INSERT INTO forms(id,name,is_active) VALUES('form-versioned','版のあるフォーム',0);
      INSERT INTO form_versions(id,form_id,version_number,source_content_revision,name,layout,save_to_metadata,published_at,created_at)
      VALUES('fv','form-versioned',1,1,'版','{"booking":{"kind":"seats","courseId":"version-menu"}}',0,datetime('now'),datetime('now'));`);
    const response = await requestWithMethod('/api/restaurant-test/menus/version-menu?account_id=account-1', 'DELETE');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:'resource_in_use'});
  });

  it('休業の通知記録に残る卓を守る', async () => {
    seedRestaurantFixture();
    testDb.raw.exec(`INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity) VALUES('task-table','store-ginza','C','通知卓','table',1,4);
      INSERT INTO rt_closures(id,store_id,start_date,end_date,all_day,kind,table_ids_json,periods_json,archived_at) VALUES('old-closure','store-ginza','2099-01-01','2099-01-01',1,'other','[]','[{"startsAt":"2099-01-01T00:00:00Z","endsAt":"2099-01-02T00:00:00Z"}]',datetime('now'));
      INSERT INTO rt_closure_close_tasks(id,store_id,closure_id,closure_version,channel,kind,start_date,end_date,all_day,table_ids_json,starts_at,ends_at,status) VALUES('task','store-ginza','old-closure',1,'test','other','2099-01-01','2099-01-01',1,'["task-table"]','2099-01-01T00:00:00Z','2099-01-02T00:00:00Z','done');`);
    const response = await requestWithMethod('/api/restaurant-test/tables/task-table?account_id=account-1', 'DELETE');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:'resource_in_use'});
  });


  it('ひな型や初期設定の写しにあるメニューを守る', async () => {
    seedRestaurantFixture();
    const cases = [
      { id: 'template-menu', sql: "INSERT INTO hq_template_versions(id,tenant_id,template_id,version,definition_json,content_hash) VALUES('ver','00000000-0000-4000-8000-000000000001','tmpl',1,?,'hash')" },
      { id: 'catalog-menu', sql: "INSERT INTO style_starter_catalog_resources(tenant_id,line_account_id,resource_kind,target_id,source_snapshot,updated_at) VALUES('00000000-0000-4000-8000-000000000001','account-2','form','f',?,datetime('now'))" },
      { id: 'starter-menu', sql: "INSERT INTO style_starter_items(line_account_id,style,item_key,kind,target_id,set_version,applied_at,source_snapshot) VALUES('account-2','restaurant','f','form','f',1,datetime('now'),?)" },
      { id: 'pending-menu', sql: "INSERT INTO style_starter_items(line_account_id,style,item_key,kind,target_id,set_version,applied_at,pending_update) VALUES('account-2','restaurant','p','form','p',1,datetime('now'),?)" },
      { id: 'set-menu', sql: "INSERT INTO style_starter_sets(id,style,name,definition_json,updated_at) VALUES('set','restaurant','設定',?,datetime('now'))" },
    ];
    testDb.raw.exec("INSERT INTO hq_templates(id,tenant_id,template_type,name) VALUES('tmpl','00000000-0000-4000-8000-000000000001','form','フォーム')");
    for (const {id,sql} of cases) {
      testDb.raw.prepare("INSERT INTO rt_menu_items(id,store_id,kind,name,price) VALUES(?,'store-ginza','course','検証',1000)").run(id);
      testDb.raw.prepare(sql).run(JSON.stringify({booking:{kind:'seats',courseId:id}}));
      const response = await requestWithMethod(`/api/restaurant-test/menus/${id}?account_id=account-1`, 'DELETE');
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({code:'resource_in_use'});
    }
  });


  it('割り当て設定にある卓を守り、連携の原文は参照に数えない', async () => {
    seedRestaurantFixture();
    testDb.raw.exec(`INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity) VALUES('assigned-table','store-ginza','A','設定卓','table',1,4),('synced-table','store-ginza','S','連携卓','table',1,4);
      INSERT INTO rt_menu_items(id,store_id,kind,name,price) VALUES('synced-menu','store-ginza','course','連携',1000);
      INSERT INTO booking_assignment_settings(scope_kind,scope_id,method,balance_period,resources_json,version) VALUES('table','store-ginza','balanced','day','[{"resourceId":"assigned-table","priority":"normal","dailyLimit":null,"sortOrder":0}]',1);
      INSERT INTO rt_sync_events(id,store_id,provider,external_event_id,payload_json,status) VALUES('sync','store-ginza','hotpepper','event','{"tableId":"synced-table","courseId":"synced-menu"}','processed');`);
    for (const [kind,id] of [['tables','assigned-table']]) {
      const response = await requestWithMethod(`/api/restaurant-test/${kind}/${id}?account_id=account-1`, 'DELETE');
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({code:'resource_in_use'});
    }
    for (const [kind,id] of [['tables','synced-table'],['menus','synced-menu']]) {
      expect((await requestWithMethod(`/api/restaurant-test/${kind}/${id}?account_id=account-1`, 'DELETE')).status).toBe(200);
    }
  });

  it('削除済みの卓を使った古い割り当て設定は保存できない', async () => {
    seedRestaurantFixture();
    const {d1AssignmentSettingsStore} = await import('../features/booking/booking-assignment-settings.js');
    const saved = await d1AssignmentSettingsStore(testDb.db).save({kind:'table',id:'store-ginza'}, {method:'balanced',balancePeriod:'day',expectedVersion:0,resources:[{resourceId:'gone',priority:'normal',dailyLimit:null,sortOrder:0}]});
    expect(saved).toBe('conflict');
  });


  it('削除時に座席図の版も更新する', async () => {
    seedRestaurantFixture();
    testDb.raw.exec("INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity) VALUES('floor-table','store-ginza','F','卓','table',1,4)");
    const before=testDb.raw.prepare("SELECT version FROM rt_floors WHERE id='floor-store-ginza'").get() as {version:number};
    expect((await requestWithMethod('/api/restaurant-test/tables/floor-table?account_id=account-1','DELETE')).status).toBe(200);
    expect(testDb.raw.prepare("SELECT version FROM rt_floors WHERE id='floor-store-ginza'").get()).toEqual({version:before.version+1});
  });

  it('休業の保存前に卓が消えた場合は保存しない', async () => {
    seedRestaurantFixture();
    testDb.raw.exec("INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity) VALUES('closure-race','store-ginza','CR','卓','table',1,4)");
    const prepare=testDb.db.prepare.bind(testDb.db);
    const spy=vi.spyOn(testDb.db,'prepare').mockImplementation((sql)=>{
      if(sql.includes('SELECT owner_token FROM rt_resource_locks')) testDb.raw.prepare("DELETE FROM rt_tables WHERE id='closure-race'").run();
      return prepare(sql);
    });
    try {
      const response=await request('/api/restaurant-test/closures?account_id=account-1',{storeId:'store-ginza',startDate:'2099-01-01',endDate:'2099-01-01',allDay:true,kind:'other',tableIds:['closure-race'],notifyMedia:false});
      expect(response.status).toBe(400);
      expect(testDb.raw.prepare("SELECT COUNT(*) n FROM rt_closures WHERE table_ids_json LIKE '%closure-race%'").get()).toEqual({n:0});
    } finally {spy.mockRestore();}
  });

  it('フォーム欄と公開版の欄に残るメニューを守る', async () => {
    seedRestaurantFixture();
    testDb.raw.exec(`INSERT INTO rt_menu_items(id,store_id,kind,name,price) VALUES('field-menu','store-ginza','course','欄',1000),('version-field-menu','store-ginza','course','版の欄',1000);
      INSERT INTO forms(id,name,fields,is_active) VALUES('fields-form','欄','[{"booking":{"kind":"seats","storeId":"store-ginza","courseId":"field-menu"}}]',0);
      INSERT INTO form_versions(id,form_id,version_number,source_content_revision,name,fields,save_to_metadata,published_at,created_at) VALUES('field-version','fields-form',1,1,'版','[{"booking":{"kind":"seats","storeId":"store-ginza","courseId":"version-field-menu"}}]',0,datetime('now'),datetime('now'));`);
    for(const id of ['field-menu','version-field-menu']) {
      const response=await requestWithMethod(`/api/restaurant-test/menus/${id}?account_id=account-1`,'DELETE');
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({code:'resource_in_use'});
    }
  });


  it('フォームのJSONでエスケープされたIDも参照として扱う', async () => {
    seedRestaurantFixture();
    testDb.raw.exec("INSERT INTO rt_menu_items(id,store_id,kind,name,price) VALUES('escaped-menu','store-ginza','course','検証',1000)");
    const layout='{"booking":{"kind":"seats","storeId":"store-ginza","courseId":"escaped-\\u006denu"}}';
    testDb.raw.prepare('INSERT INTO forms(id,name,layout,is_active) VALUES(?,?,?,0)').run('escaped-form','検証',layout);
    const response=await requestWithMethod('/api/restaurant-test/menus/escaped-menu?account_id=account-1','DELETE');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:'resource_in_use'});
  });

});
