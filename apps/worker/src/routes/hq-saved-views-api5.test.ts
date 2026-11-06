import type { listTemplateViews } from '../services/hq-templates/saved-views.js';
import { Hono } from 'hono';
import { beforeEach,afterEach,describe,it,expect } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { hqTemplates } from './hq-templates.js';
let sql:ReturnType<typeof createTestD1>,app:Hono<Env>,staff:NonNullable<Env['Variables']['staff']>;
type View=Awaited<ReturnType<typeof listTemplateViews>>[number];
async function request(path?:string,method?:'GET',body?:unknown):Promise<{status:number;body:{data:View[];code?:string}}>;
async function request(path:string,method:string,body?:unknown):Promise<{status:number;body:{data:View;code?:string}}>;
async function request(path='',method='GET',body?:unknown){
 const r=await app.request(`/api/hq/templates/saved-views${path}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},{DB:sql.db} as Env['Bindings']);
 return {status:r.status,body:await r.json() as {data:View|View[];code?:string}};
}
beforeEach(()=>{
 sql=createTestD1({foreignKeys:true});sql.raw.exec("INSERT INTO tenants(id,name) VALUES('t','HQ'),('other','Other'); INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','Owner','owner','f1','t'),('second','Other Admin','admin','f2','t')");
 staff={id:'owner',name:'Owner',role:'owner',tenantId:'t',readOnly:false};app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',staff);await next();});app.route('/',hqTemplates);
});
afterEach(()=>sql.raw.close());
const input={name:'差し込みあり',filters:{kind:'message',hasInterpolations:false,messageCount:'multiple',undistributed:true,search:'予約'},scope:'personal'};
describe(' saved views',()=>{
 it('roundtrips filters and revisions, rejects stale saves, archives without deleting',async()=>{
  const created=await request('','POST',input);expect(created.status,JSON.stringify(created.body)).toBe(201);const id=created.body.data.id;
  expect(created.body.data).toMatchObject({...input,revision:1});expect((await request()).body.data).toHaveLength(1);
  expect((await request(`/${id}`,'PATCH',{...input,name:'改名',expectedRevision:1})).body.data.revision).toBe(2);
  expect((await request(`/${id}`,'PATCH',{...input,expectedRevision:1})).status).toBe(409);
  expect((await request(`/${id}`,'DELETE',{expectedRevision:1})).status).toBe(409);
  expect((await request(`/${id}`,'DELETE',{expectedRevision:2})).status).toBe(200);
  expect((await request()).body.data).toEqual([]);
  expect(sql.raw.prepare('SELECT revision,archived_at FROM hq_template_saved_views WHERE id=?').get(id)).toMatchObject({revision:3,archived_at:expect.any(String)});
 });
 it('separates private, shared and foreign searches, read-only cannot mutate',async()=>{
  const privateId=(await request('','POST',input)).body.data.id;
  const shared=(await request('','POST',{...input,scope:'tenant'})).body.data;
  staff.id='second';staff.role='admin';expect((await request()).body.data.map(r=>r.id)).toEqual([shared.id]);
  expect((await request(`/${privateId}`,'PATCH',{...input,expectedRevision:1})).status).toBe(404);
  expect((await request(`/${shared.id}`,'PATCH',{...input,expectedRevision:1})).status).toBe(403);
  expect((await request(`/${shared.id}`,'PATCH',{...input,scope:'tenant',expectedRevision:1})).status).toBe(200);
  staff.readOnly=true;expect((await request()).status).toBe(200);expect((await request('','POST',input)).status).toBe(403);
  staff.readOnly=false;sql.raw.exec("UPDATE staff_members SET tenant_id='other' WHERE id='second'");staff.tenantId='other';expect((await request()).body.data).toEqual([]);
  expect((await request(`/${shared.id}`,'DELETE',{expectedRevision:2})).status).toBe(404);
 });
 it('concurrent updates with the same revision commit only one edit',async()=>{
  const row=(await request('','POST',input)).body.data;
  const results=await Promise.all(['A','B'].map(name=>request(`/${row.id}`,'PATCH',{...input,name,expectedRevision:1})));
  expect(results.map(result=>result.status).sort()).toEqual([200,409]);
  expect((await request()).body.data[0].revision).toBe(2);
 });
 it('validates filters and folder ownership and rolls back audit failures',async()=>{
  for(const filters of [{bad:1},{messageCount:'two'},{messageCount:['single']},{hasInterpolations:0},{undistributed:'true'},{kind:'bad'},{folderId:'foreign'}]) expect((await request('','POST',{...input,filters})).status).toBe(422);
  const row=(await request('','POST',input)).body.data;
  sql.raw.exec("CREATE TRIGGER deny_view_audit BEFORE INSERT ON audit_events WHEN NEW.target_kind='hq_template_saved_view' BEGIN SELECT RAISE(ABORT,'AUDIT_UNAVAILABLE'); END");
  expect((await request(`/${row.id}`,'PATCH',{...input,name:'失敗',expectedRevision:1})).status).toBe(500);
  expect((await request()).body.data[0]).toMatchObject({name:input.name,revision:1});
  expect(sql.raw.pragma('foreign_key_check')).toEqual([]);
 });
});
