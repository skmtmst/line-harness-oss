import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { VisitStampSettings } from '@line-crm/shared';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { saveStampCard, readStampCard, stampCard, stampWallet, grantStamps, requestPaperStamps, applyPaperStamps, setStampPin, offerStampReward, useStampReward, reverseStampEntry } from './visit-stamps.js';
import { processVisitStampReminders, stampReminderAt } from './visit-stamp-reminders.js';

const tenant='00000000-0000-4000-8000-000000000001';
const base:VisitStampSettings={mode:'visit',amountUnit:1000,maxPerVisit:10,firstVisitBonus:1,expiryMonths:6,timezone:'Asia/Tokyo',multipliers:[],rankMultipliers:[],rewards:[{id:'goal',name:'ゴール',stamps:10}]};
let fixture:SqliteD1,card:string;
beforeEach(async()=>{
  fixture=createTestD1({foreignKeys:true});
  fixture.raw.prepare(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id,login_channel_id) VALUES('shop','店','ch','unused','token',?,'login')`).run(tenant);
  fixture.raw.exec(`INSERT INTO friends(id,line_user_id,line_account_id) VALUES('friend','U-test','shop')`);
  fixture.raw.prepare(`INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('staff','店員','admin','unused-key',?)`).run(tenant);
  card=(await saveStampCard(fixture.db,tenant,{name:'来店カード',active:true,settings:base,accountIds:['shop'],expectedVersion:0})).id;
});
afterEach(()=>fixture.raw.close());
const configure=async(settings:VisitStampSettings)=>saveStampCard(fixture.db,tenant,{name:'来店カード',active:true,settings,accountIds:['shop'],expectedVersion:(await stampCard(fixture.db,card)).version},card);
const grant=(requestId:string,at:string,kind:'manual'|'visit'|'paper'='manual',count=1)=>grantStamps(fixture.db,{cardId:card,friendId:'friend',accountId:'shop',requestId,kind,at,count,reason:'試験',actorId:kind==='manual'?'staff':null,visitKey:kind==='visit'?requestId:undefined});

describe('ショップカード G-1',()=>{
  it('新しい設定を保存して読み、古いカードには新しい制限を加えない',async()=>{
    const settings:VisitStampSettings={...base,backgroundColor:'#7b4a2e',backgroundImageUrl:'https://example.test/images/card.png',expiryBasis:'first_visit',expiryReminder:'week_before',completion:'repeat',instructions:'説明\n次の行',receiptBonus:2,stampInterval:{mode:'hours',hours:3}};
    await configure(settings);
    expect((await readStampCard(fixture.db,await stampCard(fixture.db,card))).settings).toMatchObject(settings);
    await configure(base);
    await grant('old1','2027-01-01T00:00:00Z');await grant('old2','2027-01-01T00:00:00Z');
    expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(2);
    for(const bad of [{receiptBonus:51},{instructions:'あ'.repeat(501)},{stampInterval:{mode:'hours',hours:24}},{backgroundColor:'red'},{expiryBasis:'first_visit',expiryMonths:null}])
      await expect(configure({...base,...bad} as VisitStampSettings)).rejects.toMatchObject({status:400});
  });
  it.each(['last_visit','first_visit'] as const)('期限の起点 %s は手入力でも最初の押印から正しく計算する',async expiryBasis=>{
    await configure({...base,expiryBasis,expiryMonths:1,receiptBonus:2});
    expect((await stampWallet(fixture.db,card,'friend','shop')).expiresAt).toBeNull();
    await grant('first','2027-01-31T10:00:00Z');await grant('second','2027-02-10T10:00:00Z');
    expect((await stampWallet(fixture.db,card,'friend','shop')).expiresAt).toBe(expiryBasis==='first_visit'?'2027-02-28T10:00:00.000Z':'2027-03-10T10:00:00.000Z');
  });
  it('最初からの期限は同時押印でも伸びず、紙の承認も同じ期限を維持する',async()=>{
    await configure({...base,expiryBasis:'first_visit',expiryMonths:1});
    await Promise.all([grant('first','2027-01-01T00:00:00Z'),grant('second','2027-01-02T00:00:00Z')]);
    const paper=await requestPaperStamps(fixture.db,card,'friend','shop','https://example.test/photo.jpg',3);
    await applyPaperStamps(fixture.db,paper.id,tenant,'staff',true,'確認');
    expect((await stampWallet(fixture.db,card,'friend','shop')).expiresAt).toBe('2027-02-01T00:00:00.000Z');
  });
  it('設定しない期限は長さが残っていても使わない',async()=>{
    await grant('one','2027-01-01T00:00:00Z');await configure({...base,expiryBasis:'none'});
    expect((await stampWallet(fixture.db,card,'friend','shop')).expiresAt).toBeNull();
  });
  it('保存で期限の起点を変更すると、既存の財布も最初の押印から数え直す',async()=>{
    await grant('first','2027-01-01T00:00:00Z');await grant('last','2027-02-01T00:00:00Z');
    await configure({...base,expiryMonths:6,expiryBasis:'first_visit'});
    expect((await stampWallet(fixture.db,card,'friend','shop')).expiresAt).toBe('2027-07-01T00:00:00.000Z');
  });
  it.each(['first_visit','last_visit'] as const)('新設定 %s の月数は日本の日付で数える（UTCでは前月の末日）',async expiryBasis=>{
    await configure({...base,expiryBasis,expiryMonths:1});
    await grant('jst-midnight','2027-01-31T15:30:00Z');
    expect((await stampWallet(fixture.db,card,'friend','shop')).expiresAt).toBe('2027-02-28T15:30:00.000Z');
  });
  it.each(['manual','visit'] as const)('同じ日は1回：%s は日本時間の0時で戻り、QR相当と手入力をまたいで制限する',async kind=>{
    await configure({...base,stampInterval:{mode:'same_day'}});
    await grant('one','2027-01-01T14:59:00Z',kind);
    await expect(grant('blocked','2027-01-01T14:59:30Z',kind==='manual'?'visit':'manual')).rejects.toThrow('同じ日');
    await grant('next','2027-01-01T15:00:00Z',kind);
    expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(2);
    await grant('next','2027-01-01T15:00:00Z',kind); // 成功の再送は制限に引っかけない
  });
  it.each(['manual','visit'] as const)('N時間：%s はちょうど3時間で許可し、同時押印は一つだけ',async kind=>{
    await configure({...base,stampInterval:{mode:'hours',hours:3}});
    await grant('one','2027-01-01T00:00:00Z',kind);
    await expect(grant('early','2027-01-01T02:59:59Z',kind==='manual'?'visit':'manual')).rejects.toThrow('3時間');
    const results=await Promise.allSettled([grant('a','2027-01-01T03:00:00Z',kind),grant('b','2027-01-01T03:00:00Z',kind)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  });
  it('紙の移行と取消は制限から除外し、受け取りも来店の間隔に含めない',async()=>{
    await configure({...base,receiptBonus:1,stampInterval:{mode:'same_day'}});
    await grant('one','2027-01-01T00:00:00Z');await grant('paper','2027-01-01T00:00:00Z','paper',3);
    const row=fixture.raw.prepare("SELECT id FROM visit_stamp_entries WHERE idempotency_key='one'").get() as {id:string};
    await reverseStampEntry(fixture.db,row.id,tenant,'staff','取り消し');await grant('replacement','2027-01-01T00:00:00Z');
    expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(5);
  });
  it('受け取りボーナスは同時初回読取でも1回だけ、後から設定して既存の財布に足さない',async()=>{
    await configure({...base,receiptBonus:2});
    const wallets=await Promise.all([stampWallet(fixture.db,card,'friend','shop'),stampWallet(fixture.db,card,'friend','shop')]);
    expect(wallets.every(w=>w.balance===2&&w.earnedTotal===2&&w.expiresAt===null)).toBe(true);
    await configure({...base,receiptBonus:5});expect((await stampWallet(fixture.db,card,'friend','shop')).balance).toBe(2);
    expect(fixture.raw.prepare("SELECT COUNT(*) n FROM visit_stamp_entries WHERE reason='受け取りボーナス'").get()).toEqual({n:1});
    expect(fixture.raw.prepare('SELECT visit_count FROM visit_stamp_wallets').get()).toEqual({visit_count:0});
  });
  it('ランクアップはゴール特典の使用時だけ次の財布を作り、次の受け取りボーナスも1回だけ',async()=>{
    const next=await saveStampCard(fixture.db,tenant,{name:'ゴールド',active:true,settings:{...base,receiptBonus:3},accountIds:['shop'],expectedVersion:0});
    await configure({...base,completion:'next_card',nextCardId:next.id,rewards:[{id:'mid',name:'途中',stamps:2},...base.rewards]});
    await expect(stampWallet(fixture.db,next.id,'friend','shop')).rejects.toThrow('ゴール');
    await grant('full','2027-01-01T00:00:00Z','manual',12);await setStampPin(fixture.db,'shop','staff','1234');
    const mid=await offerStampReward(fixture.db,card,'friend','shop','mid','mid');await useStampReward(fixture.db,mid.id,'friend','shop','staff','1234');
    expect(fixture.raw.prepare('SELECT 1 FROM visit_stamp_wallets WHERE card_id=?').get(next.id)).toBeUndefined();
    const goal=await offerStampReward(fixture.db,card,'friend','shop','goal','goal');
    expect(fixture.raw.prepare('SELECT 1 FROM visit_stamp_wallets WHERE card_id=?').get(next.id)).toBeUndefined();
    const results=await Promise.allSettled([useStampReward(fixture.db,goal.id,'friend','shop','staff','1234'),useStampReward(fixture.db,goal.id,'friend','shop','staff','1234')]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((await stampWallet(fixture.db,next.id,'friend','shop')).balance).toBe(3);
  });
  it('次のカードは同じ店舗・同じ会社・別カードだけで循環を拒む',async()=>{
    await expect(configure({...base,completion:'next_card',nextCardId:card})).rejects.toThrow('別');
    const next=await saveStampCard(fixture.db,tenant,{name:'次',active:true,settings:base,accountIds:['shop'],expectedVersion:0});
    await configure({...base,completion:'next_card',nextCardId:next.id});
    await expect(saveStampCard(fixture.db,tenant,{name:'次',active:true,settings:{...base,completion:'next_card',nextCardId:card},accountIds:['shop'],expectedVersion:1},next.id)).rejects.toThrow('循環');
  });
});

describe('期限のLINE自動通知',()=>{
  const now=new Date('2027-01-24T00:00:00Z');
  const setup=async()=>{await configure({...base,expiryReminder:'week_before'});await grant('one','2026-07-31T00:00:00Z');};
  const options=(proxyDispatch:(request:Request)=>Promise<Response>)=>({now,proxyBaseUrl:'https://proxy.example.test',proxyDispatch});
  it('すべての通知の時刻を計算し、1か月前は暦の月を使う',()=>{
    const expiry='2027-03-31T00:00:00Z';
    expect(stampReminderAt(expiry,'month_before')).toBe('2027-02-28T00:00:00.000Z');
    expect(stampReminderAt(expiry,'day_before')).toBe('2027-03-30T00:00:00.000Z');
    expect(stampReminderAt(expiry,'three_days_before')).toBe('2027-03-28T00:00:00.000Z');
    expect(stampReminderAt(expiry,'two_weeks_before')).toBe('2027-03-17T00:00:00.000Z');
    expect(stampReminderAt(expiry,'none')).toBeNull();
  });
  it.each(['day_before','three_days_before','week_before','two_weeks_before','month_before'] as const)('%s はその時刻からだけ送信し、再実行でも重複しない',async expiryReminder=>{
    await configure({...base,expiryReminder});await grant('received','2026-09-30T00:00:00Z');
    const expiry='2027-03-31T00:00:00.000Z';
    fixture.raw.prepare('UPDATE visit_stamp_wallets SET expires_at=?').run(expiry);
    const due=new Date(stampReminderAt(expiry,expiryReminder)!);
    const dispatch=vi.fn(async()=>new Response('{}',{status:200}));
    await processVisitStampReminders(fixture.db,{...options(dispatch),now:new Date(due.getTime()-1)});expect(dispatch).not.toHaveBeenCalled();
    await processVisitStampReminders(fixture.db,{...options(dispatch),now:due});expect(dispatch).toHaveBeenCalledOnce();
    await processVisitStampReminders(fixture.db,{...options(dispatch),now:due});expect(dispatch).toHaveBeenCalledOnce();
  });
  it('同じ期限は同時cron・再処理でも1回だけ、manualを付けずカード名・日付を送る',async()=>{
    await setup();const dispatch=vi.fn(async(request:Request)=>{
      expect(request.headers.get('X-Line-Harness-Source')).toBeNull();expect(request.headers.get('X-Line-Harness-Capability')).toBe('reminder_dispatch');
      expect(request.headers.get('X-Line-Retry-Key')).toMatch(/^[a-f0-9-]{36}$/);
      const body=await request.json() as {messages:Array<{text:string}>};expect(body.messages[0].text).toContain('来店カード');expect(body.messages[0].text).toContain('2027年1月31日');
      return new Response('{}',{status:200});
    });
    await Promise.all([processVisitStampReminders(fixture.db,options(dispatch)),processVisitStampReminders(fixture.db,options(dispatch))]);
    await processVisitStampReminders(fixture.db,options(dispatch));expect(dispatch).toHaveBeenCalledOnce();
  });
  it('失敗は同じ再試行キーで再送し、期限が伸びると古い通知を送らない',async()=>{
    await setup();const keys:string[]=[];const dispatch=vi.fn(async(request:Request)=>{keys.push(request.headers.get('X-Line-Retry-Key')!);return new Response('{}',{status:keys.length===1?503:200});});
    await processVisitStampReminders(fixture.db,options(dispatch));
    await processVisitStampReminders(fixture.db,{...options(dispatch),now:new Date(now.getTime()+60_001)});
    expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
    await grant('extend','2027-01-24T00:00:00Z');await processVisitStampReminders(fixture.db,options(dispatch));expect(dispatch).toHaveBeenCalledTimes(2);
  });
  it('通知なし・機能停止・ブロック・期限切れの財布には送らない',async()=>{
    await setup();const dispatch=vi.fn(async()=>new Response('{}',{status:200}));
    fixture.raw.exec("INSERT INTO account_settings(line_account_id,key,value) VALUES('shop','feature.visit_stamps','false')");
    await processVisitStampReminders(fixture.db,options(dispatch));expect(dispatch).not.toHaveBeenCalled();
    fixture.raw.exec("DELETE FROM account_settings WHERE key='feature.visit_stamps';UPDATE friends SET is_following=0");
    await processVisitStampReminders(fixture.db,options(dispatch));expect(dispatch).not.toHaveBeenCalled();
    fixture.raw.exec('UPDATE friends SET is_following=1');await configure({...base,expiryReminder:'none'});
    await processVisitStampReminders(fixture.db,options(dispatch));expect(dispatch).not.toHaveBeenCalled();
    await configure({...base,expiryReminder:'week_before'});
    await processVisitStampReminders(fixture.db,{...options(dispatch),now:new Date('2027-02-01T00:00:00Z')});expect(dispatch).not.toHaveBeenCalled();
  });
});
