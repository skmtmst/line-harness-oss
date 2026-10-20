import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { VisitStampSettings } from '@line-crm/shared';
import type { Env } from '../worker-env.js';
import { processVisitStampQueue, saveStampCard, stampWallet } from './visit-stamps.js';
let f: SqliteD1; let card: string;
const tenant='00000000-0000-4000-8000-000000000001';
const settings: VisitStampSettings={mode:'visit',amountUnit:1000,maxPerVisit:10,firstVisitBonus:1,expiryMonths:null,timezone:'Asia/Tokyo',multipliers:[],rankMultipliers:[],rewards:[{id:'reward',name:'fixture',stamps:2}]};
beforeEach(async()=>{
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external access forbidden');}));
  f=createTestD1();
  f.raw.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id) VALUES ('shop','fixture','ch','fake','fake','${tenant}');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('friend','Uf','shop');
    INSERT INTO rt_organizations(id,account_id,name) VALUES ('org','shop','fixture');
    INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES ('store','org','fixture','FIXTURE','shop');
    INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,status,line_uid) VALUES ('visit','store','walk_in','fixture',1,datetime('now'),datetime('now','+1 hour'),'visited','Uf');`);
  card=(await saveStampCard(f.db,tenant,{name:'fixture',active:true,settings,accountIds:['shop'],expectedVersion:0})).id;
});
afterEach(()=>{f.raw.close();vi.unstubAllGlobals();});
function stopAfterRead(pattern: RegExp) {
  let release!:()=>void, stopped!:()=>void, once=true;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const ready=new Promise<void>(resolve=>{stopped=resolve;});
  const db={...f.db,prepare:(sql:string)=>{
    const statement=f.db.prepare(sql);
    if(!pattern.test(sql))return statement;
    return {...statement,bind:(...args:unknown[])=>{
      const bound=statement.bind(...args);
      return {...bound,first:async()=>{const row=await bound.first();if(once){once=false;stopped();await gate;}return row;}};
    }};
  }} as D1Database;
  return {db,ready,release};
}
function setupVisit(kind: 'restaurant'|'booking') {
  if(kind==='booking') f.raw.exec(`UPDATE rt_reservations SET status='confirmed';DELETE FROM visit_stamp_visit_queue;
    INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at)
    VALUES ('visit','shop','friend','staff','menu',datetime('now'),datetime('now','+1 hour'),datetime('now','+1 hour'),'confirmed',0,datetime('now'));
    UPDATE bookings SET status='completed' WHERE id='visit';`);
}
function status(kind:'restaurant'|'booking',visited:boolean) {
  f.raw.prepare(`UPDATE ${kind==='restaurant'?'rt_reservations':'bookings'} SET status=? WHERE id='visit'`)
    .run(visited?(kind==='restaurant'?'visited':'completed'):'confirmed');
}
for(const kind of ['restaurant','booking'] as const) {
  test(`D-06 ${kind}: 取消の最新queueを別consumerが消した後、古いconsumerは押印しない`,async()=>{
    setupVisit(kind);
    const paused=stopAfterRead(/SELECT id,delta FROM visit_stamp_entries/);
    const old=processVisitStampQueue({DB:paused.db} as Env['Bindings']);
    await paused.ready;status(kind,false);
    await processVisitStampQueue({DB:f.db} as Env['Bindings']);
    expect(f.raw.prepare('SELECT COUNT(*) n FROM visit_stamp_visit_queue').get()).toEqual({n:0});
    paused.release();await old;
    expect(f.raw.prepare('SELECT COUNT(*) n FROM visit_stamp_entries WHERE visit_key=?').get(kind+':visit')).toEqual({n:0});
    expect((await stampWallet(f.db,card,'friend','shop')).balance).toBe(0);
  });
  test(`D-06 ${kind}: 古い取り消しは、再確認を終えた来店の押印を戻さない`,async()=>{
    setupVisit(kind);await processVisitStampQueue({DB:f.db} as Env['Bindings']);status(kind,false);
    const paused=stopAfterRead(/SELECT e.id,e.delta FROM visit_stamp_entries/);
    const old=processVisitStampQueue({DB:paused.db} as Env['Bindings']);
    await paused.ready;status(kind,true);await processVisitStampQueue({DB:f.db} as Env['Bindings']);
    paused.release();await old;
    expect((await stampWallet(f.db,card,'friend','shop')).balance).toBe(2);
    expect(f.raw.prepare("SELECT COUNT(*) n FROM visit_stamp_entries WHERE kind='reverse'").get()).toEqual({n:0});
  });
  test(`D-06 ${kind}: 古い再確認は、取り消しを終えた来店を復元しない`,async()=>{
    setupVisit(kind);await processVisitStampQueue({DB:f.db} as Env['Bindings']);status(kind,false);
    await processVisitStampQueue({DB:f.db} as Env['Bindings']);status(kind,true);
    const paused=stopAfterRead(/SELECT r.id,r.delta FROM visit_stamp_entries/);
    const old=processVisitStampQueue({DB:paused.db} as Env['Bindings']);
    await paused.ready;status(kind,false);await processVisitStampQueue({DB:f.db} as Env['Bindings']);
    paused.release();await old;
    expect((await stampWallet(f.db,card,'friend','shop')).balance).toBe(0);
    expect(f.raw.prepare("SELECT COUNT(*) n FROM visit_stamp_entries WHERE kind='restore'").get()).toEqual({n:0});
  });
}
