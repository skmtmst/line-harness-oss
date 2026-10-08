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
async function preflight(id:string,accountIds=['a']){
 const p=await request(`/${id}/preflight`,'POST',{accountIds});expect(p.status,JSON.stringify(p.body)).toBe(200);return p.body.data;
}
async function distribute(id:string,p:any,mode?:string){
 return request(`/${id}/distribute`,'POST',{preflightId:p.preflightId,resolutions:p.stores.flatMap((s:any)=>s.items.map((i:any)=>({accountId:s.accountId,sourceId:i.sourceId,mode:mode && i.itemKind!=='folder'?mode:i.duplicate?'overwrite':'create'})))});
}
test('mark distribution creates isolated definitions, handles duplicates and skip without reapplying',async()=>{
 const {template}=await create('mark',markDefinition),p=await preflight(template.id,['a','b','c']);
 const r=await distribute(template.id,p);expect(r.status,JSON.stringify(r.body)).toBe(200);expect(r.body.data.stores.map((s:any)=>s.status)).toEqual(['succeeded','succeeded','succeeded']);
 expect(sql.raw.prepare("SELECT count(*) n FROM support_mark_scopes WHERE tenant_id='t'").get()).toEqual({n:3});
 const before=sql.raw.prepare("SELECT m.* FROM support_marks m JOIN support_mark_scopes s ON s.mark_id=m.id WHERE s.line_account_id='a'").get();
 const p2=await preflight(template.id);expect(p2.stores[0].items[0].allowedModes).toEqual(['overwrite','alias','skip']);
 const skipped=await distribute(template.id,p2,'skip');expect(skipped.body.data.stores[0]).toMatchObject({status:'succeeded',counts:{created:0,overwritten:0,aliased:0,skipped:1}});
 expect(sql.raw.prepare("SELECT m.* FROM support_marks m JOIN support_mark_scopes s ON s.mark_id=m.id WHERE s.line_account_id='a'").get()).toEqual(before);
 expect((await distribute(template.id,p2,'skip')).body.data).toEqual(skipped.body.data);
 expect((await distribute(template.id,p2,'alias')).status).toBe(409);
 const aliased=await distribute(template.id,await preflight(template.id),'alias');expect(aliased.body.data.stores[0].createdName).toBe('相談中 (2)');
 expect(sql.raw.pragma('foreign_key_check')).toEqual([]);
});
test('field distribution preserves folders, key, type, options, scope and values on overwrite',async()=>{
 const definition={schemaVersion:1,field:{name:'種別',fieldKey:'pet_kind',type:'select',folderId:'child',options:[{id:'dog',label:'犬',color:'#112233'},{id:'cat',label:'猫'}],defaultValue:'dog',isPersonal:true},folders:[{id:'parent',name:'基本',color:'#123456'},{id:'child',name:'ペット',parentId:'parent'}]};
 const {template}=await create('friend_field',definition),p=await preflight(template.id),r=await distribute(template.id,p);expect(r.status,JSON.stringify(r.body)).toBe(200);expect(r.body.data.stores[0].status).toBe('succeeded');
 const row=sql.raw.prepare("SELECT * FROM friend_fields WHERE field_key='pet_kind'").get() as any;expect(row).toMatchObject({type:'select',type_v6:'select',is_personal:1});
 expect(JSON.parse(row.options_json)[0]).toMatchObject({id:'dog',label:'犬',color:'#112233'});
 expect(sql.raw.prepare('SELECT tenant_id,line_account_id FROM friend_field_scopes WHERE field_id=?').get(row.id)).toEqual({tenant_id:'t',line_account_id:'a'});
 sql.raw.exec("INSERT INTO friends(id,line_user_id,line_account_id) VALUES('friend','Ufriend','a')");sql.raw.prepare("INSERT INTO friend_field_values(friend_id,field_id,value) VALUES('friend',?,'dog')").run(row.id);
 const overwritten=await distribute(template.id,await preflight(template.id),'overwrite');expect(overwritten.body.data.stores[0].status).toBe('succeeded');
 expect(sql.raw.prepare("SELECT value FROM friend_field_values WHERE friend_id='friend'").get()).toEqual({value:'dog'});expect(sql.raw.prepare('SELECT version FROM friend_fields WHERE id=?').get(row.id)).toEqual({version:2});
 const skipped=await distribute(template.id,await preflight(template.id),'skip');expect(skipped.body.data.stores[0].counts.skipped).toBe(1);expect(sql.raw.prepare('SELECT version FROM friend_fields WHERE id=?').get(row.id)).toEqual({version:2});
});
test.each(['changed','race','expired'])('mark %s destination rejects writes and retains atomic result',async mode=>{
 const {template}=await create('mark',markDefinition),p=await preflight(template.id);
 const mutate=()=>sql.raw.exec("INSERT INTO support_marks(id,name,color) VALUES('new','changed','#123456'); INSERT INTO support_mark_scopes(mark_id,tenant_id,line_account_id,created_at) VALUES('new','t','a','now')");
 if(mode==='changed')mutate();
 if(mode==='expired')sql.raw.prepare("UPDATE hq_template_preflights SET expires_at='2000' WHERE idempotency_fingerprint=?").run(p.preflightId);
 if(mode==='race'){
  const original=sql.db.batch.bind(sql.db);let injected=false;
  sql.db.batch=async statements=>{if(!injected){injected=true;mutate();}return original(statements)};
 }
 const r=await distribute(template.id,p);expect(r.status,JSON.stringify(r.body)).toBe(200);expect(r.body.data.stores[0].status).toBe('version_conflict');
 expect(sql.raw.prepare("SELECT count(*) n FROM support_marks WHERE name='相談中'").get()).toEqual({n:0});expect(sql.raw.pragma('foreign_key_check')).toEqual([]);
});
test('foreign target and account ownership race cannot write; decisions validated before claim',async()=>{
 const {template}=await create('mark',markDefinition);sql.raw.exec("UPDATE line_accounts SET tenant_id='foreign' WHERE id='b'");
 expect((await request(`/${template.id}/preflight`,'POST',{accountIds:['b']})).status).toBe(403);
 const p=await preflight(template.id);expect((await distribute(template.id,p,'skip')).status).toBe(409);
 expect(sql.raw.prepare('SELECT count(*) n FROM hq_template_distribution_runs').get()).toEqual({n:0});
 sql.raw.exec("UPDATE line_accounts SET tenant_id='foreign' WHERE id='a'");expect((await distribute(template.id,p)).status).toBe(403);
});
test('global field key conflicts offer explicit alias and never touch another store',async()=>{
 const {template}=await create('friend_field',fieldDefinition);
 expect((await distribute(template.id,await preflight(template.id))).body.data.stores[0].status).toBe('succeeded');
 const before=sql.raw.prepare("SELECT * FROM friend_fields WHERE field_key='pet_name'").get();
 const p=await preflight(template.id,['b']);expect(p.stores[0].items[0]).toMatchObject({allowedModes:['alias'],reason:'FIELD_KEY_IN_USE',targetId:null});
 expect((await distribute(template.id,p,'overwrite')).status).toBe(409);
 const alias=await distribute(template.id,p,'alias');expect(alias.body.data.stores[0]).toMatchObject({status:'succeeded',counts:{aliased:1}});
 const rows=sql.raw.prepare('SELECT f.field_key,s.line_account_id FROM friend_fields f JOIN friend_field_scopes s ON s.field_id=f.id ORDER BY f.field_key').all();expect(rows).toEqual([{field_key:'pet_name',line_account_id:'a'},{field_key:'pet_name_2',line_account_id:'b'}]);
 expect(sql.raw.prepare("SELECT * FROM friend_fields WHERE field_key='pet_name'").get()).toEqual(before);
});
test('field overwrite retains values and original option IDs after changing labels and removing options',async()=>{
 const initial={schemaVersion:1,field:{name:'種別',fieldKey:'pet_kind',type:'select',options:[{id:'dog',label:'犬'},{id:'cat',label:'猫'}]},folders:[]};
 const {template}=await create('friend_field',initial);await distribute(template.id,await preflight(template.id));
 const id=(sql.raw.prepare("SELECT id FROM friend_fields WHERE field_key='pet_kind'").get() as any).id;
 sql.raw.exec("INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','Uf','a')");sql.raw.prepare("INSERT INTO friend_field_values(friend_id,field_id,value) VALUES('f',?,'cat')").run(id);
 const definition={...initial,field:{...initial.field,options:[{id:'dog',label:'いぬ'}],defaultValue:'dog'}};
 expect((await request(`/${template.id}`,'PATCH',{name:'ひな形',type:'friend_field',definition,expectedRevision:2})).status).toBe(200);
 const r=await distribute(template.id,await preflight(template.id),'overwrite');expect(r.body.data.stores[0].status).toBe('succeeded');
 const row=sql.raw.prepare('SELECT options_json FROM friend_fields WHERE id=?').get(id) as any;expect(JSON.parse(row.options_json)).toEqual(expect.arrayContaining([expect.objectContaining({id:'dog',label:'いぬ'}),expect.objectContaining({id:'cat',status:'archived'})]));
 expect(sql.raw.prepare("SELECT value FROM friend_field_values WHERE friend_id='f'").get()).toEqual({value:'cat'});
});
test('incompatible field type and inherited definitions cannot be overwritten',async()=>{
 const {template}=await create('friend_field',fieldDefinition);await distribute(template.id,await preflight(template.id));
 sql.raw.exec("UPDATE friend_fields SET type_v6='number' WHERE field_key='pet_name'");
 const p=await preflight(template.id);expect(p.stores[0].items[0].allowedModes).toEqual(['alias','skip']);expect((await distribute(template.id,p,'overwrite')).status).toBe(409);
});
test('database failure rolls back definition, scope, folders, audit and success ledger together',async()=>{
 const definition={...fieldDefinition,field:{...fieldDefinition.field,folderId:'folder'},folders:[{id:'folder',name:'基本'}]};
 const {template}=await create('friend_field',definition),p=await preflight(template.id);
 sql.raw.exec("CREATE TRIGGER fail_scope BEFORE INSERT ON friend_field_scopes BEGIN SELECT RAISE(ABORT,'injected'); END");
 const r=await distribute(template.id,p);expect(r.status).toBe(200);expect(r.body.data.stores[0].status).toBe('failed');
 expect(sql.raw.prepare("SELECT count(*) n FROM friend_fields").get()).toEqual({n:0});expect(sql.raw.prepare("SELECT count(*) n FROM folders WHERE account_id='a'").get()).toEqual({n:0});
 expect(sql.raw.prepare("SELECT count(*) n FROM hq_template_distribution_results WHERE status='succeeded'").get()).toEqual({n:0});
 expect(sql.raw.prepare("SELECT count(*) n FROM audit_events WHERE action='hq_template.distributed' AND result='success'").get()).toEqual({n:0});expect(sql.raw.pragma('foreign_key_check')).toEqual([]);
});
test('setting a default mark affects only its destination, without changing friend assignments',async()=>{
 const {template}=await create('mark',{...markDefinition,mark:{...markDefinition.mark,isDefault:true}});
 for(const id of ['a','b'])sql.raw.prepare("INSERT INTO support_marks(id,name,is_default) VALUES(?,'既定',1)").run(`old-${id}`);
 for(const id of ['a','b'])sql.raw.prepare("INSERT INTO support_mark_scopes(mark_id,tenant_id,line_account_id,created_at) VALUES(?,'t',?,'now')").run(`old-${id}`,id);
 sql.raw.exec("INSERT INTO friends(id,line_user_id,line_account_id,support_mark_id) VALUES('f','Uf','a','old-a')");
 await distribute(template.id,await preflight(template.id));
 expect(sql.raw.prepare("SELECT is_default FROM support_marks WHERE id='old-a'").get()).toEqual({is_default:0});expect(sql.raw.prepare("SELECT is_default FROM support_marks WHERE id='old-b'").get()).toEqual({is_default:1});
 expect(sql.raw.prepare("SELECT support_mark_id FROM friends WHERE id='f'").get()).toEqual({support_mark_id:'old-a'});
});
test('attribute counts and totals include actual definitions, population, received versions and stale stores',async()=>{
 const {template}=await create('mark',markDefinition);
 let counts=await request('/attribute-kind-counts');expect(counts.body.data).toEqual({tag:0,friend_field:0,support_mark:1});expect(counts.body.unavailable).toBeUndefined();
 expect((await request('?kind=support_mark')).body.data.map((r:any)=>r.id)).toEqual([template.id]);
 await distribute(template.id,await preflight(template.id,['a','b']));
 const marks=sql.raw.prepare("SELECT s.line_account_id,m.id FROM support_marks m JOIN support_mark_scopes s ON s.mark_id=m.id WHERE s.tenant_id='t'").all() as any[];
 for(const m of marks)sql.raw.prepare('INSERT INTO friends(id,line_user_id,line_account_id,support_mark_id) VALUES(?,?,?,?)').run(`f-${m.line_account_id}`,`U${m.line_account_id}`,m.line_account_id,m.id);
 let list=await request('?type=mark');expect(list.body.data[0]).toMatchObject({friend_count:2,distributed_account_count:2,distributed_account_names:['a','b'],assignment_method:'受信時に自動',current_version:1});
 expect(list.body.stats).toMatchObject({totalTemplates:1,distributedAccountCount:2,undistributedTemplateCount:0,outdatedTemplateCount:0});
 expect((await request(`/${template.id}/received-versions`)).body.data.map((r:any)=>r.targetVersion.version)).toEqual([1,1]);
 await request(`/${template.id}`,'PATCH',{name:'更新',type:'mark',definition:markDefinition,expectedRevision:2});
 expect((await request('?type=mark')).body.stats.outdatedTemplateCount).toBe(1);
 await distribute(template.id,await preflight(template.id),'skip');
 list=await request('?type=mark');expect(list.body.data[0].outdated_account_count).toBe(2);
 expect((await request(`/${template.id}/received-versions`)).body.data.map((r:any)=>r.targetVersion.version)).toEqual([1,1]);
 expect((await request(`/${template.id}/versions`)).body.data[0].is_draft).toBe(true);
 const p=await preflight(template.id);expect(p.stores[0].targetVersion).toMatchObject({version:1,latestVersion:2,status:'older'});
 // Even successful history from an account that moved tenant contributes nothing.
 sql.raw.exec("UPDATE line_accounts SET tenant_id='foreign' WHERE id='b'");
 list=await request('?type=mark');expect(list.body.data[0]).toMatchObject({friend_count:1,distributed_account_count:1,distributed_account_names:['a'],outdated_account_count:1});
});
test('skip alone is not a received version, distributed account or populated field',async()=>{
 const {template}=await create('friend_field',fieldDefinition);
 sql.raw.exec("INSERT INTO friend_fields(id,name,field_key,type) VALUES('field','ペット名','pet_name','text'); INSERT INTO friend_field_scopes(field_id,tenant_id,line_account_id,created_at) VALUES('field','t','a','now'); INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','Uf','a'); INSERT INTO friend_field_values(friend_id,field_id,value) VALUES('f','field','dog')");
 await distribute(template.id,await preflight(template.id),'skip');
 let list=await request('?type=friend_field');expect(list.body.data[0]).toMatchObject({distributed_account_count:0,friend_count:0});expect(list.body.stats.undistributedTemplateCount).toBe(1);
 expect((await request(`/${template.id}/received-versions`)).body.data).toEqual([]);
 await distribute(template.id,await preflight(template.id),'overwrite');
 list=await request('?kind=friend_field');expect(list.body.data[0]).toMatchObject({friend_count:1,distributed_account_count:1,assignment_method:'手動'});
 expect((await request('/attribute-kind-counts')).body.data).toEqual({tag:0,friend_field:1,support_mark:0});
});
test('overwriting old label-only options retains removed labels as archived choices',async()=>{
 const definition={schemaVersion:1,field:{name:'種別',fieldKey:'pet_kind',type:'select',options:[{id:'hq-dog',label:'犬'}]},folders:[]};
 const {template}=await create('friend_field',definition);
 sql.raw.exec(`INSERT INTO friend_fields(id,name,field_key,type,type_v6,options_json) VALUES('field','種別','pet_kind','select','select','["犬","猫"]'); INSERT INTO friend_field_scopes(field_id,tenant_id,line_account_id,created_at) VALUES('field','t','a','now')`);
 const r=await distribute(template.id,await preflight(template.id),'overwrite');expect(r.body.data.stores[0].status).toBe('succeeded');
 const row=sql.raw.prepare("SELECT options_json FROM friend_fields WHERE id='field'").get() as any;
 expect(JSON.parse(row.options_json)).toEqual(expect.arrayContaining([expect.objectContaining({label:'犬'}),expect.objectContaining({label:'猫',status:'archived'})]));
});
test.each(['text','textarea','number','date','datetime','time','select','multi_select','checkbox','url','tel','email','image','pdf'])('field %s uses the existing store storage columns',async type=>{
 const definition={...fieldDefinition,field:{...fieldDefinition.field,type}};
 const {template}=await create('friend_field',definition),r=await distribute(template.id,await preflight(template.id));expect(r.body.data.stores[0].status).toBe('succeeded');
 const row=sql.raw.prepare("SELECT COALESCE(type_v8,type_v6,type) type FROM friend_fields WHERE field_key='pet_name'").get();expect(row).toEqual({type});
});
