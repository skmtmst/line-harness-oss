import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { getBroadcastById } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import { previewAudience, countAudience } from './broadcast-preflight.js';
import { getBroadcastAudiencePreview } from './broadcast-audience-preview.js';
import { processBroadcastSend } from './broadcast.js';
import { processBroadcastAfterActions } from './broadcast-after-actions.js';
import { createAutomationActionExecutors } from './automation-action-executors.js';
import { broadcasts } from '../routes/broadcasts.js';

const send = vi.hoisted(() => vi.fn(async (_target: string | string[]) => ({ requestId: 'isolated' })));
vi.mock('@line-crm/line-sdk', async original => ({ ...await original<Record<string, unknown>>(),
  LineClient: class { broadcast = send; multicast = send; pushMessageWithRequestId = send; },
}));
let fixture: SqliteD1;
const client = { broadcast: send, multicast: send, pushMessageWithRequestId: send };
const webhook = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('', { status: 200 }));
const webhookDependencies = { fetch: webhook as typeof fetch, lookupHost: async () => ['93.184.216.34'] };
const expected = ['own-friend', 'unassigned'];

beforeEach(() => {
  vi.clearAllMocks();
  fixture = createTestD1();
  fixture.raw.prepare("INSERT INTO tenants(id,name) VALUES ('other-tenant','Other')").run();
  for (const [id, tenant] of [['own', DEFAULT_TENANT_ID], ['other', 'other-tenant']]) {
    fixture.raw.prepare(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id)
      VALUES (?,?,?,'unused','unused',?)`).run(id, id, id, tenant);
  }
  fixture.raw.prepare(`INSERT INTO staff_members(id,name,role,api_key,tenant_id,account_scope,invite_status)
    VALUES ('null-owner','Owner','owner','null-account-token',?,'all','active')`).run(DEFAULT_TENANT_ID);
  for (const [id, account] of [['own-friend', 'own'], ['unassigned', null], ['foreign-friend', 'other']]) {
    fixture.raw.prepare(`INSERT INTO friends(id,line_user_id,display_name,picture_url,line_account_id,is_following)
      VALUES (?,?,?,?,?,1)`).run(id, 'U' + id, id, 'https://example.invalid/' + id, account);
  }
  fixture.raw.prepare("UPDATE friends SET updated_at='2099-01-01T00:00:00Z' WHERE id='foreign-friend'").run();
  fixture.raw.prepare("INSERT INTO tags(id,name,line_account_id) VALUES ('legacy-tag','Legacy',NULL)").run();
  for (const id of ['own-friend', 'unassigned', 'foreign-friend']) {
    fixture.raw.prepare("INSERT INTO friend_tags(friend_id,tag_id) VALUES (?,'legacy-tag')").run(id);
  }
  fixture.raw.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,target_tag_id,status,line_account_id,track_links)
    VALUES ('null-scope','Null scope','text','Hello','tag','legacy-tag','draft',NULL,0)`).run();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('External network is forbidden'); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); fixture.raw.close(); });

function directApp() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'null-owner', name: 'Owner', role: 'owner', readOnly: false, tenantId: DEFAULT_TENANT_ID });
    await next();
  });
  app.route('/', broadcasts); return app;
}

it('NULLの代表と人数を既定統括/未割当だけに限定する', async () => {
  const result = await previewAudience(fixture.db, { targetType: 'all' });
  expect(result.matched).toBe(2); expect(result.sendable).toBe(2);
  expect(result.representatives.map(row => row.friendId).sort()).toEqual(expected);
});

it('NULLの承認用の人数も同じ範囲だけを数える', async () => {
  expect(await countAudience(fixture.db, { targetType: 'all' })).toEqual({ total: 2, hiddenExcluded: 0 });
});

