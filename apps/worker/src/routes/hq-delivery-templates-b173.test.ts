import { Hono } from 'hono';
import { beforeEach, afterEach, expect, test } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { hqTemplates } from './hq-templates.js';
import type { Env } from '../index.js';
import { EMPTY_FRIEND_ADD_RULE_DEFINITION } from '@line-crm/db';
let fixture:SqliteD1,app:Hono<Env>;
const auto={schemaVersion:1,settings:{name:'案内',keyword:'営業時間',matchType:'exact',responseType:'text',responseContent:'10時から'}};
const add={schemaVersion:1,settings:{name:'案内',friendKind:'first_time',priority:1,definition:{...EMPTY_FRIEND_ADD_RULE_DEFINITION,messageText:'ようこそ'}}};
const reminder={schemaVersion:1,settings:{name:'案内',triggerType:'manual',deliveryMode:'countdown',steps:[{stableStepId:'step1',offsetMinutes:-60,messageType:'text',messageContent:'あと1時間です'}]}};
const definitions={auto_reply:auto,friend_add_rule:add,reminder};
beforeEach(()=>{
 fixture=createTestD1({foreignKeys:true});
 fixture.raw.exec(`INSERT INTO tenants(id,name) VALUES ('t1','統括'),('t2','別統括');
 INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES ('a1','c1','店1','t','s','t1'),('a2','c2','店2','t','s','t1'),('a3','c3','店3','t','s','t2');
 INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES ('owner','管理者','owner','fixture','t1');`);
 app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',{id:'owner',name:'管理者',role:'owner',readOnly:false,tenantId:'t1'});await next();});app.route('/',hqTemplates);
});
afterEach(()=>fixture.raw.close());
async function req(path:string,method='GET',body?:unknown){const r=await app.request(`/api/hq/templates${path}`,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},{DB:fixture.db} as Env['Bindings']);return {status:r.status,body:await r.json() as any};}
async function create(type:keyof typeof definitions,definition:unknown=definitions[type]){const r=await req('','POST',{type,name:'配る案内',definition,requestId:crypto.randomUUID()});expect(r.status,JSON.stringify(r.body)).toBe(201);return r.body.data.template.id as string;}
async function preflight(id:string){const r=await req(`/${id}/preflight`,'POST',{accountIds:['a1']});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body.data;}
async function distribute(id:string,p:any,mode='create'){return req(`/${id}/distribute`,'POST',{preflightId:p.preflightId,resolutions:p.stores.flatMap((s:any)=>s.items.map((i:any)=>({accountId:s.accountId,sourceId:i.sourceId,mode:i.operation==='reuse'?'overwrite':mode})))});}
test.each(['auto_reply','friend_add_rule','reminder'] as const)('%s: 保存・配布・一覧・配った版・再送・下書きの上書きと別名',async type=>{
 const id=await create(type),p=await preflight(id);
 expect(p.stores[0].items[0]).toMatchObject({sourceId:type,allowedModes:['create']});
 const result=await distribute(id,p);expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.data.status).toBe('completed');expect(result.body.data.stores[0]).toMatchObject({status:'succeeded',createdName:'案内',counts:{created:1}});
 expect((await distribute(id,p)).body).toEqual(result.body);
 expect((await req(`?type=${type}`)).body.data).toMatchObject([{template_type:type,distributed_account_count:1}]);
 expect((await req(`/${id}/received-versions`)).body.data).toMatchObject([{accountId:'a1',targetVersion:{version:1,status:'latest'}}]);
 const p2=await preflight(id);expect(p2.stores[0].items[0].allowedModes).toEqual(['overwrite','alias']);
 expect((await distribute(id,p2,'overwrite')).body.data.stores[0].counts.overwritten).toBe(1);
 const p3=await preflight(id);expect((await distribute(id,p3,'alias')).body.data.stores[0].counts.aliased).toBe(1);
 const table={auto_reply:'auto_replies',friend_add_rule:'friend_add_rules',reminder:'reminders'}[type];
 expect(fixture.raw.prepare(`SELECT COUNT(*) n FROM ${table} WHERE line_account_id='a1'`).get()).toEqual({n:2});
 const row=fixture.raw.prepare(`SELECT * FROM ${table} WHERE name='案内'`).get() as any;expect(row.status??row.lifecycle_status).toBe('draft');
});
test.each(['auto_reply','friend_add_rule','reminder'] as const)('%s: 稼働・登録・途中編集は上書きできず別統括へは配らない',async type=>{
 const id=await create(type);const p=await preflight(id);await distribute(id,p);
 const table={auto_reply:'auto_replies',friend_add_rule:'friend_add_rules',reminder:'reminders'}[type];
 const p2=await preflight(id);
 fixture.raw.exec(`UPDATE ${table} SET name='店が編集' WHERE line_account_id='a1'`);
 const conflict=await distribute(id,p2,'overwrite');expect(conflict.body.data.stores[0].status).toBe('version_conflict');
 fixture.raw.exec(`UPDATE ${table} SET name='案内',${type==='friend_add_rule'?"status='published'":"lifecycle_status='published',is_active=1"} WHERE line_account_id='a1'`);
 const p3=await preflight(id);expect(p3.stores[0].items[0].allowedModes).toEqual(['alias']);
 const denied=await distribute(id,p3,'overwrite');expect(denied.body.data.stores[0].status).toBe('failed');
 expect((await req(`/${id}/preflight`,'POST',{accountIds:['a3']})).status).toBe(403);
});
test('参照は配布先の同名へ結び、無い・同名が複数なら配らない',async()=>{
 fixture.raw.exec(`INSERT INTO templates(id,name,message_type,message_content,line_account_id) VALUES ('tpl1','お礼','text','ありがとう','a1');`);
 const id=await create('auto_reply',{...auto,settings:{...auto.settings,templateId:'source-template'},references:[{sourceId:'source-template',kind:'template',name:'お礼'}]});
 const p=await preflight(id);expect((await distribute(id,p)).body.data.status).toBe('completed');
 const s=JSON.parse((fixture.raw.prepare('SELECT definition_snapshot FROM auto_reply_versions').get() as any).definition_snapshot);expect(s.templateId).toBe('tpl1');
 expect((await req(`/${id}/preflight`,'POST',{accountIds:['a2']})).status).toBe(409);
 fixture.raw.exec(`INSERT INTO templates(id,name,message_type,message_content,line_account_id) VALUES ('tpl2','お礼','text','別の文','a1');`);
 expect((await req(`/${id}/preflight`,'POST',{accountIds:['a1']})).status).toBe(409);
});
test('未宣言の他店ID・所属指定・不正な内容を保存できない',async()=>{
 for(const definition of [{...auto,settings:{...auto.settings,templateId:'a3-template'}},{...auto,settings:{...auto.settings,lineAccountId:'a3'}},{...auto,settings:{...auto.settings,matchType:'invalid'}}]) {
  expect((await req('','POST',{type:'auto_reply',name:'案内',definition,requestId:crypto.randomUUID()})).status).toBe(422);
 }
});
test('確認後に参照先だけが変わっても、配布と結果記録を同じ処理で止める',async()=>{
 fixture.raw.exec(`INSERT INTO templates(id,name,message_type,message_content,line_account_id) VALUES ('tpl1','お礼','text','ありがとう','a1');`);
 const id=await create('auto_reply',{...auto,settings:{...auto.settings,templateId:'source'},references:[{sourceId:'source',kind:'template',name:'お礼'}]});
 const p=await preflight(id);expect(p.stores[0].items[1]).toMatchObject({targetId:'tpl1',allowedModes:['overwrite'],operation:'reuse'});
 const prepare=fixture.db.prepare.bind(fixture.db),batch=fixture.db.batch.bind(fixture.db),sqls=new WeakMap<D1PreparedStatement,string>();
 fixture.db.prepare=(sql)=>{const stmt=prepare(sql),bind=stmt.bind.bind(stmt);stmt.bind=(...values)=>{const bound=bind(...values);sqls.set(bound,sql);return bound;};sqls.set(stmt,sql);return stmt;};
 let inject=true;fixture.db.batch=async(stmts)=>{if(inject&&stmts.some(stmt=>sqls.get(stmt)?.startsWith('INSERT INTO hq_template_distribution_results'))){inject=false;fixture.raw.exec("UPDATE templates SET message_content='店で編集' WHERE id='tpl1'");}return batch(stmts);};
 const r=await distribute(id,p);expect(r.body.data.stores[0].status).toBe('version_conflict');expect(fixture.raw.prepare('SELECT COUNT(*) n FROM auto_replies').get()).toEqual({n:0});
});
test('期限切れの確認・同じ配布キーで異なる選択を再送する操作を拒む',async()=>{
 const id=await create('reminder'),p=await preflight(id);
 fixture.raw.exec(`UPDATE hq_template_preflights SET expires_at='2020-01-01T00:00:00Z'`);
 expect((await distribute(id,p)).body.data.stores[0].status).toBe('version_conflict');
 expect((await distribute(id,p,'alias')).status).toBe(409);
});

