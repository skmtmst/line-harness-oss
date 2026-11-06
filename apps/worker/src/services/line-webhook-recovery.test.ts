import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { getLineWebhookEvent } from '@line-crm/db';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { lineWebhookCanRetry, retryLineWebhookEvent, processDueLineWebhookRetries } from './line-webhook-recovery.js';

const wire = vi.hoisted(() => ({replyMessage:vi.fn(),replyMessageWithRequestId:vi.fn(),pushMessage:vi.fn(),getProfile:vi.fn(),linkRichMenuToUser:vi.fn()}));
vi.mock('@line-crm/line-sdk', async () => ({
  ...await vi.importActual<typeof import('@line-crm/line-sdk')>('@line-crm/line-sdk'),
  verifySignature:vi.fn().mockResolvedValue(true),LineClient:vi.fn().mockImplementation(function () { return wire; }),
}));
const {webhook} = await import('../routes/webhook.js');
let item:SqliteD1;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch',vi.fn(() => {throw new Error('real network forbidden by fixture');}));
  item=createTestD1();
  item.raw.exec("INSERT INTO tenants(id,name) VALUES('tenant','人工'); INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('a','c','人工','fake-token','fake-secret','tenant')");
  insertFriend(item.raw,'friend',{line_user_id:'U-fixture',line_account_id:'a'});
  item.raw.exec("INSERT INTO tags(id,name,line_account_id) VALUES('one','人工1','a'),('two','人工2','a'); INSERT INTO scoring_rules(id,name,event_type,score_value) VALUES('score','人工','message_received',5)");
});
afterEach(()=>{item.raw.close();vi.unstubAllGlobals();});
const env = () => ({DB:item.db,LINE_CHANNEL_SECRET:'fake-secret',LINE_CHANNEL_ACCESS_TOKEN:'fake-token'} as Env['Bindings']);
async function receive(id='event',type='message') {
  const app=new Hono<Env>();app.route('/',webhook);
  const tasks:Promise<unknown>[]=[];
  const response=await app.request('/webhook',{method:'POST',headers:{'X-Line-Signature':'x'.repeat(44),'Content-Type':'application/json'},body:JSON.stringify({destination:'fixture',events:[{
    type,replyToken:'private-fixture-key',timestamp:1800000000000,source:{type:'user',userId:'U-fixture'},webhookEventId:id,deliveryContext:{isRedelivery:false},mode:'active',message:{type:'text',id:`msg-${id}`,text:'人工の本文'},
  }]})},env(),{waitUntil:(p:Promise<unknown>)=>tasks.push(p),passThroughOnException(){},props:{}} as unknown as ExecutionContext);
  expect(response.status).toBe(200);await Promise.all(tasks);
}
async function retry(id='event') {return retryLineWebhookEvent(env(),(await getLineWebhookEvent(item.db,id))!);}
function automation(actions:unknown[],type='message_received') {
  item.raw.prepare("INSERT INTO automations(id,name,event_type,conditions,actions,line_account_id) VALUES('auto','人工',?,'{}',?,'a')").run(type,JSON.stringify(actions));
}

