import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import type {VisitStampSettings} from '@line-crm/shared';
import {createTestD1,type SqliteD1} from '../test-utils/d1-sqlite.js';
import {saveStampCard,grantStamps,reverseStampEntry,reconcileStampVisit} from './visit-stamps.js';
import {promoteSeatWaitlist} from './restaurant-seat-waitlist.js';
import {setRestaurantAttendance} from './restaurant-attendance.js';
import {issueStampQr,storefrontQr,redeemStampQr,stampQrStatus,revokeStampQr} from './visit-stamp-qr.js';
const tenant='00000000-0000-4000-8000-000000000001';
const base:VisitStampSettings={mode:'visit',amountUnit:1000,maxPerVisit:10,firstVisitBonus:0,expiryMonths:null,timezone:'Asia/Tokyo',multipliers:[],rankMultipliers:[],rewards:[{id:'goal',name:'特典',stamps:10}]};
let f:SqliteD1,card:string;
beforeEach(async()=>{
 f=createTestD1({foreignKeys:true});
 f.raw.function('stamp_qr_now',()=>new Date().toISOString());
 const prepare=f.db.prepare.bind(f.db);
 Object.assign(f.db,{prepare:(sql:string)=>prepare(sql.replaceAll("strftime('%Y-%m-%dT%H:%M:%fZ','now')",'stamp_qr_now()'))});
 f.raw.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id,login_channel_id,liff_id) VALUES('shop','店','ch','unused','unused',?,'login','123-test')").run(tenant);
 f.raw.exec("INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('alice','U-alice','shop','アリス'),('bob','U-bob','shop','ボブ')");
 card=(await saveStampCard(f.db,tenant,{name:'カード',active:true,settings:base,accountIds:['shop'],expectedVersion:0})).id;
 vi.useFakeTimers();vi.setSystemTime(new Date('2027-01-01T14:59:00Z'));
});
afterEach(()=>{vi.useRealTimers();f.raw.close();});
const issue=(requestId:string,previousQrId?:string,count=1,sessionId='session',continueAfterUse=false)=>issueStampQr(f.db,card,'shop','staff','staff',{requestId,sessionId,previousQrId,count,continueAfterUse});
const fixed=(requestId='fixed',expectedQrId?:string)=>issueStampQr(f.db,card,'shop','admin','storefront',{requestId,expectedQrId});
const token=(url:string)=>new URL(url).searchParams.get('token')!;
const use=(url:string,friend='alice',request='read')=>redeemStampQr(f.db,'shop',friend,token(url),request);
const configure=(settings:VisitStampSettings)=>saveStampCard(f.db,tenant,{name:'カード',active:true,settings,accountIds:['shop'],expectedVersion:1},card);
it('固定QRの取得は同じURL、作り直しでだけ失効、再送は同じ発行結果',async()=>{
 expect(await storefrontQr(f.db,card,'shop')).toBeNull();const a=await fixed();
 expect(new URL(a.url).searchParams.get('liffId')).toBe('123-test');
 expect((await storefrontQr(f.db,card,'shop'))!.url).toBe(a.url);expect((await fixed()).url).toBe(a.url);
 const b=await fixed('rotate',a.id);expect(b.url).not.toBe(a.url);
 expect(await use(a.url)).toEqual({status:'invalid',reason:'revoked'});
 expect((await fixed('rotate',a.id)).id).toBe(b.id);
 await expect(fixed('stale',a.id)).rejects.toMatchObject({status:409});
});
it('店員QRを2人が同時に読むと1人だけ成功し、同じ本人の再送・取消で復活しない',async()=>{
 const q=await issue('issue');const r=await Promise.all([use(q.url,'alice','a'),use(q.url,'bob','b')]);
 expect(r.filter(x=>x.status==='success')).toHaveLength(1);expect(r.filter(x=>x.status==='invalid')).toEqual([{status:'invalid',reason:'used'}]);
 const friend=r[0].status==='success'?'alice':'bob',result=r.find(x=>x.status==='success')!;
 expect(await use(q.url,friend,'retry')).toMatchObject({status:'success',entryId:result.status==='success'?result.entryId:''});
 expect((await stampQrStatus(f.db,q.id,'shop','staff')).result?.friendName).toBe(friend==='alice'?'アリス':'ボブ');
 if(result.status==='success')await reverseStampEntry(f.db,result.entryId,tenant,'admin','取消');
 expect(await use(q.url,friend==='alice'?'bob':'alice','new')).toEqual({status:'invalid',reason:'used'});
 expect(f.raw.prepare("SELECT COUNT(*) n FROM visit_stamp_entries WHERE kind='visit'").get()).toEqual({n:1});
});
it('30秒ちょうどで期限切れ。交換は別セッションを巻き込まず、古い世代・再送を守る',async()=>{
 const a=await issue('a'),other=await issue('other',undefined,1,'other');
 vi.setSystemTime(new Date('2027-01-01T14:59:30Z'));expect(await use(a.url)).toEqual({status:'invalid',reason:'expired'});
 const b=await issue('b',a.id);expect(b.generation).toBe(2);expect((await issue('b',a.id)).url).toBe(b.url);
 expect((await stampQrStatus(f.db,other.id,'shop','staff')).qr.status).toBe('expired');
 expect(await use(a.url)).toEqual({status:'invalid',reason:'revoked'});
 await expect(issue('stale',a.id)).rejects.toMatchObject({status:409});
 await revokeStampQr(f.db,b.id,'shop','staff');expect(await use(b.url)).toEqual({status:'invalid',reason:'revoked'});
});
it('押印と交換の競合で押印結果を失わず、使った後は明示的に続ける',async()=>{
 const a=await issue('a');await use(a.url);
 expect((await issue('rotate',a.id)).status).toBe('used');
 const b=await issue('next',a.id,1,'session',true);expect(b.status).toBe('active');
 expect((await stampQrStatus(f.db,a.id,'shop','staff')).result).not.toBeNull();
});
it('同時発行・同時交換の勝者は1世代だけ、別の店員は交換・結果を読めない',async()=>{
 const a=await issue('a');const results=await Promise.allSettled([issue('b',a.id),issue('c',a.id)]);
 expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
 expect(f.raw.prepare("SELECT COUNT(*) n FROM visit_stamp_qr_codes WHERE status='active'").get()).toEqual({n:1});
 await expect(stampQrStatus(f.db,a.id,'shop','other-staff')).rejects.toMatchObject({status:403});
 await expect(issueStampQr(f.db,card,'shop','other-staff','staff',{requestId:'x',sessionId:'session',previousQrId:a.id,count:1})).rejects.toMatchObject({status:403});
});
it.each([undefined,{mode:'none' as const},{mode:'same_day' as const}])('固定QRは設定%jでも同日1回、手入力・店員QR・紙の記録はQRの制限に含めない',async stampInterval=>{
 await configure({...base,stampInterval});const q=await fixed();
 await grantStamps(f.db,{cardId:card,friendId:'alice',accountId:'shop',kind:'manual',count:2,reason:'手入力',requestId:'manual',actorId:'staff'});
 expect((await use(q.url,'alice','a')).status).toBe('success');
 const concurrent=await Promise.all([use(q.url,'alice','b'),use(q.url,'alice','c')]);expect(concurrent.every(x=>x.status==='limited')).toBe(true);
 const s=await issue('staff');expect((await use(s.url,'alice','staff')).status).toBe('success');
 if(stampInterval?.mode!=='same_day')await grantStamps(f.db,{cardId:card,friendId:'alice',accountId:'shop',kind:'manual',count:2,reason:'手入力',requestId:'manual2',actorId:'staff'});
 else await expect(grantStamps(f.db,{cardId:card,friendId:'alice',accountId:'shop',kind:'manual',count:2,reason:'手入力',requestId:'manual2',actorId:'staff'})).rejects.toMatchObject({status:409});
 await grantStamps(f.db,{cardId:card,friendId:'alice',accountId:'shop',kind:'paper',count:3,reason:'紙',requestId:'paper',actorId:'staff'});
 expect(await use(q.url,'alice','d')).toMatchObject({status:'limited',retryAt:'2027-01-01T15:00:00.000Z'});
 vi.setSystemTime(new Date('2027-01-01T15:00:00Z'));expect((await use(q.url,'alice','next')).status).toBe('success');
});
it('固定QRの初回同時読取と3時間の境目（同日も越える）を守る',async()=>{
 await configure({...base,stampInterval:{mode:'hours',hours:3}});const q=await fixed();
 const r=await Promise.all([use(q.url,'alice','a'),use(q.url,'alice','b')]);expect(r.filter(x=>x.status==='success')).toHaveLength(1);
 vi.setSystemTime(new Date('2027-01-01T17:58:59Z'));expect(await use(q.url,'alice','early')).toMatchObject({status:'limited',retryAt:'2027-01-01T17:59:00.000Z'});
 vi.setSystemTime(new Date('2027-01-01T17:59:00Z'));expect((await use(q.url,'alice','boundary')).status).toBe('success');
 vi.setSystemTime(new Date('2027-01-01T20:59:00Z'));expect((await use(q.url,'alice','same-day')).status).toBe('limited');
});
it('会計はサーバで切捨て、倍率・初回来店を適用。改ざん・他店・版変更を拒む',async()=>{
 await configure({...base,mode:'amount',firstVisitBonus:1,multipliers:[{multiplier:2}]});
 const q=await issueStampQr(f.db,card,'shop','staff','staff',{requestId:'amount',sessionId:'session',amount:3500,count:999});
 expect(q.count).toBe(3);expect(await use(q.url)).toMatchObject({status:'success',awarded:8});
 expect(await redeemStampQr(f.db,'other','alice',token(q.url),'other')).toEqual({status:'invalid',reason:'invalid'});
 const s=await issue('next',q.id,1,'session',true);expect(s.count).toBe(1); // カードが金額式でも個数を直接指定できる
 const fixedQr=await fixed();await saveStampCard(f.db,tenant,{name:'変更',active:true,accountIds:['shop'],settings:base,expectedVersion:2},card);
 expect(await use(fixedQr.url,'alice','updated')).toEqual({status:'invalid',reason:'revoked'});
});
it('押印後の使用済み更新が失敗したら両方ロールバックし、再送で成功する',async()=>{
 const q=await issue('a');f.raw.exec("CREATE TRIGGER fail_qr BEFORE UPDATE OF status ON visit_stamp_qr_codes WHEN NEW.status='used' BEGIN SELECT RAISE(ABORT,'test'); END");
 await expect(use(q.url)).rejects.toThrow('test');
 expect(f.raw.prepare("SELECT COUNT(*) n FROM visit_stamp_entries WHERE kind='visit'").get()).toEqual({n:0});
 expect((await stampQrStatus(f.db,q.id,'shop','staff')).qr.status).toBe('active');
 f.raw.exec('DROP TRIGGER fail_qr');expect((await use(q.url)).status).toBe('success');
});

