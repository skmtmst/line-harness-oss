import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { getBroadcastById } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { processQueuedBroadcasts, processBroadcastSend } from './broadcast.js';
import { getBroadcastAudiencePreview } from './broadcast-audience-preview.js';

const send = vi.hoisted(() => vi.fn(async (_target: string | string[]) => ({ requestId: 'isolated' })));
vi.mock('@line-crm/line-sdk', async original => ({ ...await original<Record<string, unknown>>(),
  LineClient: class { broadcast = send; multicast = send; pushMessageWithRequestId = send; },
}));
vi.mock('./send-entitlements.js', async original => ({ ...await original<Record<string, unknown>>(),
  getSendPermissionForAccount: vi.fn(async () => ({ allowed: true })),
}));
vi.mock('./broadcast-quota-guard.js', async original => ({ ...await original<Record<string, unknown>>(),
  fetchQuota: vi.fn(async () => ({ limit: 100000, used: 0 })),
}));
vi.mock('./stealth.js', async original => ({ ...await original<Record<string, unknown>>(), sleep: vi.fn(async () => {}) }));
let fixture: SqliteD1;
const client = { broadcast: send, multicast: send, pushMessageWithRequestId: send };
const eitherAccount = { operator: 'OR', rules: ['allowed', 'outside'].map(text => ({ type: 'name', value: { text, targets: ['display'] } })) };
beforeEach(() => {
  vi.clearAllMocks();
  fixture = createTestD1();
  fixture.raw.prepare("INSERT INTO tenants(id,name) VALUES ('other-tenant','Other')").run();
  for (const [id, tenant] of [['own', DEFAULT_TENANT_ID], ['other', 'other-tenant']]) {
    fixture.raw.prepare(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id)
      VALUES (?,?,?,'unused','unused',?)`).run(id,id,id,tenant);
  }
  for (const [id,account,name] of [['own-friend','own','allowed'],['foreign-friend','other','outside'],['unassigned',null,'allowed']]) {
    fixture.raw.prepare('INSERT INTO friends(id,line_user_id,display_name,line_account_id,is_following) VALUES (?,?,?,?,1)')
      .run(id,'U'+id,name,account);
  }
  fixture.raw.prepare("INSERT INTO tags(id,name) VALUES ('all-tag','All')").run();
  for(const id of ['own-friend','foreign-friend','unassigned']) fixture.raw.prepare("INSERT INTO friend_tags(friend_id,tag_id) VALUES (?,'all-tag')").run(id);
  fixture.raw.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status,line_account_id,segment_conditions,batch_offset,track_links)
    VALUES ('boundary','Boundary','text','Hello','segment','sending','own',?,0,0)`).run(JSON.stringify(eitherAccount));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('External network forbidden'); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); fixture.raw.close(); });
const attempted = () => send.mock.calls.flatMap(([ids]) => Array.isArray(ids) ? ids : [ids]).sort();

