import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {gapFixture,gapApp,gapCall,gapOwner,seedGapBooking} from '../test-utils/gap1.js';
import {storeComparison} from './store-comparison.js';
import {snapshotStoreMetrics,storeNumbers,comparisonPeriod,processStoreComparison} from '../services/store-comparison.js';
let d:ReturnType<typeof gapFixture>;
beforeEach(()=>{d=gapFixture();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external_forbidden');}));d.raw.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('a2','cha2','2店','token','secret','t'),('a3','cha3','3店','token','secret','t')");});
afterEach(()=>{d.raw.close();vi.unstubAllGlobals();});
const url='/api/hq/store-comparison?from=2026-10-15&to=2026-10-15';
function snapshot(a:string,n:number,day='2026-10-15'){
 d.raw.prepare("INSERT INTO hq_store_daily_metrics(account_id,date,bookings,visits,no_shows,friends_added,friends_blocked,friends_at_start,state,computed_at) VALUES(?,?,?,?,?,4,1,100,'partial','2026-10-16T00:00:00Z')").run(a,day,n,n,1);
}
async function read(path=url,s=gapOwner){const r=await gapCall(gapApp(d,[storeComparison],s),path);expect(r.status,await r.clone().text()).toBe(200);return (await r.json() as any).data;}
test('CMP-01/03/04/09/10/12/17: 店の範囲・期間・平均との差、未取得を0にしない',async()=>{
 snapshot('a',5);snapshot('a2',2);snapshot('a3',8);snapshot('b',999);
 let data=await read(url+'&compare=average',{...gapOwner});expect(data.rows.map((r:any)=>r.accountId)).toEqual(['a2','a','a3']);expect(data.average.bookings).toBe(5);expect(data.rows[0].metrics.bookings).toMatchObject({value:2,diff:-3,unit:'件',available:true});expect(data.rows[0].metrics.clickRate).toMatchObject({value:null,diff:null,available:false});
 snapshot('a',3,'2026-10-14');data=await read();expect(data.rows.find((r:any)=>r.accountId==='a').metrics.bookings.diff).toBe(2);
 d.raw.exec("UPDATE staff_members SET account_scope='accounts' WHERE id='o'; INSERT INTO staff_account_scopes(staff_id,line_account_id,created_at) VALUES('o','a','now')");
 data=await read(url+'&compare=average',{...gapOwner});expect(data.rows.map((r:any)=>r.accountId)).toEqual(['a']);expect(data.average.bookings).toBeNull();
 expect((await gapCall(gapApp(d,[storeComparison]),'/api/hq/store-comparison/b?from=2026-10-15&to=2026-10-15')).status).toBe(404);
 expect((await gapCall(gapApp(d,[storeComparison],{...gapOwner,id:'s',role:'staff'}),url)).status).toBe(403);expect(fetch).not.toHaveBeenCalled();
});
test('CMP-11/13/16/17: 閲覧だけも読め、失敗や欠測の日を含む期間は未取得',async()=>{
 snapshot('a',0);expect((await read(url,{...gapOwner,readOnly:true})).rows[0].metrics.bookings.value).toBe(0);
 const numbers=await storeNumbers(d.db,'a',comparisonPeriod('2026-10-14','2026-10-15'));expect(numbers.values.bookings).toBeNull();
 d.raw.exec("UPDATE hq_store_daily_metrics SET state='failed' WHERE account_id='a'");expect((await read()).rows.find((r:any)=>r.accountId==='a').metrics.bookings.value).toBeNull();
 expect((await gapCall(gapApp(d,[storeComparison]),url.replace('2026-10-15','2026-02-30'))).status).toBe(400);
});
test('CMP-04/16: 日別の控えは日本時間・来店/取消、単一店舗の失敗でも次の店舗へ',async()=>{
 seedGapBooking(d,'yes','confirmed','2026-10-14T15:30:00Z');seedGapBooking(d,'no','cancelled','2026-10-15T01:00:00Z');seedGapBooking(d,'outside','confirmed','2026-10-15T15:00:00Z');
 await snapshotStoreMetrics(d.db,'a','2026-10-15',new Date('2026-10-16T00:00:00Z'));
 expect(d.raw.prepare("SELECT bookings,friends_added FROM hq_store_daily_metrics WHERE account_id='a'").get()).toEqual({bookings:1,friends_added:null});
 d.raw.exec("DELETE FROM hq_store_daily_metrics; CREATE TRIGGER fail_one BEFORE INSERT ON hq_store_daily_metrics WHEN NEW.account_id='a' AND NEW.state!='failed' BEGIN SELECT RAISE(ABORT,'snapshot failure'); END");
 await expect(processStoreComparison(d.db,new Date('2026-10-16T00:00:00Z'))).rejects.toThrow('snapshot failure');
 await processStoreComparison(d.db,new Date('2026-10-16T00:01:00Z'));expect(d.raw.prepare('SELECT account_id,state FROM hq_store_daily_metrics ORDER BY account_id').all()).toEqual([{account_id:'a',state:'failed'},{account_id:'a2',state:'partial'}]);
});

test('CMP-01: 最初の人の返事は会話が再開しても消えず、期間の中央値を出す',async()=>{
 d.raw.exec("INSERT INTO chats(id,friend_id,pending_since,created_at,updated_at) VALUES('chat','f','2026-10-15T01:00:00Z','now','now'); UPDATE chats SET first_response_at='2026-10-15T01:01:00Z' WHERE id='chat'; UPDATE chats SET pending_since='2026-10-15T02:00:00Z',first_response_at=NULL WHERE id='chat';UPDATE chats SET first_response_at='2026-10-15T02:10:00Z' WHERE id='chat'");
 await snapshotStoreMetrics(d.db,'a','2026-10-15');d.raw.exec("UPDATE chats SET pending_since='2026-10-15T03:00:00Z',first_response_at=NULL WHERE id='chat'");
 const result=await storeNumbers(d.db,'a',comparisonPeriod('2026-10-15','2026-10-15'));expect(result.values.responseMinutes).toBeCloseTo(5.5,4);expect(d.raw.prepare('SELECT count(*) n FROM hq_store_response_samples').get()).toEqual({n:2});
});

test('CMP-03: ECの店は使わない予約を0とせず、平均の対象から外す',async()=>{
 d.raw.exec("INSERT INTO account_styles(line_account_id,style,selection_mode,updated_at) VALUES('a','ec','configured','now')");await snapshotStoreMetrics(d.db,'a','2026-10-15');const n=await storeNumbers(d.db,'a',comparisonPeriod('2026-10-15','2026-10-15'));expect(n.values.bookings).toBeNull();expect(n.values.visits).toBeNull();expect(n.style).toBe('ec');
});

test('CMP-20: 運営の本人と店の統括が違っても検証済みの代理は読め、通常の偽の所属は拒否',async()=>{
 d.raw.exec("UPDATE staff_members SET tenant_id='other' WHERE id='o'");
 expect((await gapCall(gapApp(d,[storeComparison],{...gapOwner}),url)).status).toBe(403);
 expect((await gapCall(gapApp(d,[storeComparison],{...gapOwner},true),url)).status).toBe(200);
});

test('CMP-05/09/10: プールと現在の可視店の交差だけで比較し、指標ごとに3店未満の平均はnull',async()=>{
 snapshot('a',3);snapshot('a2',9);snapshot('a3',6);snapshot('b',999);
 d.raw.exec("INSERT INTO traffic_pools(id,slug,name,active_account_id,is_active,created_at,updated_at) VALUES('pool','p','比較用','a',1,'now','now'),('foreign','f','他統括','b',1,'now','now'); INSERT INTO pool_accounts(id,pool_id,line_account_id) VALUES('pa','pool','a'),('pb','pool','a2'),('pc','pool','b')");
 let data=await read(url+'&poolId=pool&compare=average');expect(data.rows.map((r:any)=>r.accountId)).toEqual(['a','a2']);expect(data.average.bookings).toBeNull();expect(data.rows.every((r:any)=>r.metrics.bookings.diff===null)).toBe(true);
 d.raw.exec("INSERT INTO pool_accounts(id,pool_id,line_account_id) VALUES('pd','pool','a3')");data=await read(url+'&poolId=pool&compare=average&order=desc');expect(data.average.bookings).toBe(6);expect(data.rows[0].accountId).toBe('a2');
 d.raw.exec("UPDATE hq_store_daily_metrics SET bookings=NULL WHERE account_id='a3'");expect((await read(url+'&poolId=pool&compare=average')).average.bookings).toBeNull();
 expect((await gapCall(gapApp(d,[storeComparison]),url+'&poolId=foreign')).status).toBe(404);expect((await gapCall(gapApp(d,[storeComparison]),url+'&poolId=missing')).status).toBe(404);
 d.raw.exec("UPDATE staff_members SET account_scope='accounts' WHERE id='o'; INSERT INTO staff_account_scopes(staff_id,line_account_id,created_at) VALUES('o','a','now')");data=await read(url+'&poolId=pool',{...gapOwner});expect(data.rows.map((r:any)=>r.accountId)).toEqual(['a']);
});


test('日付が変わっても過去の失敗・欠測を少しずつ回収し、集計期間を回復する', async()=>{
 d.raw.exec("UPDATE line_accounts SET is_active=0 WHERE id!='a'; UPDATE line_accounts SET created_at='2026-10-13T15:00:00Z' WHERE id='a'");
 snapshot('a',1,'2026-10-14');
 d.raw.exec("INSERT INTO hq_store_daily_metrics(account_id,date,state,computed_at) VALUES('a','2026-10-15','failed','2026-10-16T00:00:00Z')");
 const now=new Date('2026-10-18T00:00:00Z');
 for(let i=0;i<4;i++)await processStoreComparison(d.db,now);
 expect(d.raw.prepare("SELECT date,state FROM hq_store_daily_metrics WHERE account_id='a' ORDER BY date").all()).toEqual([
  {date:'2026-10-14',state:'partial'},{date:'2026-10-15',state:'partial'},
  {date:'2026-10-16',state:'partial'},{date:'2026-10-17',state:'partial'},
 ]);
 expect((await storeNumbers(d.db,'a',comparisonPeriod('2026-10-14','2026-10-17'))).values.bookings).toBe(1);
 expect(fetch).not.toHaveBeenCalled();
});


test('昨日の未処理店舗が残っていても過去枠を確保し、JST表記の作成日を落とさない',async()=>{
 d.raw.exec("UPDATE line_accounts SET created_at='2026-10-15T20:00:00' WHERE id='a'; INSERT INTO hq_store_daily_metrics(account_id,date,state,computed_at) VALUES('a','2026-10-15','failed','2026-10-16T00:00:00Z')");
 await processStoreComparison(d.db,new Date('2026-10-18T00:00:00Z'));
 expect(d.raw.prepare("SELECT state FROM hq_store_daily_metrics WHERE account_id='a' AND date='2026-10-15'").get()).toEqual({state:'partial'});
 expect(d.raw.prepare("SELECT count(*) n FROM hq_store_daily_metrics WHERE date='2026-10-17'").get()).toEqual({n:1});
 expect(d.raw.prepare("SELECT count(*) n FROM line_accounts WHERE is_active=1").get()).toEqual({n:4});
});
