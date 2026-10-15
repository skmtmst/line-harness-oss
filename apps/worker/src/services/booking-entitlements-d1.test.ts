import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {afterAll,beforeAll,it,expect} from 'vitest';
import {grantEntitlement,operateEntitlement,entitlementUseStatement} from './booking-entitlements.js';
let mf:Miniflare,db:D1Database;
beforeAll(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']});
 db=await mf.getD1Database('DB') as unknown as D1Database;
 const sql=readFileSync(new URL('../../../../packages/db/bootstrap.sql',import.meta.url),'utf8');
 const statements=sql.split('\n').filter(line=>!line.trimStart().startsWith('--')).reduce<string[]>((result,line)=>{
  result[result.length-1]+=`\n${line}`;if(line.trimEnd().endsWith(';'))result.push('');return result;
 },['']).map(s=>s.trim()).filter(Boolean);
 for(let i=0;i<statements.length;i+=50)await db.batch(statements.slice(i,i+50).map(s=>db.prepare(s)));
 await db.batch([
  db.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token) VALUES('a','店','a','test','test')"),
  db.prepare("INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','Uf','a')"),
  db.prepare("INSERT INTO staff(id,line_account_id,name,display_name) VALUES('s','a','担当','担当')"),
  db.prepare("INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price,concurrent_capacity) VALUES('m','a','授業',30,1000,100)"),
 ]);
},120000);
afterAll(async()=>{await mf?.dispose()});
it('実D1のbatchとトリガーでも監査付き付与/同時調整/最後の1回の競合を原子的に処理する',async()=>{
 const e=await grantEntitlement(db,'a','operator','manual:grant',{friendId:'f',kind:'ticket',name:'券',remaining:2,validFrom:'2026-01-01T00:00:00Z',expiresAt:'2031-01-01T00:00:00Z',reason:'現金'});
 const results=await Promise.allSettled(['one','two'].map(key=>operateEntitlement(db,'a',e.data.id,'operator',`manual:${key}`,{action:'adjust',remaining:1,expectedVersion:1,reason:'引継ぎ'})));
 expect(results.map(r=>r.status).sort()).toEqual(['fulfilled','rejected']);
 for(const id of ['b1','b2']){
  await db.prepare(`INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at)
    VALUES(?,'a','f','s','m','2030-01-10T01:00:00Z','2030-01-10T01:30:00Z','2030-01-10T01:30:00Z','requested',1000,'2026-10-15T00:00:00Z')`).bind(id).run();
  await entitlementUseStatement(db,id,e.data.id,'2030-01-10T01:00:00Z','Asia/Tokyo').run();
 }
 const confirmed=await Promise.allSettled(['b1','b2'].map(id=>db.prepare("UPDATE bookings SET status='confirmed' WHERE id=?").bind(id).run()));
 expect(confirmed.map(r=>r.status).sort()).toEqual(['fulfilled','rejected']);
 expect(await db.prepare('SELECT remaining FROM booking_entitlements').first()).toEqual({remaining:0});
 expect(await db.prepare("SELECT COUNT(*) n FROM booking_entitlement_events WHERE action='consume'").first()).toEqual({n:1});
 expect(await db.prepare("SELECT COUNT(*) n FROM bookings WHERE status='requested'").first()).toEqual({n:1});
},30000);