it.each([{account:'own',personalized:false},{account:'own',personalized:true},{account:null,personalized:false},{account:null,personalized:true}])('実SQLiteのOR選定から偽dispatchまで所属外は0: %j', async ({account,personalized}) => {
  fixture.raw.prepare("UPDATE broadcasts SET line_account_id=?,message_content=? WHERE id='boundary'").run(account,personalized?'{{name}} さん':'Hello');
  await processQueuedBroadcasts(fixture.db,client as never);
  expect(attempted()).toEqual(account?['Uown-friend']:['Uown-friend','Uunassigned']);
  expect(fixture.raw.prepare("SELECT total_count FROM broadcasts WHERE id='boundary'").get()).toEqual({total_count:account?1:2});
  expect(fixture.raw.prepare("SELECT friend_id FROM broadcast_send_claims WHERE friend_id='foreign-friend'").all()).toEqual([]);
});
it('ANDの正規配信も同じ実経路で1人へ送れる',async()=>{
  fixture.raw.prepare("UPDATE broadcasts SET segment_conditions=? WHERE id='boundary'").run(JSON.stringify({operator:'AND',rules:[eitherAccount.rules[0]]}));
  await processQueuedBroadcasts(fixture.db,client as never);
  expect(attempted()).toEqual(['Uown-friend']);
});
it.each(['own',null])('緊急停止の人数はORでも所属の範囲内: %s',async account=>{
  fixture.raw.prepare("UPDATE broadcasts SET line_account_id=? WHERE id='boundary'").run(account);
  expect(await getBroadcastAudiencePreview(fixture.db,(await getBroadcastById(fixture.db,'boundary'))!)).toEqual({count:account?1:2});
});
it.each(['own',null])('差込と通常の条件をキューへ入れる際の人数も範囲内: %s',async account=>{
  fixture.raw.prepare("UPDATE broadcasts SET line_account_id=?,message_content='{{name}} さん',status='draft' WHERE id='boundary'").run(account);
  expect(await processBroadcastSend(fixture.db,client as never,'boundary')).toMatchObject({status:'sending',total_count:account?1:2});
  expect(send).not.toHaveBeenCalled();
});
it.each(['new','failed','claimed'])('NULLタグは既存の台帳や再送でも他統括に送らない: %s',async state=>{
  fixture.raw.prepare("UPDATE broadcasts SET line_account_id=NULL,target_type='tag',target_tag_id='all-tag',segment_conditions=NULL,status='draft' WHERE id='boundary'").run();
  if(state!=='new') for(const id of ['own-friend','foreign-friend','unassigned']) fixture.raw.prepare("INSERT INTO broadcast_send_claims(broadcast_id,friend_id,line_account_id,attempt_no,state) VALUES ('boundary',?,NULL,1,?)").run(id,state);
  await processBroadcastSend(fixture.db,client as never,'boundary');
  expect(attempted()).toEqual(['Uown-friend','Uunassigned']);
  expect(fixture.raw.prepare("SELECT total_count FROM broadcasts WHERE id='boundary'").get()).toEqual({total_count:2});
});

it('差込の1人目の後で所属が変わったら、次の送信と台帳書込を止める',async()=>{
  fixture.raw.prepare("INSERT INTO friends(id,line_user_id,display_name,line_account_id,is_following,created_at) VALUES ('second-own','Usecond-own','allowed','own',1,'2099-01-01')").run();
  fixture.raw.prepare("UPDATE broadcasts SET message_content='{{name}} さん' WHERE id='boundary'").run();
  send.mockImplementationOnce(async()=>{
    fixture.raw.prepare("UPDATE friends SET line_account_id='other' WHERE id='second-own'").run();
    return {requestId:'isolated-first'};
  });
  await processQueuedBroadcasts(fixture.db,client as never);
  expect(attempted()).toEqual(['Uown-friend']);
  expect(fixture.raw.prepare("SELECT friend_id FROM broadcast_send_claims WHERE friend_id='second-own'").all()).toEqual([]);
});
it.each(['segment','tag'])('束の間の所属変更も送信直前に再確認する: %s',async target=>{
  for(let i=0;i<500;i++){
    const id='later-'+String(i).padStart(3,'0');
    fixture.raw.prepare("INSERT INTO friends(id,line_user_id,display_name,line_account_id,is_following,created_at) VALUES (?,?,?,'own',1,'2099-01-01')").run(id,'U'+id,'allowed');
    fixture.raw.prepare("INSERT INTO friend_tags(friend_id,tag_id) VALUES (?,'all-tag')").run(id);
  }
  if(target==='tag')fixture.raw.prepare("UPDATE broadcasts SET target_type='tag',target_tag_id='all-tag',segment_conditions=NULL,status='draft' WHERE id='boundary'").run();
  // Select all 501 first. Change the one left for the second batch after the first dispatch.
  send.mockImplementationOnce(async()=>{
    const remaining=fixture.raw.prepare("SELECT id FROM friends WHERE line_account_id='own' AND id NOT IN(SELECT friend_id FROM broadcast_send_claims WHERE broadcast_id='boundary')").all() as Array<{id:string}>;
    expect(remaining).toHaveLength(1);
    fixture.raw.prepare("UPDATE friends SET line_account_id='other' WHERE id=?").run(remaining[0].id);
    return {requestId:'isolated-first'};
  });
  if(target==='tag')await processBroadcastSend(fixture.db,client as never,'boundary');
  else await processQueuedBroadcasts(fixture.db,client as never);
  expect(attempted()).toHaveLength(500);
  expect(fixture.raw.prepare("SELECT COUNT(*) AS n FROM broadcast_send_claims WHERE broadcast_id='boundary'").get()).toEqual({n:500});
});

