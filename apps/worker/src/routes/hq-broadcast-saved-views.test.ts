import { Hono } from 'hono';
import { afterEach,beforeEach,expect,test,vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { hqBroadcasts } from './hq-broadcasts.js';

let sql:ReturnType<typeof createTestD1>,app:Hono<Env>,staff:Env['Variables']['staff'];
interface View {id:string;name:string;scope:string;conditions:Record<string,unknown>;revision:number;canEdit:boolean}
async function call(suffix='',method='GET',body?:unknown){
  const res=await app.request(`https://worker.test/api/hq/broadcasts/saved-views${suffix}`,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},{DB:sql.db} as Env['Bindings']);
  return {status:res.status,body:await res.json() as {data:View}};
}
async function list(){const r=await app.request('/api/hq/broadcasts/saved-views',{},{DB:sql.db} as Env['Bindings']);expect(r.status).toBe(200);return (await r.json() as {data:View[]}).data;}
beforeEach(()=>{
  sql=createTestD1({foreignKeys:true});sql.raw.exec("INSERT INTO tenants(id,name) VALUES('t','HQ'),('other','Other');INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('one','One','owner','one','t'),('two','Two','admin','two','t'),('foreign','Foreign','owner','foreign','other')");
  staff={id:'one',name:'One',role:'owner',tenantId:'t',readOnly:false};app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',staff);await next()});app.route('/',hqBroadcasts);
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('No external service allowed')}));
});
afterEach(()=>{sql.raw.close();vi.unstubAllGlobals()});
const input={name:'今月の承認待ち',conditions:{from:'2026-10-01',to:'2026-10-31',status:'pending_approval',q:'お知らせ',sort:'newest',limit:20}};
test('default shared + private scope; only creator edits, tenants stay isolated, archives preserve rows',async()=>{
  const shared=await call('','POST',input),personal=await call('','POST',{...input,scope:'private'});
  expect(shared.status,JSON.stringify(shared.body)).toBe(201);expect(shared.body.data).toMatchObject({...input,scope:'hq',revision:1,canEdit:true});expect(personal.status).toBe(201);
  expect(await list()).toHaveLength(2);
  staff.id='two';staff.role='admin';expect(await list()).toEqual([expect.objectContaining({id:shared.body.data.id,canEdit:false})]);
  expect((await call(`/${personal.body.data.id}`,'PATCH',{...input,expectedRevision:1})).status).toBe(404);
  expect((await call(`/${shared.body.data.id}`,'DELETE',{expectedRevision:1})).status).toBe(404);
  staff.id='foreign';staff.tenantId='other';staff.role='owner';expect(await list()).toHaveLength(0);
  expect((await call(`/${shared.body.data.id}`,'PATCH',{...input,expectedRevision:1})).status).toBe(404);
  staff.id='one';staff.tenantId='t';
  expect((await call(`/${personal.body.data.id}`,'PATCH',{...input,expectedRevision:1})).body.data.scope).toBe('private');
  const updated=await call(`/${shared.body.data.id}`,'PATCH',{...input,name:'改名',expectedRevision:1});expect(updated.body.data.revision).toBe(2);
  expect((await call(`/${shared.body.data.id}`,'PATCH',{...input,expectedRevision:1})).status).toBe(409);
  expect((await call(`/${shared.body.data.id}`,'DELETE',{expectedRevision:1})).status).toBe(409);
  expect((await call(`/${shared.body.data.id}`,'DELETE',{expectedRevision:2})).status).toBe(200);
  expect(sql.raw.prepare('SELECT archived_at FROM hq_broadcast_saved_views WHERE id=?').get(shared.body.data.id)).toEqual({archived_at:expect.any(String)});
  expect(await list()).toHaveLength(1);expect(fetch).not.toHaveBeenCalled();expect(sql.raw.pragma('foreign_key_check')).toEqual([]);
});
test('invalid conditions, duplicate name, read only and scoped administrators are denied',async()=>{
  for(const conditions of [{from:'2026-02-30'},{from:'2026-10-31',to:'2026-10-01'},{status:'anything'},{q:'x'.repeat(201)},{limit:0},{sort:'wrong'},{cursor:'20'},{accountIds:['foreign']},{folderId:'foreign'}])expect((await call('','POST',{...input,conditions})).status).toBe(400);
  expect((await call('','POST',input)).status).toBe(201);expect((await call('','POST',input)).status).toBe(409);
  staff.readOnly=true;expect((await list())[0].canEdit).toBe(false);expect((await call('','POST',{...input,name:'別'})).status).toBe(403);staff.readOnly=false;
  sql.raw.exec("UPDATE staff_members SET access_level='read_only' WHERE id='one'");expect((await list())[0].canEdit).toBe(false);expect((await call('','POST',input)).status).toBe(403);
  sql.raw.exec("UPDATE staff_members SET access_level='full',account_scope='accounts' WHERE id='one'");expect((await call()).status).toBe(403);
});
