import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {createTestD1,type SqliteD1} from '../test-utils/d1-sqlite.js';
import type {VisitStampSettings} from '@line-crm/shared';
import {calculateVisitStamps,saveStampCard,stampWallet,grantStamps,reverseStampEntry,setStampPin,verifyStampPin,offerStampReward,useStampReward,
 requestPaperStamps,applyPaperStamps,reconcileStampVisit,stampExpiry} from './visit-stamps.js';
const tenant='00000000-0000-4000-8000-000000000001';let fixture:SqliteD1;
const settings:VisitStampSettings={mode:'visit',amountUnit:1000,maxPerVisit:10,firstVisitBonus:1,expiryMonths:6,timezone:'Asia/Tokyo',multipliers:[],rankMultipliers:[],rewards:[{id:'coffee',name:'コーヒー',stamps:2}]};
let card:string;
beforeEach(async()=>{fixture=createTestD1();fixture.raw.prepare(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id,login_channel_id) VALUES('shop','試験店','ch','unused','token',?,'login')`).run(tenant);
 fixture.raw.prepare(`INSERT INTO friends(id,line_user_id,line_account_id) VALUES('friend','U-test','shop')`).run();
 fixture.raw.prepare(`INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('staff','店員','admin','unused-key',?)`).run(tenant);
 card=(await saveStampCard(fixture.db,tenant,{name:'来店カード',active:true,settings,accountIds:['shop'],expectedVersion:0})).id;
});
afterEach(()=>fixture.raw.close());
const grant=(id='manual',count=4)=>grantStamps(fixture.db,{cardId:card,friendId:'friend',accountId:'shop',count,reason:'試験の理由',actorId:'staff',requestId:id,kind:'manual'});
describe('来店スタンプの台帳',()=>{
 it('倍率は店の暦で順に計算し、最高ランクと上限を適用する',()=>{
  const s={...settings,mode:'amount' as const,maxPerVisit:20,multipliers:[{multiplier:2,weekdays:[3],startMinute:1080,endMinute:1200}],rankMultipliers:[{tagName:'金',multiplier:1.5},{tagName:'銀',multiplier:1.2}]};
  expect(calculateVisitStamps(s,3000,'2026-10-07T09:00:00Z',true,['金','銀'])).toBe(12);
  expect(calculateVisitStamps(s,20000,'2026-10-07T09:00:00Z',true,['金'])).toBe(20);
  expect(stampExpiry('2026-01-31T10:00:00Z',1)).toBe('2026-02-28T10:00:00.000Z');
 });
 it('同じ手動押印は一度だけ。内容違い・別店舗は拒否し、取消は履歴を残す',async()=>{
  await Promise.all([grant(),grant()]);expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(4);
  await expect(grant('manual',5)).rejects.toThrow('内容');
  const entry=fixture.raw.prepare("SELECT id FROM visit_stamp_entries WHERE kind='manual'").get() as {id:string};
  expect((await reverseStampEntry(fixture.db,entry.id,tenant,'staff','押し間違い')).balance).toBe(0);
  await expect(reverseStampEntry(fixture.db,entry.id,tenant,'staff','再度')).rejects.toThrow('すでに');
  await expect(stampWallet(fixture.db,card,'friend','other')).rejects.toThrow('一致');
 });
 it('期限切れの残高は一度だけ失効し、特典に使えない',async()=>{
  await grant();fixture.raw.prepare("UPDATE visit_stamp_wallets SET expires_at='2000-01-01T00:00:00Z'").run();
  expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(0);await stampWallet(fixture.db,card,'friend','shop');
  expect(fixture.raw.prepare("SELECT COUNT(*) AS n FROM visit_stamp_entries WHERE kind='expire'").get()).toEqual({n:1});
  await expect(offerStampReward(fixture.db,card,'friend','shop','coffee','offer')).rejects.toThrow('足り');
 });
 it('期限切れ後に使用取消で戻った分も再び失効し、再読込では増えない',async()=>{
  await grant();await setStampPin(fixture.db,'shop','staff','1234');
  const offer=await offerStampReward(fixture.db,card,'friend','shop','coffee','before-expiry');
  await useStampReward(fixture.db,offer.id,'friend','shop','staff','1234');
  fixture.raw.exec("UPDATE visit_stamp_wallets SET expires_at='2000-01-01T00:00:00Z'");
  expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(0);
  const entry=fixture.raw.prepare("SELECT id FROM visit_stamp_entries WHERE kind='redeem'").get() as {id:string};
  await reverseStampEntry(fixture.db,entry.id,tenant,'staff','期限後の取消');
  expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(0);
  await stampWallet(fixture.db,card,'friend','shop');
  expect(fixture.raw.prepare("SELECT COUNT(*) n FROM visit_stamp_entries WHERE kind='expire'").get()).toEqual({n:2});
 });
 it('特典は本人だけでは消費できず、PIN認証の同時操作でも1回。取消で戻す',async()=>{
  await grant();await setStampPin(fixture.db,'shop','staff','1234');
  const offer=await offerStampReward(fixture.db,card,'friend','shop','coffee','offer');
  await expect(useStampReward(fixture.db,offer.id,'friend','shop','staff','0000')).rejects.toThrow('違い');
  expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(4);
  const r=await Promise.allSettled([useStampReward(fixture.db,offer.id,'friend','shop','staff','1234'),useStampReward(fixture.db,offer.id,'friend','shop','staff','1234')]);
  expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(2);
  const used=fixture.raw.prepare("SELECT id FROM visit_stamp_entries WHERE kind='redeem'").get() as {id:string};
  expect((await reverseStampEntry(fixture.db,used.id,tenant,'staff','使用取消')).balance).toBe(4);
  await expect(useStampReward(fixture.db,offer.id,'friend','shop','staff','1234')).rejects.toThrow('処理済み');
 });
 it('PINを5回失敗するとロックし、平文を保存しない',async()=>{
  await setStampPin(fixture.db,'shop','staff','1234');
  const stored=fixture.raw.prepare('SELECT hash FROM visit_stamp_staff_pins').get() as {hash:string};expect(stored.hash).not.toContain('1234');
  for(let i=0;i<5;i++)await expect(verifyStampPin(fixture.db,'shop','staff','9999')).rejects.toThrow('違い');
  await expect(verifyStampPin(fixture.db,'shop','staff','1234')).rejects.toMatchObject({status:429});
  fixture.raw.exec("UPDATE visit_stamp_staff_pins SET locked_until='2000-01-01T00:00:00Z'");await verifyStampPin(fixture.db,'shop','staff','1234');
 });
 it('紙カードの審査中・承認済みの二重申請と二重承認を拒否する',async()=>{
  const p=await requestPaperStamps(fixture.db,card,'friend','shop','https://example.test/photo.jpg',3);
  await expect(requestPaperStamps(fixture.db,card,'friend','shop','https://example.test/other.jpg',4)).rejects.toThrow('申請');
  const r=await Promise.allSettled([applyPaperStamps(fixture.db,p.id,tenant,'staff',true,'紙カード確認'),applyPaperStamps(fixture.db,p.id,tenant,'staff',true,'紙カード確認')]);
  expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(3);
 });
 it('カード設定の古い版は保存せず、押せる店舗も変更しない',async()=>{
  const input={name:'新しい名前',settings,accountIds:['shop'],expectedVersion:1,active:true};
  await saveStampCard(fixture.db,tenant,input,card);await expect(saveStampCard(fixture.db,tenant,input,card)).rejects.toThrow('更新');
  expect(fixture.raw.prepare('SELECT COUNT(*) n FROM visit_stamp_card_accounts WHERE card_id=?').get(card)).toEqual({n:1});
 });
 it('手動の贈呈があっても初回来店のボーナスを一度だけ付ける',async()=>{
  await grant('welcome',1);
  fixture.raw.exec("INSERT INTO rt_organizations(id,account_id,name) VALUES('org','shop','試験');INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('store','org','試験','STORE','shop');INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,status,line_uid) VALUES('first','store','walk_in','試験',1,datetime('now'),datetime('now','+1 hour'),'visited','U-test'),('second','store','walk_in','試験',1,datetime('now'),datetime('now','+1 hour'),'visited','U-test')");
  await Promise.all([reconcileStampVisit(fixture.db,'restaurant','first'),reconcileStampVisit(fixture.db,'restaurant','second')]);
  expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(4);
  expect(fixture.raw.prepare("SELECT SUM(delta) n FROM visit_stamp_entries WHERE kind='visit'").get()).toEqual({n:3});
 });
 it('来店・会計・再処理は二重に押さず、取消と再確認が戻る',async()=>{
  fixture.raw.exec("INSERT INTO rt_organizations(id,account_id,name) VALUES('org','shop','試験');INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('store','org','試験','STORE','shop');INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,status,line_uid) VALUES('visit','store','walk_in','試験',1,datetime('now'),datetime('now','+1 hour'),'visited','U-test')");
  await Promise.all([reconcileStampVisit(fixture.db,'restaurant','visit'),reconcileStampVisit(fixture.db,'restaurant','visit')]);
  expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(2);
  fixture.raw.exec("UPDATE rt_reservations SET status='confirmed' WHERE id='visit'");await reconcileStampVisit(fixture.db,'restaurant','visit');expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(0);
  fixture.raw.exec("UPDATE rt_reservations SET status='visited' WHERE id='visit'");await reconcileStampVisit(fixture.db,'restaurant','visit');expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(2);
  await reconcileStampVisit(fixture.db,'restaurant','visit');expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(2);
 });
});

it('マス数は特典個数と別に保存し、停止した倍率・順序・二つの上限を計算する',async()=>{
 const s={...settings,slotCount:30,maxPerVisit:3,maxStackedStamps:20,firstVisitBonus:1,multipliers:[{name:'二倍',multiplier:2,active:true},{name:'休止中',multiplier:10,active:false}]};
 await saveStampCard(fixture.db,tenant,{name:'設定変更',active:true,settings:s,accountIds:['shop'],expectedVersion:1},card);
 expect(calculateVisitStamps(s,0,'2026-10-07T09:00:00Z',true,[])).toBe(4);
 expect(calculateVisitStamps({...s,stackingOrder:'multipliers_then_bonus'},0,'2026-10-07T09:00:00Z',true,[])).toBe(3);
 expect(calculateVisitStamps({...s,mode:'amount'},10000,'2026-10-07T09:00:00Z',false,[])).toBe(6);
 expect(calculateVisitStamps({...s,maxStackedStamps:5,mode:'amount'},10000,'2026-10-07T09:00:00Z',false,[])).toBe(5);
 await expect(saveStampCard(fixture.db,tenant,{name:'不正',active:true,settings:{...s,slotCount:0},accountIds:['shop'],expectedVersion:2},card)).rejects.toThrow('マス');
});
it('PINだけで有効な店員を特定し、スタッフ名を返して必要な個数だけ減らす',async()=>{
 await grant();await setStampPin(fixture.db,'shop','staff','1234');const offer=await offerStampReward(fixture.db,card,'friend','shop','coffee','pin-only');
 expect(await useStampReward(fixture.db,offer.id,'friend','shop',null,'1234')).toEqual({id:offer.id,status:'used',staffId:'staff',staffName:'店員'});
 expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(2);
 await expect(useStampReward(fixture.db,offer.id,'friend','shop',null,'1234')).rejects.toMatchObject({status:409});
});
it('PINだけの試行も5回で店全体を15分ロックし、別の店員の番号でも回避できない',async()=>{
 const {identifyStampStaff}=await import('./visit-stamps.js');await setStampPin(fixture.db,'shop','staff','1234');
 for(let i=0;i<5;i++)await expect(identifyStampStaff(fixture.db,'shop','9999')).rejects.toMatchObject({status:403});
 await expect(identifyStampStaff(fixture.db,'shop','1234')).rejects.toMatchObject({status:429});
 fixture.raw.exec("UPDATE visit_stamp_pin_attempts SET locked_until=datetime('now','-1 minute')");
 expect((await identifyStampStaff(fixture.db,'shop','1234')).name).toBe('店員');
 fixture.raw.exec("UPDATE staff_members SET is_active=0 WHERE id='staff'");await expect(identifyStampStaff(fixture.db,'shop','1234')).rejects.toMatchObject({status:403});
});
it('予約がオフでも来店スタンプの鍵がオンなら自動押印でき、専用鍵がオフなら止まる',async()=>{
 fixture.raw.exec("INSERT INTO rt_organizations(id,account_id,name) VALUES('org','shop','店');INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('store','org','店','test','shop');INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,status,line_uid) VALUES('independent','store','walk_in','試験',1,datetime('now'),datetime('now','+1 hour'),'visited','U-test');INSERT INTO account_settings(line_account_id,key,value) VALUES('shop','feature.booking','false')");
 await reconcileStampVisit(fixture.db,'restaurant','independent');expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(2);
 fixture.raw.exec("INSERT INTO account_settings(line_account_id,key,value) VALUES('shop','feature.visit_stamps','false');INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,status,line_uid) VALUES('stopped','store','walk_in','試験',1,datetime('now'),datetime('now','+1 hour'),'visited','U-test')");
 await reconcileStampVisit(fixture.db,'restaurant','stopped');expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(2);
});
