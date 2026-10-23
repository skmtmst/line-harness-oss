import { afterEach, expect, it, vi } from 'vitest';
import { createTestD1, insertFriend } from '../../test-utils/d1-sqlite.js';
import { getQueuedBroadcasts, advanceBroadcastDispatchCursor } from '@line-crm/db/src/broadcasts/index.js';
import { processQueuedBroadcasts, processScheduledBroadcasts } from './broadcast.js';
import { sweepBroadcastAfterActions } from './broadcast-after-actions.js';

const wire = vi.hoisted(() => ({ sends: [] as string[], rejectToken: '', hook: undefined as (() => Promise<void>) | undefined }));
vi.mock('@line-crm/line-sdk', async original => ({
  ...await original<Record<string, unknown>>(),
  LineClient: class {
    constructor(private token: string) {}
    async multicast(ids: string[]) {
      if (this.token === wire.rejectToken) throw Object.assign(new Error('synthetic rejection'), { status: 429 });
      wire.sends.push(...ids); await wire.hook?.(); return { requestId: 'synthetic' };
    }
    async pushMessageWithRequestId(id: string) {
      if (this.token === wire.rejectToken) throw Object.assign(new Error('synthetic rejection'), { status: 429 });
      wire.sends.push(id); await wire.hook?.(); return { requestId: 'synthetic' };
    }
  },
}));
vi.mock('../../services/stealth.js', async original => ({ ...await original<Record<string, unknown>>(), sleep: async () => {} }));
const opened: ReturnType<typeof createTestD1>[] = [];
const fallback = {} as import('@line-crm/line-sdk').LineClient;
afterEach(() => { opened.splice(0).forEach(f => f.raw.close()); wire.sends = []; wire.rejectToken = ''; wire.hook = undefined; vi.unstubAllGlobals(); });
function fixture() { const f=createTestD1(); opened.push(f); return f; }
function account(f: ReturnType<typeof fixture>, id: string) {
  f.raw.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret) VALUES(?,?,?,?,?)").run(id,id,id,id,'synthetic');
}
function broadcast(f: ReturnType<typeof fixture>, id: string, accountId: string, personalized=false) {
  f.raw.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,segment_conditions,status,batch_offset,track_links,line_account_id)
    VALUES(?,?,'text',?,'segment',?,'sending',0,0,?)`).run(id,id,personalized?'{{name}} さん':'合成配信',JSON.stringify({operator:'AND',rules:[{type:'is_following',value:true}]}),accountId);
}

it('5,000店舗の待機配信を有限に読み、店と同じ店の配信を巡回する', async () => {
  const f=fixture();
  f.raw.transaction(() => { for(let i=0;i<5000;i++) { const id=`a${String(i).padStart(4,'0')}`; account(f,id); broadcast(f,`b${id}`,id); } })();
  broadcast(f,'zz-second','a0000');
  const first=await getQueuedBroadcasts(f.db);
  expect(first).toHaveLength(20);
  expect(new Set(first.map(row=>row.line_account_id)).size).toBe(20);
  await advanceBroadcastDispatchCursor(f.db,first[0]);
  expect((await getQueuedBroadcasts(f.db))[0].line_account_id).toBe('a0001');
  expect((await getQueuedBroadcasts(f.db,{accountId:'a0000'})).map(row=>row.id)).toEqual(['zz-second']);
  expect(await getQueuedBroadcasts(f.db,{accountId:'missing'})).toEqual([]);
});

it('10万宛先でも150行以内を読み、SQLと送信の予算内で継続を残す', async () => {
  const f=fixture(); account(f,'large'); broadcast(f,'b','large');
  const add=f.raw.prepare("INSERT INTO friends(id,line_user_id,line_account_id,display_name,is_following) VALUES(?,?,'large','合成',1)");
  f.raw.transaction(() => { for(let i=0;i<100000;i++) add.run(`f${String(i).padStart(6,'0')}`,`U${i}`); })();
  let largestResult=0;
  const observed=new Proxy(f.db,{get(target,key) {
    if(key!=='prepare') {const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}
    const wrap=(st:D1PreparedStatement):D1PreparedStatement=>new Proxy(st,{get(statement,method) {
      if(method==='bind')return(...args:unknown[])=>wrap(statement.bind(...args));
      if(method==='all')return async()=>{const result=await statement.all();largestResult=Math.max(largestResult,result.results.length);return result;};
      const value=Reflect.get(statement,method);return typeof value==='function'?value.bind(statement):value;
    }});
    return(sql:string)=>wrap(target.prepare(sql));
  }});
  const result=await processQueuedBroadcasts(observed,fallback,undefined,{accountId:'large',maxRecipients:25});
  expect(wire.sends).toHaveLength(25);
  expect(result).toMatchObject({recipients:25,acceptedRecipients:25,retryDeferred:false,hasMore:true});
  expect(result.sqlStatements).toBeLessThan(800);
  expect(result.lineRequests).toBeLessThanOrEqual(2);
  expect(largestResult).toBeLessThanOrEqual(150);
  expect(f.raw.prepare("SELECT COUNT(*) n FROM broadcast_send_claims WHERE broadcast_id='b'").get()).toEqual({n:100000});
  expect(f.raw.prepare("SELECT batch_offset,status FROM broadcasts WHERE id='b'").get()).toEqual({batch_offset:25,status:'sending'});
}, 15_000);

it('大口が枠を使い切っても次回は別店へ進み、accountId指定では他店へ送らない',async()=>{
  const f=fixture();for(const id of ['a','b']){account(f,id);broadcast(f,id,id);for(let i=0;i<3;i++)insertFriend(f.raw,`${id}${i}`,{line_account_id:id});}
  await processQueuedBroadcasts(f.db,fallback,undefined,{maxRecipients:1});
  expect(wire.sends).toEqual(['Ua0']);
  await processQueuedBroadcasts(f.db,fallback,undefined,{maxRecipients:1});
  expect(wire.sends).toEqual(['Ua0','Ub0']);
  await processQueuedBroadcasts(f.db,fallback,undefined,{accountId:'a',maxRecipients:1});
  expect(wire.sends).toEqual(['Ua0','Ub0','Ua1']);
});

it('一つの店が拒否されても同じ実行内で別店が進み、再開で既送を重複しない',async()=>{
  const f=fixture();for(const id of ['a','b']){account(f,id);broadcast(f,id,id);insertFriend(f.raw,id,{line_account_id:id});}
  wire.rejectToken='a';
  const failed=await processQueuedBroadcasts(f.db,fallback);
  expect(wire.sends).toEqual(['Ub']);expect(failed.hasMore).toBe(true);
  expect(failed).toMatchObject({recipients:2,acceptedRecipients:1,retryDeferred:true});
  wire.rejectToken='';
  const resumed=await processQueuedBroadcasts(f.db,fallback);
  expect(wire.sends).toEqual(['Ub','Ua']);expect(resumed.hasMore).toBe(false);
});

it.each([false,true])('429は全部拒否でも一部成功後でも即時継続を抑える（差込=%s）',async personalized=>{
  const f=fixture();account(f,'a');broadcast(f,'b','a',personalized);
  for(let i=0;i<110;i++)insertFriend(f.raw,`f${String(i).padStart(3,'0')}`,{line_account_id:'a'});
  wire.rejectToken='a';
  const rejected=await processQueuedBroadcasts(f.db,fallback,undefined,{accountId:'a'});
  expect(rejected).toMatchObject({acceptedRecipients:0,retryDeferred:true,hasMore:true});
  expect(rejected.lineRequests).toBe(1);
  wire.rejectToken='';
  wire.hook=async()=>{wire.rejectToken='a';};
  const partial=await processQueuedBroadcasts(f.db,fallback,undefined,{accountId:'a'});
  expect(partial).toMatchObject({acceptedRecipients:personalized?1:100,retryDeferred:true,hasMore:true});
  expect(partial.lineRequests).toBe(2);
  expect(new Set(wire.sends).size).toBe(partial.acceptedRecipients);
});

it('差込の束をまたいでも排他を保持し、別実行が同じ配信を拾わない',async()=>{
  const f=fixture();account(f,'a');broadcast(f,'b','a',true);
  for(let i=0;i<30;i++)insertFriend(f.raw,`f${String(i).padStart(2,'0')}`,{line_account_id:'a'});
  let concurrent=0;
  wire.hook=async()=>{if(wire.sends.length===11){concurrent++;expect(await getQueuedBroadcasts(f.db,{accountId:'a'})).toEqual([]);}};
  await processQueuedBroadcasts(f.db,fallback,undefined,{accountId:'a'});
  expect(concurrent).toBe(1);expect(new Set(wire.sends).size).toBe(30);
});

it('受理済みの送信後動作を定期回収へ引継ぎ、二重実行しない',async()=>{
  const f=fixture();account(f,'a');broadcast(f,'b','a');insertFriend(f.raw,'friend',{line_account_id:'a'});
  f.raw.exec(`INSERT INTO tags(id,name,line_account_id) VALUES('done','完了','a');
    INSERT INTO common_actions(id,line_account_id,name,status) VALUES('ca','a','合成','published');
    INSERT INTO common_action_versions(id,common_action_id,version_number,status,action_config)
      VALUES('v','ca',1,'published','[{"id":"tag","type":"add_tag","params":{"tagId":"done"},"onFailure":"continue"}]');
    UPDATE broadcasts SET after_action_version_id='v' WHERE id='b';`);
  await processQueuedBroadcasts(f.db,fallback,undefined,{accountId:'a'});
  expect(wire.sends).toEqual(['Ufriend']);
  expect(f.raw.prepare("SELECT COUNT(*) n FROM friend_tags WHERE tag_id='done'").get()).toEqual({n:0});
  expect((await sweepBroadcastAfterActions(f.db)).done).toBe(1);
  expect((await sweepBroadcastAfterActions(f.db)).done).toBe(0);
  expect(f.raw.prepare("SELECT COUNT(*) n FROM friend_tags WHERE tag_id='done'").get()).toEqual({n:1});
});

it.each([false,true])('壊れた他社資格情報が正常店の予約開始を止めない（失敗店の予約あり=%s）',async includeBrokenReservation=>{
  const f=fixture();for(const id of ['broken','healthy'])account(f,id);
  f.raw.exec("UPDATE line_accounts SET channel_access_token='',channel_access_token_encrypted='invalid-ciphertext' WHERE id='broken'");
  broadcast(f,'healthy-broadcast','healthy');insertFriend(f.raw,'healthy-friend',{line_account_id:'healthy'});
  if(includeBrokenReservation)broadcast(f,'broken-broadcast','broken');
  f.raw.exec(`UPDATE broadcasts SET status='scheduled',scheduled_at=CASE WHEN line_account_id='broken'
    THEN '2020-01-02T00:00:00Z' ELSE '2020-01-01T00:00:00Z' END`);
  // LINE quota is a local response; no real transport is enabled by this test.
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({type:'none',totalUsage:0})));
  await expect(processScheduledBroadcasts(f.db,fallback)).resolves.toBeUndefined();
  expect(f.raw.prepare("SELECT status FROM broadcasts WHERE id='healthy-broadcast'").get()).toEqual({status:'sending'});
  if(includeBrokenReservation)expect(f.raw.prepare("SELECT status FROM broadcasts WHERE id='broken-broadcast'").get()).toEqual({status:'scheduled'});
  const result=await processQueuedBroadcasts(f.db,fallback,undefined,{accountId:'healthy'});
  expect(result.acceptedRecipients).toBe(1);
  expect(wire.sends).toEqual(['Uhealthy-friend']);
});