it('実routerのpreflightは他統括の名前/画像/タグ文を返さない', async () => {
  const response = await directApp().request('/api/broadcasts/preflight', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetType: 'all', lineAccountId: null }),
  }, { DB: fixture.db } as Env['Bindings']);
  const body = await response.json() as { data: { audienceCount: number; audience: { representatives: Array<{ friendId: string }> } } };
  expect(response.status).toBe(200); expect(body.data.audienceCount).toBe(2);
  expect(body.data.audience.representatives.map(row => row.friendId).sort()).toEqual(expected);
});

it.each(['all', 'tag'])('NULLの%sのpreview-countで他統括を数えない', async target => {
  fixture.raw.prepare("UPDATE broadcasts SET target_type=? WHERE id='null-scope'").run(target);
  const response = await directApp().request('/api/broadcasts/null-scope/preview-count', {}, { DB: fixture.db } as Env['Bindings']);
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({ data: { count: 2 } });
});

it.each(['all', 'tag'])('NULLの%sの緊急停止前の人数も同じ範囲にする', async target => {
  fixture.raw.prepare("UPDATE broadcasts SET target_type=? WHERE id='null-scope'").run(target);
  expect(await getBroadcastAudiencePreview(fixture.db, (await getBroadcastById(fixture.db, 'null-scope'))!)).toEqual({ count: 2 });
});

it.each(['all', 'tag'])('NULLの%sの差込確認へ他統括の名前なしを混ぜない', async target => {
  fixture.raw.prepare("UPDATE broadcasts SET target_type=?,message_content='{{name}} さん' WHERE id='null-scope'").run(target);
  fixture.raw.prepare("UPDATE friends SET display_name=NULL WHERE id='foreign-friend'").run();
  await expect(processBroadcastSend(fixture.db, client as never, 'null-scope')).resolves.toMatchObject({ status: 'sending', total_count: 2 });
  expect(send).not.toHaveBeenCalled();
});

it.each([null,'own'])('宛先の行とページ件数は可視範囲だけ、移籍の履歴は匿名件数と送達の集計で残す: %s', async accountId => {
  fixture.raw.prepare("UPDATE broadcasts SET line_account_id=?,status='sent',total_count=3,success_count=3 WHERE id='null-scope'").run(accountId);
  for(const friend of ['own-friend','unassigned','foreign-friend']) fixture.raw.prepare("INSERT INTO broadcast_send_claims(broadcast_id,friend_id,line_account_id,attempt_no,state) VALUES ('null-scope',?,?,1,'sent')").run(friend,accountId);
  const response=await directApp().request('/api/broadcasts/null-scope/recipients?limit=1',{}, {DB:fixture.db} as Env['Bindings']);
  const data=await response.json() as {data:{rows:Array<{friendId:string}>;summary:{sent:number;total:number};unavailableRecipientCount:number;unavailableRecipientLabel:string};pagination:{total:number;nextCursor:string|null}};
  expect(response.status).toBe(200);expect(data.pagination.total).toBe(2);expect(data.pagination.nextCursor).toBe('1');
  expect(data.data.unavailableRecipientCount).toBe(1);expect(data.data.unavailableRecipientLabel).toBe('見られない宛先 1件');
  expect(data.data.summary).toMatchObject({sent:3,total:3});
  const next=await directApp().request('/api/broadcasts/null-scope/recipients?limit=1&cursor=1',{}, {DB:fixture.db} as Env['Bindings']);
  const tail=await next.json() as {data:{rows:Array<{friendId:string}>};pagination:{nextCursor:string|null}};
  expect([...data.data.rows,...tail.data.rows].map(row=>row.friendId).sort()).toEqual(expected);expect(tail.pagination.nextCursor).toBeNull();
  expect(JSON.stringify(data)+JSON.stringify(tail)).not.toContain('foreign-friend');
  expect(JSON.stringify(data)+JSON.stringify(tail)).not.toContain('other');
  expect(send).not.toHaveBeenCalled();
});

