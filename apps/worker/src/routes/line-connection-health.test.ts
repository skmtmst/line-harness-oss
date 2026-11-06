import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Hono} from 'hono';
import {getLineAccountListStats} from '@line-crm/db';
import {DEFAULT_TENANT_ID,lineConnectionRisk} from '@line-crm/shared';
import {createTestD1} from '../test-utils/d1-sqlite.js';
import {runOperationHealthChecks} from '../services/operations-health.js';
import {health} from './health.js';
import {lineAccounts} from './line-accounts.js';
import type {Env} from '../worker-env.js';
let db:ReturnType<typeof createTestD1>;
beforeEach(()=>{
 db=createTestD1();
 for(const id of ['normal','warn','unknown','stopped','archived']){
  db.raw.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES(?,?,?,?,?,?)').run(id,'ch-'+id,id,'private-token','private-secret',DEFAULT_TENANT_ID);
 }
 db.raw.exec("UPDATE line_accounts SET is_active=0 WHERE id='stopped'; UPDATE line_accounts SET archived_at='2026-10-01' WHERE id='archived';");
 for(const id of ['normal','warn','stopped','archived'])for(const kind of ['bot_info','webhook_endpoint']){
  db.raw.prepare('INSERT INTO line_account_connection_checks(id,line_account_id,check_kind,result,checked_by,checked_at,correlation_id,idempotency_key,account_revision) VALUES(?,?,?,?,?,?,?,?,1)').run(id+kind,id,kind,id==='warn'&&kind==='webhook_endpoint'?'unconfigured':'ok','fixture',new Date().toISOString(),id,id+kind);
 }
 db.raw.exec("INSERT INTO account_health_logs(id,line_account_id,error_count,risk_level,check_period) VALUES('old','unknown',0,'danger','5m');");
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({type:'unlimited'})));
});
afterEach(()=>{db.raw.close();vi.unstubAllGlobals();});
function app(){const a=new Hono<Env>();a.use('*',async(c,next)=>{c.set('staff',{id:'env-owner',name:'owner',role:'owner',tenantId:DEFAULT_TENANT_ID,readOnly:false,permissionKeys:[]});await next();});a.route('/',lineAccounts);a.route('/',health);return a;}
async function read(path:string){const res=await app().request(path,{}, {DB:db.db} as Env['Bindings']);expect(res.status).toBe(200);return (await res.json() as {data:any}).data;}

it('一覧・単体・health・summaryの接続が同じDBの値となり、履歴で未確認を埋めない',async()=>{
 const accounts=await read('/api/line-accounts');const summary=await read('/api/accounts/health-summary');
 for(const account of accounts){
  const single=await read('/api/line-accounts/'+account.id);
  const current=await read('/api/accounts/'+account.id+'/health');
  expect(single.connection).toEqual(account.connection);
  expect(current.connection).toEqual(account.connection);
  expect(current.riskLevel).toBe(lineConnectionRisk(account.connection));
  expect(summary.items.find((row:{lineAccountId:string})=>row.lineAccountId===account.id)?.riskLevel).toBe(current.riskLevel);
 }
 const unknown=await read('/api/accounts/unknown/health');expect(unknown.riskLevel).toBeNull();expect(unknown.logs[0].riskLevel).toBe('danger');
 expect(JSON.stringify(accounts)).not.toMatch(/private-token|private-secret/);
});

it.each(['normal','warn','unknown'])('運用確認も一覧と同じ接続元を使う %s',async(id)=>{
 const stats=await getLineAccountListStats(db.db,[id]);
 const checked=await runOperationHealthChecks(db.db,{lineAccountId:id,source:'manual'});
 expect(JSON.stringify(checked.run.results.find(r=>r.checkKey==='line_connection'))).not.toMatch(/expectedUrl|registeredUrl/);
 expect(checked.run.results.find(r=>r.checkKey==='line_connection')).toMatchObject({status:lineConnectionRisk(stats[id].connection)??'unknown'});
});
