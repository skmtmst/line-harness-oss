import { Hono } from 'hono';
import { beforeEach,afterEach,expect,test,vi } from 'vitest';
import { createTestD1,type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { hqTemplates } from './hq-templates.js';
import type { Env } from '../index.js';
import type { HqCatalogTemplateType } from '@line-crm/shared';
let f:SqliteD1,app:Hono<Env>,staff:Env['Variables']['staff'];
const defs={booking_menu:{schemaVersion:1,settings:{name:'初回相談',duration_minutes:60,base_price:3000}},mileage_reward:{schemaVersion:1,settings:{name:'お礼',rewardKind:'coupon',requiredMiles:100}}};
interface Detail {template:{id:string;revision:number;template_type:string};definition:unknown}
interface Preflight {preflightId:string;stores:Array<{accountId:string;items:Array<{sourceId:string;allowedModes:string[];operation?:string}>}>}
async function call<T=unknown>(suffix:string,method='GET',body?:unknown){const r=await app.request(`/api/hq/templates${suffix}`,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},{DB:f.db} as Env['Bindings']);return {status:r.status,body:await r.json() as {data:T;code?:string}};}
async function create(type:HqCatalogTemplateType,definition:unknown=defs[type]){const r=await call<Detail>('','POST',{type,name:'配るひな形',definition,requestId:crypto.randomUUID()});expect(r.status,JSON.stringify(r.body)).toBe(201);return r.body.data.template.id;}
async function check(id:string,accountIds=['a']){const r=await call<Preflight>(`/${id}/preflight`,'POST',{accountIds});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body.data;}
const run=(id:string,p:Preflight,mode='create')=>call<{status:string;stores:Array<{status:string;createdName:string;counts:Record<string,number>}>}>(`/${id}/distribute`,'POST',{preflightId:p.preflightId,resolutions:p.stores.flatMap(s=>s.items.map(i=>({accountId:s.accountId,sourceId:i.sourceId,mode:i.operation==='reuse'?'overwrite':mode})))});
beforeEach(()=>{
 f=createTestD1({foreignKeys:true});
 f.raw.exec("INSERT INTO mileage_programs(id,code,name,status,created_at,updated_at) VALUES('default','default','マイル','active','2026-10-15','2026-10-15')");
 f.raw.exec("INSERT INTO tenants(id,name) VALUES('t','HQ'),('other','Other'); INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','Owner','owner','unused','t'); INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id) VALUES('a','Store','a','x','x','t'),('b','Store2','b','x','x','t'),('other','Hidden','other','x','x','other')");
 staff={id:'owner',name:'Owner',role:'owner',tenantId:'t',readOnly:false};
 app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',staff);await next();});app.route('/',hqTemplates);
 vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('No external requests');}));
});
afterEach(()=>{f.raw.close();vi.unstubAllGlobals();});
test.each(['booking_menu','mileage_reward'] as const)('%s: 共通の保存・配布・再試行・上書き・別名・保管を保持する',async type=>{
 const id=await create(type),p=await check(id),sent=await run(id,p);
 expect(sent.body.data.status,JSON.stringify(sent.body)).toBe('completed');
 expect(sent.body.data.stores[0].createdName).toBe(defs[type].settings.name);
 expect((await run(id,p)).body).toEqual(sent.body);
 const table=type==='booking_menu'?'menus':'mileage_rewards';
 const row=f.raw.prepare(`SELECT * FROM ${table} WHERE line_account_id='a'`).get() as Record<string,unknown>;
 expect(type==='booking_menu'?row.is_active:row.status).toBe(type==='booking_menu'?0:'draft');
 const updated=await check(id);expect(updated.stores[0].items[0].allowedModes).toContain('overwrite');
 expect((await run(id,updated,'overwrite')).body.data.status).toBe('completed');
 expect(f.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({n:1});
 expect((await run(id,await check(id),'alias')).body.data.status).toBe('completed');
 expect(f.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({n:2});
 const detail=await call<Detail>(`/${id}`);expect(detail.body.data.template.template_type).toBe(type);
 expect((await call<Detail['template'][]>(`?type=${type}`)).body.data.map(r=>r.template_type)).toEqual([type]);
 expect((await call(`/${id}`,'DELETE',{expectedRevision:detail.body.data.template.revision})).status).toBe(200);
 expect((await call(`/${id}/restore`,'POST',{expectedRevision:detail.body.data.template.revision+1})).status).toBe(200);
 expect(f.raw.pragma('foreign_key_check')).toEqual([]);expect(fetch).not.toHaveBeenCalled();
});
test('予約メニューのタグを同名へ解決し、確認後の参照・受付の変更で配らない',async()=>{
 f.raw.exec("INSERT INTO tags(id,name,line_account_id) VALUES('tag-a','予約','a'),('tag-b','予約','b')");
 const id=await create('booking_menu',{...defs.booking_menu,settings:{...defs.booking_menu.settings,autoTagName:'予約',concurrent_capacity:2}});
 const p=await check(id,['a','b']);expect((await run(id,p)).body.data.status).toBe('completed');
 expect(f.raw.prepare('SELECT line_account_id,auto_tag_id FROM menus ORDER BY line_account_id').all()).toEqual([{line_account_id:'a',auto_tag_id:'tag-a'},{line_account_id:'b',auto_tag_id:'tag-b'}]);
 const next=await check(id);f.raw.exec("UPDATE tags SET version=version+1 WHERE id='tag-a'");
 expect((await run(id,next,'overwrite')).body.data.stores[0].status).toBe('version_conflict');
 f.raw.exec("UPDATE menus SET is_active=1 WHERE line_account_id='a'");
 const active=await check(id);expect(active.stores[0].items[0].allowedModes).toEqual(['alias']);
 expect((await run(id,active,'overwrite')).body.data.stores[0].status).toBe('failed');
});
test('景品は同名の公開処理と対象タグを店内のIDへ固定し、公開やコードの複製をしない',async()=>{
 f.raw.exec(`INSERT INTO tags(id,name,line_account_id) VALUES('vip','会員','a'); INSERT INTO common_actions(id,line_account_id,name,status) VALUES('action','a','お礼の処理','published'); INSERT INTO common_action_versions(id,common_action_id,version_number,status,action_config) VALUES('action-v1','action',1,'published','[]'); UPDATE common_actions SET current_published_version_id='action-v1' WHERE id='action'`);
 const id=await create('mileage_reward',{schemaVersion:1,settings:{name:'会員特典',rewardKind:'tag',requiredMiles:100,stockLimit:0,commonActionName:'お礼の処理',targetConditions:{operator:'AND',rules:[{type:'tag_exists',value:'会員'}]}}});
 expect((await run(id,await check(id))).body.data.status).toBe('completed');
 const v=f.raw.prepare('SELECT * FROM mileage_reward_versions').get() as Record<string,unknown>;
 expect(v.common_action_version_id).toBe('action-v1');expect(v.stock_limit).toBe(0);expect(JSON.parse(String(v.target_conditions))).toEqual({operator:'AND',rules:[{type:'tag_exists',value:'vip'}]});
 expect(f.raw.prepare('SELECT COUNT(*) n FROM mileage_reward_codes').get()).toEqual({n:0});
 const p=await check(id);f.raw.exec("UPDATE common_actions SET status='archived' WHERE id='action'");
 expect((await run(id,p,'overwrite')).body.data.stores[0].status).toBe('version_conflict');
 expect((await call(`/${id}/preflight`,'POST',{accountIds:['b']})).status).toBe(409);
});
test.each(['booking_menu','mileage_reward'] as const)('%s: 不正な値・他店ID・権限外を拒み、監査失敗時も店を作らない',async type=>{
 const base=defs[type];
 for(const settings of [{...base.settings,lineAccountId:'other'},{...base.settings,[type==='booking_menu'?'duration_minutes':'requiredMiles']:0}])expect((await call('','POST',{type,name:'不正',definition:{schemaVersion:1,settings},requestId:crypto.randomUUID()})).status).toBe(422);
 const id=await create(type);expect((await call(`/${id}/preflight`,'POST',{accountIds:['other']})).status).toBe(403);
 staff={...staff,readOnly:true};expect((await call(`/${id}/preflight`,'POST',{accountIds:['a']})).status).toBe(403);staff={...staff,readOnly:false};
 const p=await check(id);f.raw.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events WHEN NEW.action='hq_template.distributed' AND NEW.result='success' BEGIN SELECT RAISE(ABORT,'test'); END;");
 const result=await run(id,p);expect(result.body.data.stores[0].status).toBe('failed');
 expect(f.raw.prepare(`SELECT COUNT(*) n FROM ${type==='booking_menu'?'menus':'mileage_rewards'}`).get()).toEqual({n:0});
});

test('担当者へ結びついた予約メニューは無効でも上書きせず、過去の版を保持する',async()=>{
 const id=await create('booking_menu');expect((await run(id,await check(id))).body.data.status).toBe('completed');
 const menu=f.raw.prepare('SELECT id FROM menus').get() as {id:string};
 f.raw.exec("INSERT INTO staff(id,line_account_id,name,display_name) VALUES('staff','a','担当','担当')");
 f.raw.prepare('INSERT INTO staff_menus(staff_id,menu_id) VALUES(?,?)').run('staff',menu.id);
 const p=await check(id);expect(p.stores[0].items[0].allowedModes).toEqual(['alias']);
 const before=f.raw.prepare('SELECT * FROM menu_versions').all();
 expect((await run(id,p,'overwrite')).body.data.stores[0].status).toBe('failed');
 expect(f.raw.prepare('SELECT * FROM menu_versions').all()).toEqual(before);
});
