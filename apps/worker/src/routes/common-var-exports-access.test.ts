import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { sha256Hex, authMiddleware } from '../middleware/auth.js';
import { outputAuditMiddleware } from '../middleware/output-audit.js';
import { tenantScopeMiddleware } from '../middleware/tenant-scope.js';
import { featureEnforcementMiddleware } from '../middleware/feature-enforcement.js';
import { sensitiveOperationMiddleware } from '../middleware/sensitive-step-up.js';
import { commonVarExports } from './common-var-exports.js';

const feature = vi.hoisted(() => ({ accountFeatureAvailability: vi.fn() }));
vi.mock('../services/feature-enforcement.js', async original => ({
  ...await original<typeof import('../services/feature-enforcement.js')>(),
  accountFeatureAvailability: feature.accountFeatureAvailability,
}));

describe('共通情報CSVの機能と本人確認の境界', () => {
  let store: SqliteD1;
  let app: Hono<Env>;
  const session = 'fixture-export-session';
  beforeEach(async () => {
    store = createTestD1();
    store.raw.exec("INSERT INTO staff_members(id,name,role,api_key) VALUES ('actor','Fixture','owner','unused-export-key'); INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES ('account-a','fixture-a','A','unused','unused'),('account-b','fixture-b','B','unused','unused');");
    store.raw.prepare('INSERT INTO admin_sessions(token_hash,staff_id,expires_at) VALUES (?, ?, ?)')
      .run(await sha256Hex(session), 'actor', new Date(Date.now() + 60000).toISOString());
    feature.accountFeatureAvailability.mockReset();
    feature.accountFeatureAvailability.mockImplementation(async (_db, accountId, featureId) => ({
      featureId, contractAvailable:true, companyEnabled:accountId === 'account-a', dependenciesEnabled:true,
      effectiveEnabled:accountId === 'account-a', reason:accountId === 'account-a' ? null : 'company_disabled',
      message:'この機能は設定でオフになっています', disabledDependencies:[],
    }));
    app = new Hono<Env>();
    app.use('*', authMiddleware);
    app.use('*', outputAuditMiddleware);
    app.use('*', tenantScopeMiddleware);
    app.use('*', featureEnforcementMiddleware);
    app.use('*', sensitiveOperationMiddleware);
    app.route('/', commonVarExports);
  });
  afterEach(() => store.raw.close());
  const request = (path:string, init:RequestInit = {}) => app.request(path,{
    ...init, headers:{Authorization:`Bearer lh_session:${session}`,...init.headers},
  },{DB:store.db} as Env['Bindings']);
  async function grant(token:string) {
    store.raw.prepare("INSERT INTO auth_step_up_grants(token_hash,staff_id,purpose,session_token_hash,expires_at,created_at) VALUES (?, 'actor','data.export',?,?,datetime('now'))")
      .run(await sha256Hex(token),await sha256Hex(session),new Date(Date.now()+60000).toISOString());
  }
  async function createJob() {
    await grant('create-grant');
    const response = await request('/api/common-vars/exports',{
      method:'POST', headers:{'content-type':'application/json','X-Step-Up-Token':'create-grant'},
      body:JSON.stringify({accountId:'account-a'}),
    });
    expect(response.status).toBe(201);
    return (await response.json() as {data:{id:string;status:string;downloadUrl:string}}).data;
  }
  it('本人未確認の書き出しは401で台帳0件',async () => {
    const response = await request('/api/common-vars/exports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accountId:'account-a'})});
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({code:'STEP_UP_REQUIRED'});
    expect(store.raw.prepare('SELECT count(*) AS n FROM common_var_export_jobs').get()).toEqual({n:0});
  });
  it('保存した所属と新しい一回限りの本人確認で再生成する',async () => {
    const job = await createJob();
    await grant('regenerate-grant');
    const response = await request(`/api/common-vars/exports/${job.id}/regenerate`,{method:'POST',headers:{'X-Step-Up-Token':'regenerate-grant'}});
    expect(response.status).toBe(201);
    const next = (await response.json() as {data:{id:string;lineAccountId:string;status:string}}).data;
    expect(next.id).not.toBe(job.id);expect(next.lineAccountId).toBe('account-a');expect(next.status).toBe('completed');
    const audit = store.raw.prepare("SELECT line_account_id,result,after_json FROM audit_events WHERE source_kind='export_request' AND target_id=?").get(next.id) as {line_account_id:string;result:string;after_json:string};
    expect(audit).toMatchObject({line_account_id:'account-a',result:'success'});
    expect(JSON.parse(audit.after_json).phase).toBe('requested');
    expect(store.raw.prepare('SELECT count(*) AS n FROM common_var_export_jobs').get()).toEqual({n:2});
    expect((await request(`/api/common-vars/exports/${job.id}/regenerate`,{method:'POST',headers:{'X-Step-Up-Token':'regenerate-grant'}})).status).toBe(401);
  });
  it('ダウンロード専用の本人確認後だけCSVを返す',async () => {
    const job = await createJob();
    expect((await request(job.downloadUrl)).status).toBe(401);
    await grant('download-grant');
    const response = await request(job.downloadUrl,{headers:{'X-Step-Up-Token':'download-grant'}});
    expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('text/csv');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0,3)]).toEqual([239,187,191]);
    expect(new TextDecoder().decode(bytes)).toContain('共通情報,差し込みキー,中身,使われている場所,更新,次の変更日時,次の中身');
  });
  it('呼出側の指定で保存した所属をすり替えない',async () => {
    const job = await createJob();
    await grant('wrong-account-grant');
    const response = await request(`/api/common-vars/exports/${job.id}/regenerate?accountId=account-b`,{method:'POST',headers:{'X-Step-Up-Token':'wrong-account-grant'}});
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({code:'LINE_ACCOUNT_MISMATCH'});
    expect(store.raw.prepare('SELECT count(*) AS n FROM common_var_export_jobs').get()).toEqual({n:1});
  });
  it('本人確認済みでも機能を止めた所属の再生成は通さない',async () => {
    const job = await createJob();
    store.raw.prepare('UPDATE common_var_export_jobs SET line_account_id=? WHERE id=?').run('account-b',job.id);
    await grant('disabled-grant');
    const response = await request(`/api/common-vars/exports/${job.id}/regenerate`,{method:'POST',headers:{'X-Step-Up-Token':'disabled-grant'}});
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({code:'FEATURE_DISABLED'});
    expect(store.raw.prepare('SELECT count(*) AS n FROM common_var_export_jobs').get()).toEqual({n:1});
  });
  it('再生成を新しい出力依頼として監査に残す',async () => {
    const job = await createJob();
    await grant('audit-grant');
    const response = await request(`/api/common-vars/exports/${job.id}/regenerate?accountId=account-a`,{method:'POST',headers:{'X-Step-Up-Token':'audit-grant'}});
    expect(response.status).toBe(201);
    const next = (await response.json() as {data:{id:string}}).data;
    const record = store.raw.prepare("SELECT actor_principal_id,line_account_id,result,after_json FROM audit_events WHERE source_kind='export_request' AND target_id=?").get(next.id) as {after_json:string};
    expect(record).toBeTruthy();
    expect(record).toMatchObject({actor_principal_id:'actor',line_account_id:'account-a',result:'success'});
    expect(JSON.parse(record.after_json).phase).toBe('requested');
  });
  it.each(['read_only','staff'])('本人確認済みでも%sの書き出しは通さない',async restriction=>{
    if(restriction==='read_only') store.raw.prepare("UPDATE staff_members SET access_level='read_only' WHERE id='actor'").run();
    else store.raw.prepare("UPDATE staff_members SET role='staff',permission_keys='[]' WHERE id='actor'").run();
    await grant('restricted-grant');
    const response = await request('/api/common-vars/exports',{method:'POST',headers:{'content-type':'application/json','X-Step-Up-Token':'restricted-grant'},body:JSON.stringify({accountId:'account-a'})});
    expect(response.status).toBe(403);expect(store.raw.prepare('SELECT count(*) AS n FROM common_var_export_jobs').get()).toEqual({n:0});
  });
  it('いつものセッションは既存の本人確認の有効時間だけ通す',async()=>{
    store.raw.prepare('UPDATE admin_sessions SET step_up_at=?').run(new Date().toISOString());
    const response = await request('/api/common-vars/exports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accountId:'account-a'})});
    expect(response.status).toBe(201);
    store.raw.prepare('UPDATE admin_sessions SET step_up_at=?').run(new Date(Date.now()-11*60000).toISOString());
    expect((await request('/api/common-vars/exports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accountId:'account-a'})})).status).toBe(401);
    expect(store.raw.prepare('SELECT count(*) AS n FROM common_var_export_jobs').get()).toEqual({n:1});
  });
  it.each(['missing','wrong-account','wrong-kind'])('保存したフォルダが%sなら再生成しない',async kind=>{
    const job = await createJob();
    store.raw.prepare('UPDATE common_var_export_jobs SET filter_json=? WHERE id=?').run(JSON.stringify({accountId:'account-a',folderId:'folder-recheck'}),job.id);
    if(kind!=='missing')store.raw.prepare("INSERT INTO folders(id,kind,account_id,name,display_order,created_at,updated_at) VALUES (?,?,?,?,0,datetime('now'),datetime('now'))").run('folder-recheck',kind==='wrong-kind'?'template':'common_var',kind==='wrong-account'?'account-b':'account-a','Fixture');
    await grant('folder-grant');
    const response = await request(`/api/common-vars/exports/${job.id}/regenerate`,{method:'POST',headers:{'X-Step-Up-Token':'folder-grant'}});
    expect(response.status).toBe(400);expect(await response.json()).toMatchObject({fields:{folderId:expect.any(String)}});
    expect(store.raw.prepare('SELECT count(*) AS n FROM common_var_export_jobs').get()).toEqual({n:1});
  });
  it.each(['missing','another-account'])('保存した絞り込みの所属が%sなら新しい条件で補わない',async kind=>{
    const job = await createJob();
    store.raw.prepare('UPDATE common_var_export_jobs SET filter_json=? WHERE id=?').run(JSON.stringify(kind==='missing'?{}:{accountId:'account-b'}),job.id);
    await grant('invalid-filter-grant');
    const response = await request(`/api/common-vars/exports/${job.id}/regenerate`,{method:'POST',headers:{'X-Step-Up-Token':'invalid-filter-grant'}});
    expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:expect.stringContaining('一覧の絞り込み')});
    expect(store.raw.prepare('SELECT count(*) AS n FROM common_var_export_jobs').get()).toEqual({n:1});
  });
});