it('可視宛先が0でも台帳があれば古い集約のみの記録に偽装しない', async () => {
  fixture.raw.prepare("UPDATE broadcasts SET status='sent',total_count=1,success_count=1 WHERE id='null-scope'").run();
  fixture.raw.prepare("INSERT INTO broadcast_send_claims(broadcast_id,friend_id,line_account_id,attempt_no,state) VALUES ('null-scope','foreign-friend','other',1,'sent')").run();
  const response=await directApp().request('/api/broadcasts/null-scope/recipients',{}, {DB:fixture.db} as Env['Bindings']);
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({data:{rows:[],aggregateOnly:false,unavailableRecipientCount:1,summary:{sent:1,total:1}},pagination:{total:0,nextCursor:null}});
});

it.each([null,'own'].flatMap(accountId=>['other','own',null].map(claimAccount=>({accountId,claimAccount}))))('可視友だちでも過去の不可視accountと要求IDは返さない: %j',async ({accountId,claimAccount})=>{
  fixture.raw.prepare("UPDATE broadcasts SET line_account_id=?,status='sent',total_count=1,success_count=1 WHERE id='null-scope'").run(accountId);
  fixture.raw.prepare("INSERT INTO broadcast_send_claims(broadcast_id,friend_id,line_account_id,attempt_no,state,line_request_id) VALUES ('null-scope','own-friend',?,1,'sent','claim-request')").run(claimAccount);
  const response=await directApp().request('/api/broadcasts/null-scope/recipients',{}, {DB:fixture.db} as Env['Bindings']);
  const body=await response.json() as {data:{rows:Array<{friendId:string;lineAccountId:string|null;lineAccountHidden:boolean;lineRequestId:string|null}>}};
  expect(response.status).toBe(200);expect(body.data.rows).toHaveLength(1);
  expect(body.data.rows[0]).toMatchObject({friendId:'own-friend',lineAccountId:claimAccount==='other'?null:claimAccount,lineRequestId:claimAccount==='other'?null:'claim-request'});
  if(claimAccount==='other') {expect(body.data.rows[0].lineAccountHidden).toBe(true);expect(JSON.stringify(body)).not.toContain('other');}
  else expect(body.data.rows[0].lineAccountHidden).toBeFalsy();
});

it('見られるaccountが空でもCASEのbindを取り違えず未割当と不可視を区別する',async()=>{
  fixture.raw.prepare("UPDATE friends SET line_account_id=NULL WHERE line_account_id='own'").run();
  fixture.raw.prepare("DELETE FROM line_accounts WHERE id='own'").run();
  fixture.raw.prepare("INSERT INTO broadcast_send_claims(broadcast_id,friend_id,line_account_id,attempt_no,state,line_request_id) VALUES ('null-scope','own-friend','other',1,'sent','private-request')").run();
  const response=await directApp().request('/api/broadcasts/null-scope/recipients',{}, {DB:fixture.db} as Env['Bindings']);
  const body=await response.json();expect(response.status).toBe(200);
  expect(body).toMatchObject({data:{rows:[{friendId:'own-friend',lineAccountId:null,lineAccountHidden:true,lineRequestId:null}]}});
  expect(JSON.stringify(body)).not.toContain('other');expect(JSON.stringify(body)).not.toContain('private-request');
});

it.each(['all','tag'])('scopeが読めない%sは0でなく人数不明と503を返す',async target=>{
  fixture.raw.prepare("UPDATE broadcasts SET target_type=? WHERE id='null-scope'").run(target);
  const broadcast=(await getBroadcastById(fixture.db,'null-scope'))!;
  const db={...fixture.db,prepare(sql:string){if(sql.includes('FROM line_accounts'))throw new Error('Isolated account read unavailable');return fixture.db.prepare(sql);}} as D1Database;
  expect(await getBroadcastAudiencePreview(db,broadcast)).toEqual({count:null});
  const response=await directApp().request('/api/broadcasts/null-scope/preview-count',{}, {DB:db} as Env['Bindings']);
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({success:false});
});

