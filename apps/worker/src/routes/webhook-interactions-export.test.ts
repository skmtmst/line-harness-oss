import { Hono } from 'hono';
import { afterEach,beforeEach,expect,test,vi } from 'vitest';
import { jstNow } from '@line-crm/db';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { webhooks } from './webhooks.js';

let sql:ReturnType<typeof createTestD1>,app:Hono<Env>;
beforeEach(()=>{
  sql=createTestD1({foreignKeys:true});sql.raw.exec("INSERT INTO tenants(id,name) VALUES('t','HQ'),('other','Other');INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','Owner','owner','fixture','t');INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES('a','A','a','fixture','fixture','t'),('b','B','b','fixture','fixture','other')");
  app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',{id:'owner',name:'Owner',role:'owner',tenantId:'t',readOnly:false});await next()});app.route('/',webhooks);
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('No external service allowed')}));
});
afterEach(()=>{sql.raw.close();vi.unstubAllGlobals()});
function seed(id:string,account='a',direction='outgoing',at=jstNow()){
  sql.raw.prepare(`INSERT INTO webhook_interaction_logs(id,line_account_id,direction,webhook_name,event_type,trigger_summary,status,request_body_json,response_status,idempotency_key,started_at,created_at)
    VALUES(?,?,?,'=HYPERLINK("secret")','friend.tag','private customer','succeeded','{"token":"hidden-secret"}',200,?,?,?)`).run(id,account,direction,id,at,at);
}
test('export matches filters across pages, prevents spreadsheet formulas and omits payloads',async()=>{
  for(let i=0;i<61;i++)seed(`row-${i}`);
  seed('incoming','a','incoming');seed('foreign','b');seed('old','a','outgoing','2000-01-01T00:00:00');
  const res=await app.request('/api/webhooks/interactions/export.csv?lineAccountId=a&direction=outgoing&status=succeeded&page=2&limit=10',{},{DB:sql.db} as Env['Bindings']);
  expect(res.status).toBe(200);const csv=await res.text();expect(csv.split('\r\n')).toHaveLength(62);
  expect(csv).toContain("'=HYPERLINK");expect(csv).not.toContain('hidden-secret');expect(csv).not.toContain('private customer');expect(res.headers.get('Cache-Control')).toBe('no-store');expect(fetch).not.toHaveBeenCalled();
  expect((await app.request('/api/webhooks/interactions/export.csv?lineAccountId=b',{},{DB:sql.db} as Env['Bindings'])).status).toBe(403);
});
test('over 5000 rows is explicitly rejected rather than silently truncated',async()=>{
  sql.raw.transaction(()=>{for(let i=0;i<5001;i++)seed(`row-${i}`)})();
  const res=await app.request('/api/webhooks/interactions/export.csv?lineAccountId=a',{},{DB:sql.db} as Env['Bindings']);expect(res.status).toBe(422);
});
