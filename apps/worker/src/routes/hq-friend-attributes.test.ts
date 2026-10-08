import { Hono } from 'hono';
import { afterEach,beforeEach,expect,test } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { hqTemplates } from './hq-templates.js';
import type { Env } from '../index.js';
let sql:ReturnType<typeof createTestD1>,app:Hono<Env>,staff:any;
export const fieldDefinition={schemaVersion:1,field:{name:'ペット名',fieldKey:'pet_name',type:'text'},folders:[]};
export const markDefinition={schemaVersion:1,mark:{name:'相談中',color:'#123456',isDefault:false,autoOnInbound:true,displayOrder:2}};
async function request(path:string,method='GET',body?:unknown){
 const res=await app.request(`https://worker.test/api/hq/templates${path}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},{DB:sql.db} as Env['Bindings']);
 return {status:res.status,body:await res.json() as any};
}
async function create(type:string,definition:unknown){
 const r=await request('','POST',{type,name:'ひな形',definition,requestId:crypto.randomUUID()});expect(r.status,JSON.stringify(r.body)).toBe(201);return r.body.data;
}
beforeEach(()=>{
 sql=createTestD1({foreignKeys:true});sql.raw.exec("INSERT INTO tenants(id,name) VALUES('t','HQ'),('foreign','Other'); INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','Owner','owner','fixture','t')");
 for(const id of ['a','b','c'])sql.raw.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES(?,?,?,'fixture','fixture','t')").run(id,id,id);
 staff={id:'owner',name:'Owner',role:'owner',tenantId:'t',readOnly:false};app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',staff);await next()});app.route('/',hqTemplates);
});
afterEach(()=>sql.raw.close());
test.each(['friend_field','mark'])('%s CRUD, folders, duplicate, immutable versions and stale edit protection',async type=>{
 const definition=type==='mark'?markDefinition:fieldDefinition;
 const folder=await request('/folders','POST',{name:'分類'});expect(folder.status).toBe(201);
 const input={type,name:'ひな形',definition,folderId:folder.body.data.id,requestId:'create-fixture-001'};
 const created=await request('','POST',input);expect(created.status,JSON.stringify(created.body)).toBe(201);const id=created.body.data.template.id;
 expect(created.body.data.template).toMatchObject({template_type:type,folder_id:folder.body.data.id});
 expect((await request('','POST',input)).body.data.template.id).toBe(id);
 const edit=await request(`/${id}`,'PATCH',{type,name:'改名',definition,expectedRevision:2});expect(edit.status).toBe(200);
 expect((await request(`/${id}`,'PATCH',{type,name:'競合',definition,expectedRevision:2})).status).toBe(409);
 expect((await request(`/${id}/versions`)).body.data.map((v:any)=>v.version)).toEqual([2,1]);
 expect((await request(`/${id}/versions/compare?from=1&to=2`)).status).toBe(200);
 expect((await request(`/${id}/versions/1/restore`,'POST',{expectedRevision:3})).status).toBe(200);
 const duplicate=await request(`/${id}/duplicate`,'POST',{name:'複製',expectedRevision:4,requestId:crypto.randomUUID()});expect(duplicate.status).toBe(201);expect(duplicate.body.data.template.template_type).toBe(type);
 const list=await request(`?type=${type}`);expect(list.body.data).toHaveLength(2);
 expect((await request(`/${id}`,'DELETE',{expectedRevision:4})).status).toBe(200);
 expect((await request(`/${id}`)).status).toBe(404);
 expect((await request(`?type=${type}`)).body.data).toHaveLength(1);expect(sql.raw.pragma('foreign_key_check')).toEqual([]);
});
test('validation rejects invalid types, key, options, defaults, colors and foreign folders',async()=>{
 for(const definition of [
 {...fieldDefinition,field:{...fieldDefinition.field,fieldKey:'name'}},
 {...fieldDefinition,field:{...fieldDefinition.field,type:'wrong'}},
 {...fieldDefinition,field:{...fieldDefinition.field,options:['A']}},
 {...fieldDefinition,field:{...fieldDefinition.field,type:'date',defaultValue:'2026-02-30'}},
 {...fieldDefinition,field:{...fieldDefinition.field,type:'select',options:['A','A']}},
 {...fieldDefinition,field:{...fieldDefinition.field,type:'image',defaultValue:'image-id'}},
 ])expect((await request('','POST',{type:'friend_field',name:'bad',definition,requestId:crypto.randomUUID()})).status).toBe(400);
 expect((await request('','POST',{type:'mark',name:'bad',definition:{...markDefinition,mark:{...markDefinition.mark,color:'red'}},requestId:crypto.randomUUID()})).status).toBe(400);
 sql.raw.exec("INSERT INTO hq_template_folders(id,tenant_id,name) VALUES('foreign','foreign','foreign')");
 expect((await request('','POST',{type:'mark',name:'bad',definition:markDefinition,folderId:'foreign',requestId:crypto.randomUUID()})).status).toBe(422);
 expect(sql.raw.prepare('SELECT count(*) n FROM hq_templates').get()).toEqual({n:0});
});
test('read only and account scoped staff cannot mutate and foreign tenant cannot read',async()=>{
 const {template}=await create('mark',markDefinition);staff.readOnly=true;
 expect((await request(`/${template.id}`)).status).toBe(200);
 expect((await request(`/${template.id}`,'DELETE',{expectedRevision:2})).status).toBe(403);
 staff.readOnly=false;sql.raw.exec("UPDATE staff_members SET account_scope='accounts' WHERE id='owner'");expect((await request(`/${template.id}`)).status).toBe(403);
 sql.raw.exec("UPDATE staff_members SET account_scope='all',tenant_id='foreign' WHERE id='owner'");staff.tenantId='foreign';expect((await request(`/${template.id}`)).status).toBe(404);
});
