import { Hono } from 'hono';
import { beforeEach,afterEach,it,expect } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { hqTemplates } from './hq-templates.js';
import { friendAttributes } from './friend-attributes.js';
let sql:ReturnType<typeof createTestD1>,app:Hono<Env>;
interface MarkView {id:string;version:number;displayLocations:string[];displayTargets:string[]}
interface HqFixture {template:{id:string};preflightId:string;stores:Array<{status:string}>}
async function req<T=HqFixture>(path:string,method='GET',body?:unknown){
 const r=await app.request(path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},{DB:sql.db} as Env['Bindings']);
 return {status:r.status,body:await r.json() as {data:T;error?:string}};
}
beforeEach(()=>{
 sql=createTestD1({foreignKeys:true});sql.raw.exec("INSERT INTO tenants(id,name) VALUES('t','HQ'); INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','Owner','owner','fixture','t'); INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES('a','A','a','f','f','t'),('b','B','b','f','f','t')");
 app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',{id:'owner',name:'Owner',role:'owner',tenantId:'t',readOnly:false});await next();});app.route('/',hqTemplates);app.route('/',friendAttributes);
});
afterEach(()=>sql.raw.close());
const def=(locations?:unknown)=>({schemaVersion:1,mark:{name:'相談',color:'#00AA00',...(locations===undefined?{}:{displayLocations:locations})}});
it('saves and distributes exact locations, lists persisted values, detects target changes after preflight',async()=>{
 const created=await req('/api/hq/templates','POST',{type:'mark',name:'相談',definition:def(['friend_detail']),requestId:crypto.randomUUID()});expect(created.status,JSON.stringify(created.body)).toBe(201);
 const id=created.body.data.template.id;
 const list=await req<Array<{display_locations:string[]}>>('/api/hq/templates?type=mark');expect(list.body.data[0].display_locations).toEqual(['friend_detail']);
 const p=(await req(`/api/hq/templates/${id}/preflight`,'POST',{accountIds:['a']})).body.data;
 const run=await req(`/api/hq/templates/${id}/distribute`,'POST',{preflightId:p.preflightId,resolutions:[{accountId:'a',sourceId:'mark',mode:'create'}]});expect(run.status,JSON.stringify(run.body)).toBe(200);expect(run.body.data.stores[0].status).toBe('succeeded');
 const row=sql.raw.prepare("SELECT m.* FROM support_marks m JOIN support_mark_scopes s ON s.mark_id=m.id WHERE s.line_account_id='a' AND m.name='相談'").get() as {id:string;version:number;display_locations_json:string};expect(JSON.parse(row.display_locations_json)).toEqual(['friend_detail']);
 expect((await req<MarkView[]>('/api/support-marks?lineAccountId=a')).body.data.find((m:{id:string})=>m.id===row.id)).toMatchObject({displayLocations:['friend_detail'],displayTargets:['friend_detail']});
 const second=(await req(`/api/hq/templates/${id}/preflight`,'POST',{accountIds:['a']})).body.data;
 expect((await req(`/api/support-marks/${row.id}?lineAccountId=a`,'PATCH',{displayLocations:[],expectedVersion:row.version})).status).toBe(200);
 expect((await req(`/api/support-marks/${row.id}?lineAccountId=a`,'PATCH',{displayLocations:['inbox'],expectedVersion:row.version})).status).toBe(409);
 const stale=await req(`/api/hq/templates/${id}/distribute`,'POST',{preflightId:second.preflightId,resolutions:[{accountId:'a',sourceId:'mark',mode:'overwrite'}]});
 expect(stale.body.data.stores[0].status).toBe('version_conflict');
 expect((await req<MarkView[]>('/api/support-marks?lineAccountId=a')).body.data.find((m:{id:string})=>m.id===row.id)!.displayTargets).toEqual([]);
 expect((await req(`/api/support-marks/${row.id}?lineAccountId=b`,'PATCH',{displayLocations:[],expectedVersion:row.version})).status).toBe(404);
 expect(sql.raw.pragma('foreign_key_check')).toEqual([]);
});
it('preserves defaults and rejects unknown, duplicated and missing-version edits',async()=>{
 expect((await req('/api/hq/templates','POST',{type:'mark',name:'相談',definition:def(['bad']),requestId:crypto.randomUUID()})).status).toBe(422);
 expect((await req('/api/hq/templates','POST',{type:'mark',name:'相談',definition:def(['inbox','inbox']),requestId:crypto.randomUUID()})).status).toBe(422);
 const row=(await req<MarkView[]>('/api/support-marks?lineAccountId=a')).body.data[0];
 expect(row.displayLocations).toEqual(['inbox','friends','friend_detail']);
 expect((await req(`/api/support-marks/${row.id}?lineAccountId=a`,'PATCH',{displayLocations:[]})).status).toBe(422);
 expect((await req(`/api/support-marks/${row.id}?lineAccountId=a`,'PATCH',{displayLocations:['bad'],expectedVersion:row.version})).status).toBe(422);
});
it('editing inherited locations clones the mark only for the selected account',async()=>{
 sql.raw.exec("INSERT INTO support_marks(id,name,color) VALUES('shared','共有','#00AA00'); INSERT INTO support_mark_scopes(mark_id,tenant_id,line_account_id,created_at) VALUES('shared','t',NULL,datetime('now'))");
 const changed=await req<MarkView>('/api/support-marks/shared?lineAccountId=a','PATCH',{displayLocations:[],expectedVersion:1});
 expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.data.id).not.toBe('shared');expect(changed.body.data.displayLocations).toEqual([]);
 const old=sql.raw.prepare("SELECT display_locations_json FROM support_marks WHERE id='shared'").get() as {display_locations_json:string};
 expect(JSON.parse(old.display_locations_json)).toEqual(['inbox','friends','friend_detail']);
 expect((await req<MarkView[]>('/api/support-marks?lineAccountId=b')).body.data.find(m=>m.id==='shared')!.displayLocations).toEqual(['inbox','friends','friend_detail']);
 expect(sql.raw.pragma('foreign_key_check')).toEqual([]);
});