it.each([{account:'own',fields:false},{account:'own',fields:true},{account:null,fields:false},{account:null,fields:true}])('150人の差込でも所属確認を間引かず問い合わせ予算に収まる: %j',async({account,fields})=>{
  for(let i=0;i<160;i++)fixture.raw.prepare("INSERT INTO friends(id,line_user_id,display_name,line_account_id,is_following) VALUES (?,?,?,'own',1)").run('budget-'+i,'Ubudget-'+i,'allowed');
  fixture.raw.prepare("INSERT INTO friend_fields(id,name,field_key,type,default_value) VALUES ('budget-field','表示欄','budget','text','Value')").run();
  fixture.raw.prepare("UPDATE broadcasts SET line_account_id=?,message_content=?,segment_conditions=? WHERE id='boundary'")
    .run(account,fields?'{{name}} {{field.budget}}':'{{name}}',JSON.stringify({operator:'AND',rules:[eitherAccount.rules[0]]}));
  let queries=0;let inBatch=false;
  const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>new Proxy(statement,{get(target,key){
    if(key==='bind')return(...values:unknown[])=>wrap(target.bind(...values));
    if(key==='all'||key==='first'||key==='run')return async(...args:unknown[])=>{
      if(!inBatch)queries++;
      return (target[key] as (...values:unknown[])=>Promise<unknown>)(...args);
    };
    return Reflect.get(target,key);
  }});
  const measured={...fixture.db,prepare(sql:string){return wrap(fixture.db.prepare(sql));},async batch(statements:D1PreparedStatement[]){
    queries++;inBatch=true;try{return await fixture.db.batch(statements);}finally{inBatch=false;}
  }} as D1Database;
  await processQueuedBroadcasts(measured,client as never);
  const operations=queries+send.mock.calls.length;
  console.info(JSON.stringify({account,fields,terminalD1Requests:queries,fakeLineRequests:send.mock.calls.length,totalSubrequests:operations}));
  expect(send).toHaveBeenCalledTimes(150);
  expect(operations).toBeLessThan(1000);
  expect(fixture.raw.prepare("SELECT batch_offset FROM broadcasts WHERE id='boundary'").get()).toEqual({batch_offset:150});
});
it('メッセージの記録があれば台帳が無くても二度送らず、テスト送信の記録は本配信を妨げない',async()=>{
  fixture.raw.prepare("UPDATE broadcasts SET message_content='{{name}}' WHERE id='boundary'").run();
  fixture.raw.prepare("INSERT INTO messages_log(id,friend_id,direction,message_type,content,broadcast_id,delivery_type) VALUES ('prior','own-friend','outgoing','text','prior','boundary','push')").run();
  await processQueuedBroadcasts(fixture.db,client as never);
  expect(send).not.toHaveBeenCalled();
  fixture.raw.prepare("UPDATE messages_log SET delivery_type='test' WHERE id='prior'").run();
  fixture.raw.prepare("UPDATE broadcasts SET status='sending',batch_offset=0,sent_at=NULL WHERE id='boundary'").run();
  await processQueuedBroadcasts(fixture.db,client as never);
  expect(attempted()).toEqual(['Uown-friend']);
});
