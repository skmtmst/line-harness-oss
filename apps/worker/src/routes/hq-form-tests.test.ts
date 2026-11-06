import { Hono } from 'hono';
import { afterEach,beforeEach,expect,test,vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { hqTemplates } from './hq-templates.js';
import { hqFormTests } from './hq-form-tests.js';
import { authMiddleware } from '../middleware/auth.js';

let sql:ReturnType<typeof createTestD1>,admin:Hono<Env>,publicApp:Hono<Env>,staff:Env['Variables']['staff'];
async function request(path:string,method='GET',body?:unknown,token?:string,app=admin){
  const res=await app.request(`https://worker.test${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} :{})},...(body===undefined?{}:{body:JSON.stringify(body)})},{DB:sql.db} as Env['Bindings']);
  return {status:res.status,headers:res.headers,body:await res.json() as {data:{id:string;token:string;template:{id:string;revision:number};form:{name:string};answerValidation:{valid:boolean};definition:{form:Record<string,unknown>}};success:boolean}};
}
beforeEach(()=>{
  sql=createTestD1({foreignKeys:true});sql.raw.exec("INSERT INTO tenants(id,name) VALUES('t','HQ'),('other','Other');INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','Owner','owner','fixture','t')");
  staff={id:'owner',name:'Owner',role:'owner',tenantId:'t',readOnly:false};admin=new Hono<Env>();admin.use('*',async(c,next)=>{c.set('staff',staff);await next()});admin.route('/',hqTemplates);
  publicApp=new Hono<Env>();publicApp.use('*',authMiddleware);publicApp.route('/',hqFormTests);
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('No external service allowed')}));
});
afterEach(()=>{sql.raw.close();vi.unstubAllGlobals()});
async function create(){
  const r=await request('/api/hq/templates','POST',{type:'form',name:'相談',requestId:crypto.randomUUID(),definition:{schemaVersion:1,form:{name:'相談',fields:[{name:'name',type:'text',label:'お名前',required:true}],description:null,layout:null,on_submit_tag_id:null,on_submit_scenario_id:null,save_to_metadata:false}}});
  expect(r.status,JSON.stringify(r.body)).toBe(201);return r.body.data.template;
}
async function issue(id:string,revision:number){return request(`/api/hq/templates/${id}/test-token`,'POST',{expectedRevision:revision})}
test('real auth allows only token preview; fixed version, validation and no sends/answers/events',async()=>{
  const t=await create(),issued=await issue(t.id,t.revision);expect(issued.status,JSON.stringify(issued.body)).toBe(201);
  expect(issued.headers.get('Cache-Control')).toBe('no-store');const {token,id}=issued.body.data;
  expect(sql.raw.prepare('SELECT token_hash FROM hq_form_test_tokens').get()).toEqual({token_hash:expect.stringMatching(/^[a-f0-9]{64}$/)});
  expect(sql.raw.prepare('SELECT * FROM hq_form_test_tokens').get()).not.toHaveProperty('token');
  const path=`/api/liff/hq-form-tests/${t.id}`;
  const snapshot=sql.raw.prepare('SELECT count(*) n FROM form_submissions').get();
  expect((await request(path,'GET',undefined,undefined,publicApp)).status).toBe(404);
  const read=await request(path,'GET',undefined,token,publicApp);expect(read.status,JSON.stringify(read.body)).toBe(200);
  expect(read.body.data).toMatchObject({dryRun:true,sent:0,persistsAnswers:false,form:{name:'相談'}});
  expect((await request(`${path}/submit`,'POST',{answers:{}},token,publicApp)).body.data.answerValidation.valid).toBe(false);
  expect((await request(`${path}/submit`,'POST',{answers:{name:'試し'}},token,publicApp)).body.data.answerValidation.valid).toBe(true);
  expect((await request(`${path}/submit`,'POST',{answers:[]},token,publicApp)).status).toBe(400);
  const saved=await request(`/api/hq/templates/${t.id}`);const changed=await request(`/api/hq/templates/${t.id}`,'PATCH',{name:'改名',expectedRevision:t.revision,definition:{...saved.body.data.definition,form:{...saved.body.data.definition.form,name:'新しい相談'}}});expect(changed.status).toBe(200);
  expect((await request(path,'GET',undefined,token,publicApp)).body.data.form.name).toBe('相談');
  expect(sql.raw.prepare('SELECT count(*) n FROM form_submissions').get()).toEqual(snapshot);
  for(const table of ['forms','messages_log','hq_template_distribution_runs','form_opens'])expect(sql.raw.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:0});
  expect(fetch).not.toHaveBeenCalled();
  expect((await request(`/api/hq/templates/${t.id}/test-tokens/${id}`,'DELETE')).status).toBe(200);
  expect((await request(path,'GET',undefined,token,publicApp)).status).toBe(404);
  expect(sql.raw.pragma('foreign_key_check')).toEqual([]);
});
test('cap is atomic for simultaneous issues; stale revision and wrong type denied',async()=>{
  const t=await create();
  const tag=await request('/api/hq/templates','POST',{type:'tag',name:'常連',requestId:crypto.randomUUID(),definition:{schemaVersion:1,tag:{name:'常連',color:'#06C755',description:null,folderId:null},folders:[]}});
  expect(tag.status).toBe(201);expect((await issue(tag.body.data.template.id,tag.body.data.template.revision)).status).toBe(400);
  expect((await issue(t.id,0)).status).toBe(409);
  const attempts=await Promise.all(Array.from({length:8},()=>issue(t.id,t.revision)));
  expect(attempts.filter(r=>r.status===201)).toHaveLength(5);expect(attempts.filter(r=>r.status===409)).toHaveLength(3);
  sql.raw.exec("UPDATE hq_form_test_tokens SET expires_at='2000-01-01T00:00:00Z'");expect((await issue(t.id,t.revision)).status).toBe(201);
});
test('expired, archived, other template, suspended tenant and removed creator all close access',async()=>{
  const t=await create(),other=await create(),issued=await issue(t.id,t.revision),token=issued.body.data.token,path=`/api/liff/hq-form-tests/${t.id}`;
  expect((await request(`/api/liff/hq-form-tests/${other.id}`,'GET',undefined,token,publicApp)).status).toBe(404);
  for(const [update,restore] of [["UPDATE tenants SET status='suspended' WHERE id='t'","UPDATE tenants SET status='active' WHERE id='t'"],["UPDATE staff_members SET is_active=0 WHERE id='owner'","UPDATE staff_members SET is_active=1 WHERE id='owner'"],[`UPDATE hq_templates SET archived_at='now' WHERE id='${t.id}'`,`UPDATE hq_templates SET archived_at=NULL WHERE id='${t.id}'`]]){
    sql.raw.exec(update);expect((await request(path,'GET',undefined,token,publicApp)).status).toBe(404);sql.raw.exec(restore);
  }
  sql.raw.exec("UPDATE hq_form_test_tokens SET expires_at='2000-01-01T00:00:00Z'");expect((await request(path,'GET',undefined,token,publicApp)).status).toBe(404);
  staff.readOnly=true;expect((await issue(t.id,t.revision)).status).toBe(403);staff.readOnly=false;
  sql.raw.exec("UPDATE staff_members SET tenant_id='other' WHERE id='owner'");staff.tenantId='other';expect((await issue(t.id,t.revision)).status).toBe(404);
});