it('処理の途中で30秒を越えたQRはトランザクション時のサーバ時刻で拒む',async()=>{
 const q=await issue('a');const batch=f.db.batch.bind(f.db);
 Object.assign(f.db,{batch:(async (statements:D1PreparedStatement[])=>{if(statements.some(s=>String((s as unknown as {sql:string}).sql).includes('q.expires_at')))vi.setSystemTime(new Date('2027-01-01T14:59:31Z'));return batch(statements)}) as D1Database['batch']});
 expect(await use(q.url)).toEqual({status:'invalid',reason:'expired'});
 expect(f.raw.prepare("SELECT COUNT(*) n FROM visit_stamp_entries WHERE kind='visit'").get()).toEqual({n:0});
});

it('カード停止と読取中のブロックでは押さず、QRを使用済みにしない',async()=>{
 const q=await issue('a');const batch=f.db.batch.bind(f.db);
 Object.assign(f.db,{batch:(async (statements:D1PreparedStatement[])=>{if(statements.some(s=>String((s as unknown as {sql:string}).sql).includes('q.expires_at')))f.raw.exec("UPDATE friends SET is_following=0 WHERE id='alice'");return batch(statements)}) as D1Database['batch']});
 expect(await use(q.url)).toEqual({status:'friend_required'});
 expect(f.raw.prepare("SELECT COUNT(*) n FROM visit_stamp_entries WHERE kind='visit'").get()).toEqual({n:0});
 expect((await stampQrStatus(f.db,q.id,'shop','staff')).qr.status).toBe('active');
 f.raw.exec("UPDATE friends SET is_following=1 WHERE id='alice'");await saveStampCard(f.db,tenant,{name:'カード',active:false,settings:base,accountIds:['shop'],expectedVersion:1},card);
 expect(await use(q.url)).toEqual({status:'invalid',reason:'revoked'});
});

