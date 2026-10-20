import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getRestaurantInventoryRules, getRestaurantInventoryRuleState, saveRestaurantInventoryRules } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { processStoredRestaurantEmail } from './restaurant-reservation-email.js';
import { customerAvailability, type CustomerStore } from './restaurant-customer-booking.js';
import type { Env } from '../worker-env.js';

let f:SqliteD1;
let currentMail:string;
const starts='2026-11-01T03:00:00.000Z';
const store:CustomerStore={id:'s',name:'試験店舗',timezone:'Asia/Tokyo',line_account_id:'acc',tenant_id:'default'};
const mail=(cancel=false)=>['From: jp_kanri@hotpepper.jp','Date: Tue, 20 Oct 2026 12:00:00 +0900',`Subject: ${cancel?'テスト予約のキャンセル':'【即予約】テスト予約の申し込み'}`,'Content-Type: text/plain; charset=utf-8','','■予約依頼番号：TEST-HP-1','■来店日時：2026年11月1日(日) 12:00','■代表者：架空 テスト様','■人数：4名様'].join('\r\n');
beforeEach(()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('実通信は禁止');}));
 f=createTestD1({now:()=>new Date('2026-10-20T00:00:00Z')});
 f.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('acc','test-channel','試験','','');
 INSERT INTO rt_organizations(id,account_id,name) VALUES('org','acc','試験');
 INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('s','org','試験店舗','s','acc'),('other','org','別店舗','o','other-acc');
 INSERT INTO rt_tables(id,store_id,code,label,seat_type,max_capacity) VALUES('t1','s','t1','T1','table',4),('t2','s','t2','T2','table',4),('other-t','other','o','別卓','table',4);
 INSERT INTO booking_settings(id,line_account_id,booking_window_days,cutoff_minutes_before,cancel_deadline_minutes_before) VALUES('bs','acc',365,0,0);
 INSERT INTO rt_inventory_slots(id,store_id,starts_at,total_capacity,line_capacity,same_day_capacity,walk_in_capacity) VALUES('i','s','${starts}',8,2,1,1),('later','s','2026-11-01T05:00:00.000Z',8,2,1,1),('other-i','other','${starts}',4,2,1,1);
 INSERT INTO rt_media(id,code,name,sender_addresses,parser_key) VALUES('hp','hotpepper','試験媒体','[]','hotpepper');`);
 f.raw.prepare("INSERT INTO rt_opening_hours_settings(store_id,hours_json,updated_by) VALUES('s',?,'test')").run(JSON.stringify(Array.from({length:7},(_,weekday)=>({weekday,periods:[{opensAt:'12:00',closesAt:'16:00'}]}))));
 currentMail=mail();
});
afterEach(()=>{f.raw.close();vi.useRealTimers();vi.unstubAllGlobals();});
async function ingest(){
 const env={DB:f.db,RAW_MAIL:{async get(){const bytes=new TextEncoder().encode(currentMail);return {size:bytes.length,body:new Blob([bytes]).stream()};}}} as unknown as Env['Bindings'];
 await processStoredRestaurantEmail({env,storeId:'s',inboundEmailId:'dummy-inbound',eventId:'dummy-event',objectKey:'dummy',media:{id:'hp',code:'hotpepper',name:'試験媒体',parser_key:'hotpepper'},fallbackSubject:'',fallbackDate:null});
}
async function available(){
 const result=await customerAvailability(f.db,store,'2026-11-01',2);
 if(!result)throw new Error('空きが未取得');
 return result.data.slots.find(slot=>slot.startsAt===starts)?.available;
}
const read=()=>getRestaurantInventoryRuleState(f.db,'s','2026-10-31T15:00:00Z','2026-11-01T15:00:00Z');
it('未設定ではメールを読んでも自動停止を有効にしない',async()=>{
 expect(await getRestaurantInventoryRules(f.db,'s')).toMatchObject({stopLine:false,stopSameDay:false,version:0});
 await ingest();
 expect(f.raw.prepare("SELECT line_capacity,same_day_capacity FROM rt_inventory_slots WHERE id='i'").get()).toEqual({line_capacity:2,same_day_capacity:1});
 expect((await read()).stoppedTotal).toBe(0);
 expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('版付き設定→予約メール→自動停止→客の満席、重複取込→取消メール→元値と空きの復元まで通る',async()=>{
 expect(await available()).toBe(true);
 expect(await saveRestaurantInventoryRules(f.db,{storeId:'s',threshold:4,stopLine:true,stopSameDay:true,notify:false,expectedVersion:0})).toBe(true);
 await ingest();
 expect(await available()).toBe(false);
 expect((await read()).stopped).toEqual([{slotId:'i',startsAt:starts,lineOriginal:2,sameDayOriginal:1,remainingSeats:4,threshold:4}]);
 expect(f.raw.prepare("SELECT id,line_capacity,same_day_capacity,walk_in_capacity FROM rt_inventory_slots WHERE id!='i' ORDER BY id").all()).toEqual([
  {id:'later',line_capacity:2,same_day_capacity:1,walk_in_capacity:1},{id:'other-i',line_capacity:2,same_day_capacity:1,walk_in_capacity:1},
 ]);
 await ingest();expect(f.raw.prepare('SELECT COUNT(*) n FROM rt_reservations').get()).toEqual({n:1});
 currentMail=mail(true);await ingest();
 expect(await available()).toBe(true);
 expect(f.raw.prepare("SELECT line_capacity,same_day_capacity,walk_in_capacity,auto_line_original,auto_same_day_original FROM rt_inventory_slots WHERE id='i'").get()).toEqual({line_capacity:2,same_day_capacity:1,walk_in_capacity:1,auto_line_original:null,auto_same_day_original:null});
 const state=await read();expect(state.stoppedTotal).toBe(0);expect(state.historyTotal).toBe(2);
 expect(state.history).toMatchObject([{beforeLine:0,afterLine:2,beforeSameDay:0,afterSameDay:1,cause:'reservation'},{beforeLine:2,afterLine:0,beforeSameDay:1,afterSameDay:0,cause:'reservation'}]);
 expect(JSON.stringify(state)).not.toContain('架空');expect(JSON.stringify(state)).not.toContain('rt_reservations:');
 expect(globalThis.fetch).not.toHaveBeenCalled();
});