it('score and the first tag survive a later SQL failure; only the second tag resumes, including a lost final update',async()=>{
  automation([{type:'add_tag',params:{tagId:'one'}},{type:'add_tag',params:{tagId:'two'}}]);
  item.raw.exec("CREATE TRIGGER fail_second BEFORE INSERT ON friend_tags WHEN NEW.tag_id='two' BEGIN SELECT RAISE(ABORT,'sqlite fixture');END");
  await receive();
  expect((await getLineWebhookEvent(item.db,'event'))?.status).toBe('failed');
  expect(item.raw.prepare('SELECT SUM(score_change) AS n FROM friend_scores').get()).toEqual({n:5});
  expect(item.raw.prepare('SELECT tag_id FROM friend_tags').all()).toEqual([{tag_id:'one'}]);
  expect(await lineWebhookCanRetry(item.db,(await getLineWebhookEvent(item.db,'event'))!)).toBe(true);
  item.raw.exec("DROP TRIGGER fail_second; CREATE TRIGGER final_lost BEFORE UPDATE ON line_webhook_events WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'sqlite final fixture');END");
  expect((await retry()).status).toBe('failed');
  expect(await lineWebhookCanRetry(item.db,(await getLineWebhookEvent(item.db,'event'))!)).toBe(false);
  item.raw.exec('DROP TRIGGER final_lost');
  expect((await retry()).status).toBe('succeeded');
  await processDueLineWebhookRetries(env());await retry();
  expect(item.raw.prepare('SELECT SUM(score_change) AS n FROM friend_scores').get()).toEqual({n:5});
  expect(item.raw.prepare('SELECT COUNT(*) AS n FROM friend_tags').get()).toEqual({n:2});
  expect(wire.replyMessage).not.toHaveBeenCalled();expect(wire.pushMessage).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('a missing reply key blocks a legacy reply even while later safe tags recover',async()=>{
  automation([{type:'send_message',params:{content:'偽の返信'}},{type:'add_tag',params:{tagId:'two'}}]);
  wire.replyMessage.mockRejectedValueOnce(new Error('fixture unknown acknowledgement'));
  await receive();
  expect((await getLineWebhookEvent(item.db,'event'))?.status).toBe('failed');
  const result=await retry();
  expect(result).toMatchObject({status:'needs_review',reasonCode:'reply_input_unavailable'});
  expect(item.raw.prepare('SELECT tag_id FROM friend_tags').all()).toEqual([{tag_id:'two'}]);
  await processDueLineWebhookRetries(env());await retry();
  expect(wire.replyMessage).toHaveBeenCalledOnce();expect(wire.pushMessage).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('a legacy event with no checkpoint is held durably, without reading other accounts or sending',async()=>{
  item.raw.exec("INSERT INTO line_webhook_events(webhook_event_id,line_account_id,event_type,status) VALUES('legacy','a','message','failed')");
  expect(await lineWebhookCanRetry(item.db,(await getLineWebhookEvent(item.db,'legacy'))!)).toBe(false);
  expect(await retry('legacy')).toMatchObject({status:'needs_review',reasonCode:'input_unavailable'});
  expect(item.raw.prepare("SELECT status,error_code FROM workflow_steps WHERE subject_id='legacy'").get()).toEqual({status:'unknown',error_code:'input_unavailable'});
  expect(wire.pushMessage).not.toHaveBeenCalled();
});

it('an uncertain legacy external operation is held while later internal tags recover',async()=>{
  automation([{type:'switch_rich_menu',params:{richMenuId:'fixture-menu'}},{type:'send_message',params:{content:'偽の返信'}},{type:'add_tag',params:{tagId:'two'}}]);
  wire.linkRichMenuToUser.mockRejectedValueOnce(new Error('fixture acknowledgement unknown'));
  await receive();
  expect((await getLineWebhookEvent(item.db,'event'))?.status).toBe('failed');
  expect(await retry()).toMatchObject({status:'needs_review',reasonCode:'delivery_unknown'});
  expect(item.raw.prepare('SELECT tag_id FROM friend_tags').all()).toEqual([{tag_id:'two'}]);
  expect(wire.linkRichMenuToUser).toHaveBeenCalledOnce();
  expect(wire.replyMessage).not.toHaveBeenCalled();expect(wire.pushMessage).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('unfollow recovery resumes internal actions while holding external delivery',async()=>{
  automation([{type:'add_tag',params:{tagId:'two'}},{type:'send_message',params:{content:'偽の通知'}}],'friend_unfollow');
  item.raw.exec("CREATE TRIGGER fail_second BEFORE INSERT ON friend_tags WHEN NEW.tag_id='two' BEGIN SELECT RAISE(ABORT,'sqlite fixture');END");
  await receive('unfollow','unfollow');
  expect((await getLineWebhookEvent(item.db,'unfollow'))?.status).toBe('failed');
  item.raw.exec('DROP TRIGGER fail_second');
  expect(await retry('unfollow')).toMatchObject({status:'needs_review',reasonCode:'reply_input_unavailable'});
  expect(item.raw.prepare('SELECT tag_id FROM friend_tags').all()).toEqual([{tag_id:'two'}]);
  expect(wire.replyMessage).not.toHaveBeenCalled();expect(wire.pushMessage).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('scoring recovers independently even when a crash before reply evaluation leaves its key unavailable',async()=>{
  const batch=item.db.batch.bind(item.db);let interrupted=false;
  item.db.batch=async<T=unknown>(statements:D1PreparedStatement[])=>{
    const result=await batch<T>(statements);
    if(!interrupted && statements.some(s=>/INSERT OR IGNORE INTO messages_log/.test((s as unknown as {sql:string}).sql))){interrupted=true;throw new Error('sqlite committed fixture');}
    return result;
  };
  await receive();
  expect(await retry()).toMatchObject({status:'needs_review',reasonCode:'reply_input_unavailable'});
  await processDueLineWebhookRetries(env());await retry();
  expect(item.raw.prepare('SELECT SUM(score_change) AS n FROM friend_scores').get()).toEqual({n:5});
  expect(wire.replyMessage).not.toHaveBeenCalled();expect(wire.pushMessage).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('retry visibility follows saved inputs, account ownership and stopped/uncertain state',async()=>{
  automation([{type:'add_tag',params:{tagId:'two'}}]);
  item.raw.exec("CREATE TRIGGER fail_second BEFORE INSERT ON friend_tags WHEN NEW.tag_id='two' BEGIN SELECT RAISE(ABORT,'fixture');END");
  await receive();
  const row=(await getLineWebhookEvent(item.db,'event'))!;
  expect(await lineWebhookCanRetry(item.db,row)).toBe(true);
  item.raw.exec("UPDATE tenants SET status='suspended' WHERE id='tenant'");
  expect(await lineWebhookCanRetry(item.db,row)).toBe(false);
  item.raw.exec("UPDATE tenants SET status='active' WHERE id='tenant'; UPDATE friends SET line_account_id=NULL WHERE id='friend'");
  expect(await lineWebhookCanRetry(item.db,row)).toBe(false);
  item.raw.exec("UPDATE friends SET line_account_id='a' WHERE id='friend'; UPDATE messages_log SET unsent_at='2026-10-12T00:00:00' WHERE direction='incoming'");
  expect(await lineWebhookCanRetry(item.db,row)).toBe(false);
  item.raw.exec("UPDATE messages_log SET unsent_at=NULL; UPDATE workflow_steps SET status='unknown' WHERE subject_id='event' AND step_key='__run'");
  expect(await lineWebhookCanRetry(item.db,row)).toBe(false);
  expect(wire.replyMessage).not.toHaveBeenCalled();expect(wire.pushMessage).not.toHaveBeenCalled();
});