function restaurantReservation() {
 f.raw.exec("INSERT INTO rt_organizations(id,account_id,name) VALUES('org','shop','組織');INSERT INTO rt_stores(id,organization_id,line_account_id,name,code) VALUES('store','org','shop','店','S');INSERT INTO rt_reservations(id,store_id,source,customer_name,line_uid,guest_count,starts_at,ends_at,status) VALUES('reservation','store','phone','アリス','U-alice',2,'2027-01-01T10:00:00Z','2027-01-01T12:00:00Z','confirmed')");
}
it('本人の予約を明示して台帳とQRを同じ来店にする。QRが先でも後でも1回だけ',async()=>{
 restaurantReservation();const q=await fixed();expect(await use(q.url)).toMatchObject({status:'visit_required',visits:[{id:'reservation',arrived:false}]});
 await expect(redeemStampQr(f.db,'shop','bob',token(q.url),'other','reservation')).rejects.toMatchObject({status:409});
 await setRestaurantAttendance(f.db,'reservation','store',{action:'visited',expectedVersion:1,requestId:'arrive'},'staff','担当');
 await Promise.all([reconcileStampVisit(f.db,'restaurant','reservation'),redeemStampQr(f.db,'shop','alice',token(q.url),'qr-read','reservation')]);
 expect(f.raw.prepare("SELECT COUNT(*) n,SUM(delta) stamps FROM visit_stamp_entries WHERE visit_key='restaurant:reservation'").get()).toEqual({n:1,stamps:1});
 expect(await redeemStampQr(f.db,'shop','alice',token(q.url),'qr-again','reservation')).toMatchObject({status:'success',alreadyCounted:true});
 await setRestaurantAttendance(f.db,'reservation','store',{action:'undo_visit',expectedVersion:2,requestId:'undo'},'staff','担当');await reconcileStampVisit(f.db,'restaurant','reservation');
 await expect(redeemStampQr(f.db,'shop','alice',token(q.url),'after-undo','reservation')).rejects.toMatchObject({status:409});
});
it('台帳で押印済みでも店員QRは1人に消費され、他の客は使えない',async()=>{
 restaurantReservation();await setRestaurantAttendance(f.db,'reservation','store',{action:'visited',expectedVersion:1,requestId:'arrive'},'staff','担当');await reconcileStampVisit(f.db,'restaurant','reservation');
 const q=await issue('staff');expect(await redeemStampQr(f.db,'shop','alice',token(q.url),'qr','reservation')).toMatchObject({status:'success',alreadyCounted:true});
 expect(await use(q.url,'bob','other')).toEqual({status:'invalid',reason:'used'});expect(f.raw.prepare("SELECT COUNT(*) n FROM visit_stamp_entries WHERE kind='visit'").get()).toEqual({n:1});
});
it('金額型の台帳来店は会計待ちを維持し、QRからも補充しない',async()=>{
 await configure({...base,mode:'amount'});restaurantReservation();await setRestaurantAttendance(f.db,'reservation','store',{action:'visited',expectedVersion:1,requestId:'arrive'},'staff','担当');
 const q=await fixed();await reconcileStampVisit(f.db,'restaurant','reservation');await expect(redeemStampQr(f.db,'shop','alice',token(q.url),'qr','reservation')).rejects.toMatchObject({status:409});expect(f.raw.prepare("SELECT COUNT(*) n FROM visit_stamp_entries WHERE kind='visit'").get()).toEqual({n:0});
});

