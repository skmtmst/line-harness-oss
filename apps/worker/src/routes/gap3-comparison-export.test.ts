import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {gapFixture,gapApp,gapCall,gapOwner} from '../test-utils/gap1.js';
import {storeComparison} from './store-comparison.js';
import {processComparisonExports} from '../services/store-comparison-export.js';
import {authMiddleware} from '../middleware/auth.js';
import {Hono} from 'hono';import type { Env } from '../worker-env.js';
let d:ReturnType<typeof gapFixture>;const filters={from:'2026-10-15',to:'2026-10-15',compare:'average',order:'desc'};
beforeEach(()=>{d=gapFixture();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external_forbidden');}));for(let i=0;i<24;i++){const id='store'+i;d.raw.prepare("INSERT INTO line_accounts(id,channel_id,name,tenant_id,channel_access_token,channel_secret) VALUES(?,?,?,'t','token','secret')").run(id,id,i===0?' =FORMULA':'店'+i);d.raw.prepare("INSERT INTO hq_store_daily_metrics(account_id,date,bookings,state,computed_at) VALUES(?,'2026-10-15',?,'partial','2026-10-16T00:00:00Z')").run(id,i);}});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();d.raw.close();vi.unstubAllGlobals();});
async function create(staff=gapOwner,key='export'){const r=await gapCall(gapApp(d,[storeComparison],staff),'/api/hq/store-comparison/export','POST',filters,key);expect(r.status,await r.clone().text()).toBe(202);return (await r.json() as any).data.id;}
test('CMP-04/05/09/11/14/15: 集計CSVは閲覧のみ可・全行・一覧と同じ順序と欠測、同じキーは同じ仕事',async()=>{
 const id=await create({...gapOwner,readOnly:true});expect(await create()).toBe(id);expect(d.raw.prepare('SELECT count(*) n FROM hq_store_comparison_export_jobs').get()).toEqual({n:1});
 await processComparisonExports(d.db);await processComparisonExports(d.db);
 const app=gapApp(d,[storeComparison],{...gapOwner,readOnly:true});const status=await gapCall(app,`/api/hq/store-comparison/exports/${id}`);expect(status.status,await status.clone().text()).toBe(200);expect((await status.json() as any).data).toMatchObject({status:'completed',rowCount:25});
 const csv=await gapCall(app,`/api/hq/store-comparison/exports/${id}/download`);expect(csv.status).toBe(200);const text=await csv.text();expect(text.split('\r\n')).toHaveLength(26);expect(text).toContain("' =FORMULA");expect(text).toContain('"0","-11.5"');expect(text).not.toContain('お客さま');expect(text.split('\r\n')[1]).toContain('店23');expect(text).toContain('"",""');
 expect(d.raw.prepare("SELECT count(*) n FROM notifications WHERE event_type='store_comparison_export'").get()).toEqual({n:1});
});
test('CMP-09/10/20: 書出し後の権限縮小・別人・代理・別統括はCSVを取れない',async()=>{
 const id=await create();await processComparisonExports(d.db);d.raw.exec("UPDATE staff_members SET account_scope='accounts' WHERE id='o';INSERT INTO staff_account_scopes(staff_id,line_account_id,created_at) VALUES('o','a','now')");
 expect((await gapCall(gapApp(d,[storeComparison]),`/api/hq/store-comparison/exports/${id}/download`)).status).toBe(403);
 expect((await gapCall(gapApp(d,[storeComparison],gapOwner,true),'/api/hq/store-comparison/export','POST',filters)).status).toBe(403);
});
test('CMP-15/16: キーの別条件を拒否、裏の処理にも現在権限を適用し失敗を残す',async()=>{
 const id=await create();expect((await gapCall(gapApp(d,[storeComparison]),'/api/hq/store-comparison/export','POST',{...filters,order:'asc'},'export')).status).toBe(409);
 d.raw.exec("UPDATE staff_members SET is_active=0 WHERE id='o'");await processComparisonExports(d.db);expect(d.raw.prepare('SELECT status,error_code FROM hq_store_comparison_export_jobs WHERE id=?').get(id)).toEqual({status:'failed',error_code:'export_access_changed'});
});
test('CMP-11: 実際の認証の閲覧専用境界も集計CSVのPOSTを許す',async()=>{
 d.raw.exec("UPDATE staff_members SET access_level='read_only' WHERE id='o'");const a=new Hono<Env>();a.use('*',async(c,next)=>{c.env={DB:d.db} as any;await next();});a.use('*',authMiddleware);a.route('/',storeComparison);
 const r=await a.request('/api/hq/store-comparison/export',{method:'POST',headers:{Authorization:'Bearer owner-key','Content-Type':'application/json','Idempotency-Key':'auth-export'},body:JSON.stringify(filters)});expect(r.status,await r.clone().text()).toBe(202);
});