test('配布先の回へ結び直せない回指定のイベント操作を保存しない',async()=>{
 const definition={...auto,settings:{...auto.settings,actions:[{actionType:'event_booking',config:{eventId:'source-event',slotId:'source-slot'}}]},references:[{sourceId:'source-event',kind:'event',name:'相談会'}]};
 expect((await req('','POST',{type:'auto_reply',name:'案内',definition,requestId:crypto.randomUUID()})).status).toBe(422);
});

test.each(['auto_reply','friend_add_rule','reminder'] as const)('%s: 入れ子の条件のタグも宣言し、配布先のIDへ結び直す',async type=>{
 const condition={operator:'AND',rules:[],groups:[{operator:'OR',rules:[{type:'tag_exists',value:'source-tag'},{type:'tag_all',value:['source-tag']}]}]};
 const base=definitions[type];
 const settings=type==='friend_add_rule'
   ? {...add.settings,definition:{...add.settings.definition,friendCondition:JSON.stringify(condition)}}
   : {...base.settings,[type==='auto_reply'?'friendConditions':'targetCondition']:condition};
 const unannounced=await req('','POST',{type,name:'条件つき',definition:{...base,settings},requestId:crypto.randomUUID()});
 expect(unannounced.status).toBe(422);
 fixture.raw.exec(`INSERT INTO tags(id,name,line_account_id) VALUES ('store-tag','会員','a1')`);
 const id=await create(type,{...base,settings,references:[{sourceId:'source-tag',kind:'tag',name:'会員'}]});
 expect((await distribute(id,await preflight(id))).body.data.status).toBe('completed');
 const table={auto_reply:'auto_reply_versions',friend_add_rule:'friend_add_rule_versions',reminder:'reminder_versions'}[type];
 const column=type==='reminder'?'settings_snapshot':'definition_snapshot';
 const saved=JSON.parse((fixture.raw.prepare(`SELECT ${column} AS settings FROM ${table}`).get() as any).settings);
 const raw=type==='friend_add_rule'?saved.friendCondition:type==='auto_reply'?saved.friendConditions:saved.targetCondition;
 expect(typeof raw==='string'?JSON.parse(raw):raw).toEqual({...condition,groups:[{operator:'OR',rules:[{type:'tag_exists',value:'store-tag'},{type:'tag_all',value:['store-tag']}]}]});
});