it('退店・待ち案内・台帳押印・QRが競っても、占有と押印が一度にそろう',async()=>{
 restaurantReservation();
 f.raw.exec("INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity) VALUES('table','store','T','卓','table',1,2);UPDATE rt_reservations SET table_id='table' WHERE id='reservation'");
 // SQLiteの締切は実時計で検査するため、待ち枠を未来にする。実来店とは別の時刻を保存。
 const startsAt=new Date(Date.now()+5*3600000).toISOString(),endsAt=new Date(Date.now()+7*3600000).toISOString();
 f.raw.prepare("UPDATE rt_reservations SET starts_at=?,ends_at=? WHERE id='reservation'").run(startsAt,endsAt);
 await setRestaurantAttendance(f.db,'reservation','store',{action:'visited',expectedVersion:3,requestId:'arrive'},'staff','担当');
 f.raw.prepare("INSERT INTO rt_seat_waitlist(id,store_id,starts_at,ends_at,guest_count,customer_name,identity_key,status) VALUES('wait','store',?,?,2,'待つ組','waiting','waiting')").run(startsAt,endsAt);
 const q=await fixed(),promote=()=>promoteSeatWaitlist(f.db,{storeId:'store',startsAt,tableId:'table'});
 await Promise.all([setRestaurantAttendance(f.db,'reservation','store',{action:'depart',expectedVersion:4,requestId:'depart'},'staff','担当'),promote(),reconcileStampVisit(f.db,'restaurant','reservation'),redeemStampQr(f.db,'shop','alice',token(q.url),'qr','reservation')]);
 // 最初の空き判定が退店より先なら、次の定期確認で拾う。
 await Promise.all([promote(),promote()]);await reconcileStampVisit(f.db,'restaurant','reservation');
 expect(f.raw.prepare("SELECT status,table_id FROM rt_seat_waitlist WHERE id='wait'").get()).toEqual({status:'invited',table_id:'table'});
 expect(f.raw.prepare("SELECT COUNT(*) n FROM rt_reservation_events WHERE event_type='restaurant.waitlist.invited'").get()).toEqual({n:1});
 expect(f.raw.prepare("SELECT COUNT(*) n,SUM(delta) stamps FROM visit_stamp_entries WHERE visit_key='restaurant:reservation'").get()).toEqual({n:1,stamps:1});
 await expect(setRestaurantAttendance(f.db,'reservation','store',{action:'undo_departure',expectedVersion:5,requestId:'undo'},'staff','担当')).rejects.toThrow(/table_conflict/);
});

 it.each(['storefront','staff'] as const)('予約に結びつく%s QRは元の3時間制限と次の押印時刻を守る',async kind=>{
 await configure({...base,stampInterval:{mode:'hours',hours:3}});restaurantReservation();
 vi.setSystemTime(new Date('2027-01-01T10:00:00Z'));
 await grantStamps(f.db,{cardId:card,friendId:'alice',accountId:'shop',kind:'manual',count:1,reason:'前の来店',requestId:'previous',actorId:'staff'});
 vi.setSystemTime(new Date('2027-01-01T11:00:00Z'));
 await setRestaurantAttendance(f.db,'reservation','store',{action:'visited',expectedVersion:1,requestId:'arrive'},'staff','担当');
 const q=kind==='storefront'?await fixed():await issue('staff');
 expect(await redeemStampQr(f.db,'shop','alice',token(q.url),'early','reservation')).toMatchObject({status:'limited',dailyLimit:false,retryAt:'2027-01-01T13:00:00.000Z'});
 expect(f.raw.prepare('SELECT status FROM visit_stamp_qr_codes WHERE id=?').get(q.id)).toEqual({status:'active'});
 // 別の実来店が3時間ちょうどなら、同じ日でも元のカード契約で押せる。
 f.raw.exec("UPDATE rt_reservations SET status='confirmed' WHERE id='reservation';UPDATE rt_seat_visit_marks SET undone_at='2027-01-01T12:00:00Z' WHERE reservation_id='reservation'");
 vi.setSystemTime(new Date('2027-01-01T13:00:00Z'));
 await setRestaurantAttendance(f.db,'reservation','store',{action:'visited',expectedVersion:3,requestId:'arrive-again'},'staff','担当');
 const next=kind==='storefront'?q:await issue('next',q.id);
 expect(await redeemStampQr(f.db,'shop','alice',token(next.url),'boundary','reservation')).toMatchObject({status:'success',awarded:1});
 });