function setupAfterActions(accountId:string|null,friendId:string,actions=1) {
  fixture.raw.prepare("INSERT INTO outgoing_webhooks(id,line_account_id,name,url,is_active) VALUES ('after-hook','own','Isolated','https://hooks.example.com/events',1)").run();
  fixture.raw.prepare("INSERT INTO common_actions(id,line_account_id,name,status) VALUES ('after-action','own','Isolated','published')").run();
  const plan=Array.from({length:actions},(_,i)=>({id:i===0?'first':'second',type:'send_webhook',params:{webhookId:'after-hook'},onFailure:'continue'}));
  fixture.raw.prepare("INSERT INTO common_action_versions(id,common_action_id,version_number,status,action_config) VALUES ('after-version','after-action',1,'published',?)").run(JSON.stringify(plan));
  fixture.raw.prepare("UPDATE broadcasts SET line_account_id=?,after_action_version_id='after-version' WHERE id='null-scope'").run(accountId);
  fixture.raw.prepare("INSERT INTO broadcast_send_claims(broadcast_id,friend_id,line_account_id,attempt_no,state) VALUES ('null-scope',?,?,1,'sent')").run(friendId,accountId);
}
function outgoingCount(){return webhook.mock.calls.length;}

it.each([{accountId:null,friend:'foreign-friend',count:0},{accountId:'own',friend:'foreign-friend',count:0},{accountId:'own',friend:'own-friend',count:1}])('送信後webhookもNULL/他統括0・正しい自分1を守る: %j',async({accountId,friend,count})=>{
  setupAfterActions(accountId,friend);
  await processBroadcastAfterActions(fixture.db,{broadcastId:'null-scope',executorDependencies:webhookDependencies});
  expect(outgoingCount()).toBe(count);
  if(count===0)expect(fixture.raw.prepare('SELECT COUNT(*) AS n FROM broadcast_after_action_runs').get()).toEqual({n:0});
});

it('送信後actionの途中で移籍したら次のwebhookの書込は0',async()=>{
  setupAfterActions('own','own-friend',2);
  const base=createAutomationActionExecutors(webhookDependencies);let calls=0;
  await processBroadcastAfterActions(fixture.db,{broadcastId:'null-scope',executors:{...base,send_webhook:async context=>{
    calls+=1;
    try{return await base.send_webhook!(context);}
    finally{if(context.action.id==='first')fixture.raw.prepare("UPDATE friends SET line_account_id='other' WHERE id='own-friend'").run();}
  }}});
  expect(calls).toBe(1);expect(outgoingCount()).toBe(1);
  expect(fixture.raw.prepare("SELECT COUNT(*) AS n FROM broadcast_after_action_runs WHERE action_id='second'").get()).toEqual({n:0});
});

it('最初の入力集合で他統括だった宛先は所属が戻っても今回のactionに加えない',async()=>{
  setupAfterActions('own','foreign-friend');let selected=false;
  const db={...fixture.db,prepare(sql:string){
    const statement=fixture.db.prepare(sql);
    if(!sql.includes('FROM broadcast_send_claims c')||!sql.includes("c.state = 'sent'"))return statement;
    return {...statement,bind(...binds:unknown[]){const bound=statement.bind(...binds);return {...bound,async all(){
      const result=await bound.all();selected=true;
      fixture.raw.prepare("UPDATE friends SET line_account_id='own' WHERE id='foreign-friend'").run();return result;
    }}}};
  }} as D1Database;
  await processBroadcastAfterActions(db,{broadcastId:'null-scope',executorDependencies:webhookDependencies});
  expect(selected).toBe(true);expect(outgoingCount()).toBe(0);
  expect(fixture.raw.prepare('SELECT COUNT(*) AS n FROM broadcast_after_action_runs').get()).toEqual({n:0});
});
