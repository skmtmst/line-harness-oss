import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
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

let testDb: SqliteD1;
let env: Env['Bindings'];



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
  testDb = createTestD1({ loginPolicy: 'off' });

  // 統括ゲート（飲食店機能パック）。このAPI群自体を検証するファイルなので
  // 既定の統括には常にパックを付けておく。ゲート自体の検証（無し→404）は
  // 別のdescribeで明示的に上書きする。
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


afterEach(()=>{testDb.raw.close();vi.unstubAllGlobals()});
function newStore() {
 testDb.raw.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token) VALUES('account-1','店','c','s','t'),('account-2','別店','d','s','t');
 INSERT INTO rt_organizations(id,account_id,name) VALUES('o','account-1','組織'),('other','account-2','別組織');
 INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('new','o','新しい店','NEW','account-1'),('foreign','other','他店','FOREIGN','account-2');`);
}
const path='/api/restaurant-test/followups/new',scope='?account_id=account-1';
describe('7行の補完とオンのHTTP境界',()=>{
 it('未作成の正当な店は200と7行、知らない店は404',async()=>{
  newStore();const response=await request(path+scope);expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({data:{template:null,bindings:[],rows:expect.any(Array)}});
  expect((testDb.raw.prepare('SELECT COUNT(*) n FROM rt_store_followup_rows WHERE store_id=\'new\'').get() as any).n).toBe(7);
  expect((await request('/api/restaurant-test/followups/missing'+scope)).status).toBe(404);
  expect((await request('/api/restaurant-test/followups/foreign'+scope)).status).toBe(404);
 });
 it('行のオンは200、古い版は409、入力違いと店の外を拒否する',async()=>{
  newStore();const url=path+'/rows/reservation_created'+scope;
  expect((await requestWithMethod(url,'PUT',{expectedRowVersion:1,enabled:true})).status).toBe(200);
  expect((await requestWithMethod(url,'PUT',{expectedRowVersion:1,enabled:true})).status).toBe(409);
  for(const body of [{enabled:true},{expectedRowVersion:1,enabled:'true'},{expectedRowVersion:0,enabled:true}]) expect((await requestWithMethod(url,'PUT',body)).status).toBe(400);
  expect((await requestWithMethod(path+'/rows/bad'+scope,'PUT',{expectedRowVersion:1,enabled:true})).status).toBe(400);
  expect((await requestWithMethod('/api/restaurant-test/followups/foreign/rows/reservation_created'+scope,'PUT',{expectedRowVersion:1,enabled:true})).status).toBe(404);
 });
 it('閲覧のみとstaffの更新を拒否し、本体を作らない',async()=>{
  newStore();
  authMocks.getStaffByApiKey.mockResolvedValue({id:'reader',name:'閲覧',role:'admin',access_level:'read_only',permission_keys:'[]',assigned_line_account_id:null,can_access_descendant_accounts:1});
  expect((await requestWithMethod(path+'/rows/reservation_created'+scope,'PUT',{expectedRowVersion:1,enabled:true},'reader')).status).toBe(403);
  authMocks.getStaffByApiKey.mockResolvedValue({id:'staff',name:'担当',role:'staff',access_level:'full',permission_keys:'[]',assigned_line_account_id:null,can_access_descendant_accounts:1});
  expect((await requestWithMethod(path+'/rows/reservation_created'+scope,'PUT',{expectedRowVersion:1,enabled:true},'staff')).status).toBe(403);
  expect((testDb.raw.prepare('SELECT COUNT(*) n FROM scenarios').get() as any).n).toBe(0);
 });
 it('記念日は何日前と現地時刻を保存し、不正な時期と別起点への記念日時刻を拒む',async()=>{
  newStore();expect((await requestWithMethod(path+'/rows/anniversary_before'+scope,'PUT',{expectedRowVersion:1,enabled:true})).status).toBe(200);
  const get=async()=> (await (await request(path+scope)).json() as any).data;
  let page=await get();const step=page.bindings[0].step_id,url=path+'/bindings/'+step+scope;
  const body={expectedVersion:page.template.template_version,trigger:'anniversary_before',anniversaryDaysBefore:3,anniversaryTime:'09:25',enabled:true};
  expect((await requestWithMethod(url,'PATCH',body)).status).toBe(200);page=await get();
  expect(page.bindings[0]).toMatchObject({offset_minutes:-4320,anniversary_time:'09:25'});
  for(const change of [{anniversaryTime:'24:00'},{anniversaryDaysBefore:0},{anniversaryDaysBefore:366},{anniversaryDaysBefore:2,offsetMinutes:-1440},{anniversaryDaysBefore:null},{anniversaryDaysBefore:undefined,offsetMinutes:null},{anniversaryDaysBefore:undefined,offsetMinutes:-10079},{trigger:'post_visit',anniversaryDaysBefore:undefined,offsetMinutes:5}]) {
    expect((await requestWithMethod(url,'PATCH',{...body,...change,expectedVersion:page.template.template_version})).status).toBe(400);
  }
  expect((await request(path+'/request-start'+scope,{expectedVersion:page.template.template_version})).status).toBe(409);
 });
});

it('LINE未接続は版競合と区別して案内する',async()=>{
 newStore();testDb.raw.exec("UPDATE rt_stores SET line_account_id=NULL WHERE id='new'");
 const response=await requestWithMethod(path+'/rows/reservation_created'+scope,'PUT',{expectedRowVersion:1,enabled:true});
 expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'line_account_required'});
});
