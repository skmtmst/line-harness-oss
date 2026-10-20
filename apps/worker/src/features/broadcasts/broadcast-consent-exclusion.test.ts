import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { processBroadcastSend, processQueuedBroadcasts, processScheduledBroadcasts, guardScheduledBroadcastQuota } from './broadcast.js';
import { prepareHqBroadcast, dispatchHqBroadcast, preflightHqBroadcast } from '../../services/hq-broadcasts.js';
import { countAudience, previewAudience } from './broadcast-preflight.js';

const calls = vi.hoisted(() => ({ broadcast: vi.fn(async () => ({ requestId: 'all' })),
  multicast: vi.fn(async (_ids: string[], _messages: unknown) => ({ requestId: 'selected' })),
  pushMessageWithRequestId: vi.fn(async (_id: string, _messages: unknown) => ({ requestId: 'personal' })) }));
vi.mock('@line-crm/line-sdk', async original => ({ ...await original<Record<string, unknown>>(), LineClient: class {
  broadcast = calls.broadcast; multicast = calls.multicast; pushMessageWithRequestId = calls.pushMessageWithRequestId;
} }));
vi.mock('../../services/stealth.js', async original => ({ ...await original<Record<string, unknown>>(), sleep: async () => {}, calculateStaggerDelay: () => 0 }));
let f: SqliteD1;
const tenant = '00000000-0000-4000-8000-000000000001';
function consent(id: string, state = 'revoked', purpose = 'marketing') {
  f.raw.prepare(`INSERT INTO friend_delivery_consents(line_account_id,friend_id,purpose,state,reason,source)
    SELECT line_account_id,id,?,?, '本人希望','manual' FROM friends WHERE id=?`).run(purpose,state,id);
}
function seedBroadcast(status = 'draft', personalized = false) {
  f.raw.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status,track_links,line_account_id,scheduled_at)
    VALUES('b','確認','text',?,'all',?,0,'shop','2000-01-01T00:00:00Z')`).run(personalized ? '{{name}} さん' : 'お知らせ',status);
}
function row() { return f.raw.prepare("SELECT status,success_count,total_count,stopped_at FROM broadcasts WHERE id='b'").get(); }
function sentIds() { return calls.multicast.mock.calls.flatMap(c => c[0]).concat(calls.pushMessageWithRequestId.mock.calls.map(c => c[0])); }
beforeEach(() => {
  f = createTestD1(); vi.clearAllMocks();
  for (const account of ['shop','other']) {
    f.raw.prepare(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id) VALUES(?,?,?,'unused','fake',?)`).run(account,account,account,tenant);
  }
  for (const [id, account] of [['allowed','shop'],['stopped','shop'],['unknown','shop'],['other-friend','other']])
    f.raw.prepare('INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES(?,?,?,?)').run(id,'U-'+id,id,account);
  f.raw.prepare(`INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','管理者','owner','fake',?)`).run(tenant);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({type:'limited',value:1000,totalUsage:0}),{status:200})));
});
afterEach(() => { f.raw.close(); vi.unstubAllGlobals(); });
describe('637: 停止者を外して一斉配信を続ける', () => {
  it.each([false,true])('即時・名前差し込み=%s: 全員の指定を保ち、停止/不明だけ除き、再実行でも重複しない', async personalized => {
    consent('stopped');consent('stopped','unknown','news');consent('unknown','unknown');
    f.raw.exec("UPDATE friends SET display_name=NULL WHERE id='stopped'");
    seedBroadcast('draft',personalized);
    const client = calls as never;
    expect(await processBroadcastSend(f.db,client,'b')).toMatchObject({status:'sending',target_type:'all'});
    await processQueuedBroadcasts(f.db,client);await processQueuedBroadcasts(f.db,client);
    expect(calls.broadcast).not.toHaveBeenCalled();expect(sentIds()).toEqual(['U-allowed']);
    expect(row()).toMatchObject({status:'sent',success_count:1});
    expect(f.raw.prepare("SELECT friend_id,state,error_code FROM broadcast_send_claims WHERE error_code='delivery_consent_suppressed' ORDER BY friend_id").all())
      .toEqual([{friend_id:'stopped',state:'failed',error_code:'delivery_consent_suppressed'},{friend_id:'unknown',state:'failed',error_code:'delivery_consent_suppressed'}]);
  });
  it('予約の全員配信も停止者を外して完了する',async()=>{
    consent('stopped');consent('unknown','unknown');seedBroadcast('scheduled');
    await processScheduledBroadcasts(f.db,calls as never);await processQueuedBroadcasts(f.db,calls as never);
    expect(calls.broadcast).not.toHaveBeenCalled();expect(sentIds()).toEqual(['U-allowed']);expect(row()).toMatchObject({status:'sent',success_count:1});
  });
  it('停止者が全員なら外部に送らず完了する',async()=>{
    for(const id of ['allowed','stopped','unknown'])consent(id);
    seedBroadcast();await processBroadcastSend(f.db,calls as never,'b');await processQueuedBroadcasts(f.db,calls as never);
    expect(sentIds()).toEqual([]);expect(calls.broadcast).not.toHaveBeenCalled();expect(row()).toMatchObject({status:'sent',success_count:0});
  });
  it.each(['none','granted','other-account'])('対象店の停止者なし(%s)なら従来のLINE全員配信を維持する',async mode=>{
    if(mode==='granted')consent('stopped','granted');if(mode==='other-account')consent('other-friend');
    seedBroadcast();await processBroadcastSend(f.db,calls as never,'b');
    expect(calls.broadcast).toHaveBeenCalledTimes(1);expect(sentIds()).toEqual([]);expect(row()).toMatchObject({status:'sent'});
  });
  it('確認は目的数でなく人数を数え、停止者を見本と送信枠から除く',async()=>{
    consent('stopped');consent('stopped','unknown','news');consent('unknown','unknown');consent('other-friend');
    const input={targetType:'all',lineAccountId:'shop'};
    expect(await countAudience(f.db,input)).toMatchObject({total:1});
    const preview=await previewAudience(f.db,input);
    expect(preview).toMatchObject({matched:3,sendable:1,exclusions:{paused:2,total:2}});
    expect(preview.representatives.map(r=>r.friendId)).toEqual(['allowed']);
    seedBroadcast();vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({type:'limited',value:1,totalUsage:0}))));
    const broadcast=f.raw.prepare("SELECT * FROM broadcasts WHERE id='b'").get();
    expect(await guardScheduledBroadcastQuota(f.db,broadcast as never,'shop')).toEqual({blocked:false});
  });
  it('開始後に停止を追加しても、次の束では送らず残りを続ける',async()=>{
    consent('stopped');seedBroadcast('draft',true);
    for(let i=0;i<155;i++)f.raw.prepare('INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES(?,?,?,\'shop\')').run('a'+String(i).padStart(3,'0'),'Ua'+i,'名前');
    await processBroadcastSend(f.db,calls as never,'b');await processQueuedBroadcasts(f.db,calls as never);
    expect(sentIds()).toHaveLength(150);consent('allowed');
    await processQueuedBroadcasts(f.db,calls as never);
    expect(sentIds()).not.toContain('U-allowed');expect(new Set(sentIds()).size).toBe(sentIds().length);expect(row()).toMatchObject({status:'sent'});
  });
  it('全員が配信停止の店は0人として完了し、別の店の配信を止めない',async()=>{
    for(const id of ['allowed','stopped','unknown'])consent(id);
    const run=await prepareHqBroadcast(f.db,tenant,'owner',{requestId:'hq-zero',title:'一括配信',messageType:'text',messageContent:'お知らせ',accountIds:['shop','other'],accountTagIds:[],excludedAccountIds:[],audience:{kind:'all'},scheduledAt:null});
    expect((await preflightHqBroadcast(f.db,run)).find(p=>p.accountId==='shop')).toMatchObject({audienceCount:0,consentExcluded:3,blockedReasons:[]});
    await dispatchHqBroadcast(f.db,run,'owner',1);await processScheduledBroadcasts(f.db,calls as never);await processQueuedBroadcasts(f.db,calls as never);
    expect(sentIds()).toEqual(['U-other-friend']);
    expect(f.raw.prepare("SELECT status,success_count FROM broadcasts WHERE line_account_id='shop'").get()).toEqual({status:'sent',success_count:0});
    const {readHqBroadcastResult}=await import('../../services/hq-broadcasts.js');
    const result=await readHqBroadcastResult(f.db,run);
    expect(result.targets.find(t=>t.accountId==='shop')?.failureReasons).toEqual([{code:'consent_excluded',label:'配信を止めているため送りませんでした',count:3,retryable:false}]);
  });
  it('統括の全員指定も店別に人数と警告を返し、停止者がいる店を除外せず送れる',async()=>{
    consent('stopped');consent('unknown','unknown');
    const run=await prepareHqBroadcast(f.db,tenant,'owner',{requestId:'hq-consent',title:'一括配信',messageType:'text',messageContent:'お知らせ',accountIds:['shop','other'],accountTagIds:[],excludedAccountIds:[],audience:{kind:'all'},scheduledAt:null});
    const check=await preflightHqBroadcast(f.db,run);
    expect(check.find(p=>p.accountId==='shop')).toMatchObject({audienceCount:1,consentExcluded:2,blockedReasons:[],warnings:['配信を止めている 2 人には送りません。']});
    expect(check.find(p=>p.accountId==='other')).toMatchObject({audienceCount:1,consentExcluded:0,blockedReasons:[]});
    await dispatchHqBroadcast(f.db,run,'owner',1);
    await processScheduledBroadcasts(f.db,calls as never);await processQueuedBroadcasts(f.db,calls as never);
    expect(sentIds().sort()).toEqual(['U-allowed','U-other-friend']);expect(calls.broadcast).not.toHaveBeenCalled();
    expect(f.raw.prepare("SELECT status,success_count FROM broadcasts ORDER BY line_account_id").all()).toEqual([{status:'sent',success_count:1},{status:'sent',success_count:1}]);
  });
});
