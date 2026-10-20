import { Hono } from 'hono';
import { afterEach,beforeEach,expect,test,vi } from 'vitest';
import type { TagCsvImportResult } from '@line-crm/shared';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { hqTemplates } from './hq-templates.js';

let sql:ReturnType<typeof createTestD1>,app:Hono<Env>,staff:Env['Variables']['staff'];
async function call(rows:unknown,preview=false){
  const res=await app.request(`https://worker.test/api/hq/templates/tags/import${preview?'/preview':''}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows})},{DB:sql.db} as Env['Bindings']);
  return {status:res.status,body:await res.json() as {data:TagCsvImportResult}};
}
beforeEach(()=>{
  sql=createTestD1({foreignKeys:true});sql.raw.exec("INSERT INTO tenants(id,name) VALUES('t','HQ'),('other','Other');INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','Owner','owner','fixture','t');INSERT INTO hq_template_folders(id,tenant_id,name) VALUES('folder','t','顧客'),('foreign','other','他社')");
  staff={id:'owner',name:'Owner',role:'owner',tenantId:'t',readOnly:false};app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',staff);await next()});app.route('/',hqTemplates);
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('No external service allowed')}));
});
afterEach(()=>{sql.raw.close();vi.unstubAllGlobals()});
test('same CSV row contract, validation and normalized duplicates; creates HQ only and retry skips',async()=>{
  const rows=[{line:2,name:' VIP ',folderName:'顧客'},{name:'ＶＩＰ'},{name:''},{name:'a'.repeat(61)},{name:'悪い\n名前'},{name:'新規',folderName:'他社'}];
  const preview=await call(rows,true);expect(preview.status,JSON.stringify(preview.body)).toBe(200);expect(preview.body.data.summary).toMatchObject({total:6,ready:2,skipped:1,invalid:3,created:0});
  expect(sql.raw.prepare('SELECT count(*) n FROM hq_templates').get()).toEqual({n:0});
  const result=await call(rows);expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.data).toMatchObject({outcome:'partial',summary:{created:2,skipped:1,invalid:3,failed:0}});
  expect(result.body.data.rows[0].tagId).toBeTruthy();expect(result.body.data.rows[5].code).toBe('folder_not_found');
  expect(sql.raw.prepare('SELECT name,folder_id FROM hq_templates ORDER BY name').all()).toEqual([{name:'VIP',folder_id:'folder'},{name:'新規',folder_id:null}]);
  const retry=await call(rows);expect(retry.body.data.summary).toMatchObject({created:0,skipped:3,invalid:3});
  for(const table of ['tags','hq_template_distribution_runs','messages_log'])expect(sql.raw.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:0});
  expect(sql.raw.prepare('SELECT count(*) n FROM hq_template_versions').get()).toEqual({n:2});expect(fetch).not.toHaveBeenCalled();expect(sql.raw.pragma('foreign_key_check')).toEqual([]);
});
test('ambiguous folder, row limit, read only and foreign tenant boundaries',async()=>{
  sql.raw.exec("INSERT INTO hq_template_folders(id,tenant_id,name) VALUES('folder2','t',' 顧客 ')");
  const ambiguous=await call([{name:'新規',folderName:'顧客'}],true);expect(ambiguous.body.data.rows[0]).toMatchObject({status:'invalid',code:'folder_ambiguous'});
  for(const rows of [[],null,Array.from({length:501},()=>({name:'x'}))])expect((await call(rows)).status).toBe(400);
  staff.readOnly=true;expect((await call([{name:'VIP'}],true)).status).toBe(403);expect((await call([{name:'VIP'}])).status).toBe(403);staff.readOnly=false;
  expect((await call([{name:'VIP'}])).body.data.summary.created).toBe(1);
  sql.raw.exec("UPDATE staff_members SET tenant_id='other' WHERE id='owner'");staff.tenantId='other';
  expect((await call([{name:'VIP'}])).body.data.summary.created).toBe(1);
  expect(sql.raw.prepare('SELECT tenant_id,count(*) n FROM hq_templates GROUP BY tenant_id ORDER BY tenant_id').all()).toEqual([{tenant_id:'other',n:1},{tenant_id:'t',n:1}]);
});
test('a renamed CSV-created tag is reported as already created instead of returning a phantom new tag',async()=>{
  const created=await call([{name:'VIP'}]),id=created.body.data.rows[0].tagId!;
  const res=await app.request(`/api/hq/templates/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'常連',expectedRevision:2,definition:{schemaVersion:1,tag:{name:'常連',color:'#06C755',description:null,folderId:null},folders:[]}})},{DB:sql.db} as Env['Bindings']);
  expect(res.status).toBe(200);
  const retry=await call([{name:'VIP'}]);expect(retry.body.data.summary).toMatchObject({created:0,skipped:1});expect(retry.body.data.rows[0].tagId).toBe(id);
  expect(sql.raw.prepare('SELECT count(*) n FROM hq_templates').get()).toEqual({n:1});
});