test('条件の回答フォームと対応マークも配布先の所属に結び直す',async()=>{
 fixture.raw.exec(`INSERT INTO forms(id,name,fields) VALUES ('store-form','回答','[]');
 INSERT INTO form_accounts(form_id,line_account_id) VALUES ('store-form','a1');
 INSERT INTO support_marks(id,name,color) VALUES ('store-mark','対応中','#000000');
 INSERT INTO support_mark_scopes(mark_id,tenant_id,line_account_id,created_at) VALUES ('store-mark','t1','a1','2026-10-10');`);
 const condition={operator:'AND',rules:[{type:'form_answered',value:'source-form'},{type:'support_mark',value:{op:'in',markIds:['source-mark']}}]};
 const id=await create('auto_reply',{...auto,settings:{...auto.settings,friendConditions:condition},references:[{sourceId:'source-form',kind:'form',name:'回答'},{sourceId:'source-mark',kind:'mark',name:'対応中'}]});
 expect((await distribute(id,await preflight(id))).body.data.status).toBe('completed');
 const saved=JSON.parse((fixture.raw.prepare('SELECT definition_snapshot FROM auto_reply_versions').get() as any).definition_snapshot);
 expect(JSON.parse(saved.friendConditions)).toEqual({operator:'AND',rules:[{type:'form_answered',value:'store-form'},{type:'support_mark',value:{op:'in',markIds:['store-mark']}}]});
 expect((await req(`/${id}/preflight`,'POST',{accountIds:['a2']})).status).toBe(409);
});

test.each(['auto_reply','friend_add_rule','reminder'] as const)('%s: 編集の競合・版の比較・過去版の復元・配った版を共通の仕組みで守る',async type=>{
 const id=await create(type);
 await distribute(id,await preflight(id));
 const detail=(await req(`/${id}`)).body.data;
 const definition={...definitions[type],settings:{...definitions[type].settings,name:'更新した案内'}};
 const update={name:'統括の更新',definition,expectedRevision:detail.template.revision};
 expect((await req(`/${id}`,'PATCH',update)).status).toBe(200);
 expect((await req(`/${id}`,'PATCH',update)).status).toBe(409);
 expect((await req(`/${id}/received-versions`)).body.data[0].targetVersion).toMatchObject({version:1,latestVersion:2,status:'older'});
 expect((await req(`/${id}/versions/compare?from=1&to=2`)).body.data.changed).toBe(true);
 const revision=(await req(`/${id}`)).body.data.template.revision;
 expect((await req(`/${id}/versions/1/restore`,'POST',{expectedRevision:revision})).status).toBe(200);
 expect((await req(`/${id}`)).body.data.definition).toEqual({...definitions[type],references:[]});
 expect((await req(`/${id}/versions`)).body.data.map((v:any)=>v.version)).toEqual([3,2,1]);
});
