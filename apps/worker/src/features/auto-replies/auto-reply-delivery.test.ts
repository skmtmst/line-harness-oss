import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import type {LineClient} from '@line-crm/line-sdk';
import type { Env } from '../../worker-env.js';
import {createTestD1,type SqliteD1} from '../../test-utils/d1-sqlite.js';
const mocks=vi.hoisted(()=>({friend:vi.fn(),version:vi.fn(),finish:vi.fn(),hit:vi.fn(),stop:vi.fn(),log:vi.fn(),permission:vi.fn(),proxy:vi.fn()}));
vi.mock('@line-crm/db',async original=>({...await original<Record<string,unknown>>(),getFriendById:mocks.friend,getAutoReplyVersionById:mocks.version,markAutoReplyEvaluationFinished:mocks.finish,recordAutoReplyHit:mocks.hit,isOperationCapabilityStopped:mocks.stop}));
vi.mock('../../services/line-proxy-send.js',()=>({pushViaHarnessProxy:mocks.proxy}));
vi.mock('../../services/event-bus.js',()=>({logOutgoingMessage:mocks.log}));
vi.mock('../../services/send-entitlements.js',()=>({getSendPermissionForAccount:mocks.permission}));
import {processAutoReplyDeliveries} from './auto-reply-delivery.js';
let test:SqliteD1;
const now=new Date('2026-10-07T00:00:00Z');
beforeEach(()=>{
 vi.clearAllMocks();test=createTestD1();
 test.raw.exec("INSERT INTO tenants(id,name) VALUES('t','試験'); INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES('a','試験','c','','','t')");
 test.raw.exec("INSERT INTO auto_replies(id,keyword,response_type,response_content,is_active) VALUES('r','予約','text','返信',1)");
 test.raw.prepare(`INSERT INTO auto_reply_deliveries(id,evaluation_id,friend_id,line_account_id,version_id,message_json,action_summary,due_at,created_at) VALUES('d','e','f','a','v',?,?,'2026-10-06T23:59:59Z','2026-10-06T23:59:00Z')`).run(JSON.stringify({type:'text',text:'待った返信'}),JSON.stringify({executed:1,failed:0}));
 mocks.friend.mockResolvedValue({id:'f',line_user_id:'u',line_account_id:'a',is_following:1});
 mocks.version.mockResolvedValue({auto_reply_id:'r',definition_snapshot:JSON.stringify({keyword:'予約'})});
 mocks.stop.mockResolvedValue(false);mocks.permission.mockResolvedValue({allowed:true});mocks.log.mockResolvedValue('log');
});
afterEach(()=>test.raw.close());
describe('自動応答の待ち時間を過ぎた送信',()=>{
 it('配信停止を引き継いだ人への遅延返信は送らない',async()=>{
  test.raw.exec("INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','u','a');INSERT INTO friend_delivery_consents(line_account_id,friend_id,purpose,state,reason,source) VALUES('a','f','marketing','revoked','停止希望','uid_migration')");
  const client=vi.fn();expect(await processAutoReplyDeliveries({DB:test.db} as Env['Bindings'],now,client)).toBe(0);
  expect(client).not.toHaveBeenCalled();expect(test.raw.prepare('SELECT status FROM auto_reply_deliveries').get()).toEqual({status:'skipped'});
 });
 it('期限前には送らず、期限後はpushで1回だけ送って結果を記録する',async()=>{
  const pushMessageWithRequestId=vi.fn().mockResolvedValue({requestId:'line-request'});
  const client=async()=>({pushMessageWithRequestId}) as unknown as LineClient;
  const env={DB:test.db} as Env['Bindings'];
  expect(await processAutoReplyDeliveries(env,new Date('2026-10-06T23:59:00Z'),client)).toBe(0);
  expect(await processAutoReplyDeliveries(env,now,client)).toBe(1);
  expect(await processAutoReplyDeliveries(env,now,client)).toBe(0);
  expect(pushMessageWithRequestId).toHaveBeenCalledExactlyOnceWith('u',[{type:'text',text:'待った返信'}],'d');
  expect(mocks.finish).toHaveBeenCalledWith(test.db,expect.objectContaining({status:'completed',actionSummary:{executed:1,failed:0}}));
  expect(mocks.hit).toHaveBeenCalledTimes(1);
 });
 it('停止・ブロック・課金停止なら送らない',async()=>{
  mocks.stop.mockResolvedValue(true);
  const client=vi.fn();
  expect(await processAutoReplyDeliveries({DB:test.db} as Env['Bindings'],now,client)).toBe(0);
  expect(client).not.toHaveBeenCalled();
  expect(test.raw.prepare('SELECT status FROM auto_reply_deliveries').get()).toEqual({status:'skipped'});
 });
 it('送信結果不明や送信後のログ失敗で自動再送しない',async()=>{
  mocks.log.mockRejectedValue(new Error('log failed'));
  const pushMessageWithRequestId=vi.fn().mockResolvedValue({requestId:'line-request'});
  const client=async()=>({pushMessageWithRequestId}) as unknown as LineClient;
  await processAutoReplyDeliveries({DB:test.db} as Env['Bindings'],now,client);
  await processAutoReplyDeliveries({DB:test.db} as Env['Bindings'],now,client);
  expect(pushMessageWithRequestId).toHaveBeenCalledTimes(1);
  expect(test.raw.prepare('SELECT status FROM auto_reply_deliveries').get()).toEqual({status:'accepted'});
 });
});

it('実行時はHarnessの自動送信として届け、履歴を二重に書かない',async()=>{
 test.raw.exec("UPDATE line_accounts SET channel_access_token='mock_token'");mocks.proxy.mockResolvedValue({requestId:'proxy_request'});
 expect(await processAutoReplyDeliveries({DB:test.db} as Env['Bindings'],now)).toBe(1);
 expect(mocks.proxy).toHaveBeenCalledWith(expect.any(String),'mock_token','u',[{type:'text',text:'待った返信'}],'d',expect.any(Function),'auto_reply_dispatch');
 expect(mocks.log).not.toHaveBeenCalled();expect(mocks.finish).toHaveBeenCalledWith(test.db,expect.objectContaining({replyStatus:'accepted',lineRequestId:'proxy_request'}));
});

it('配信待ちのあとにアカウントを止めた場合も送らない',async()=>{
 test.raw.exec("UPDATE line_accounts SET is_active=0 WHERE id='a'");
 const client=vi.fn();expect(await processAutoReplyDeliveries({DB:test.db} as Env['Bindings'],now,client)).toBe(0);expect(client).not.toHaveBeenCalled();
});

describe('SEND-S03: 中断した遅延応答の回収',()=>{
 async function interrupted(dispatched:boolean){
  const {createBroadcastRetryKey}=await import('../broadcasts/broadcast-retry-key.js');
  const key=await createBroadcastRetryKey('auto-reply-delivery-lease','d');
  test.raw.exec("UPDATE auto_reply_deliveries SET status='claimed'");
  test.raw.prepare(`INSERT INTO outbound_send_requests
    (idempotency_key,channel,resource_id,payload_hash,status,failure_code,lease_token,lease_expires_at,created_at,updated_at)
    VALUES(?,'line','auto-reply-delivery:d','fake','in_progress',?,'lost','2026-10-06T23:59:00Z','2026-10-06T23:58:00Z','2026-10-06T23:58:00Z')`).run(key,dispatched?null:'DELAYED_REPLY_NOT_DISPATCHED');
 }
 it('送信前に消えたclaimは期限後に回収し、1回だけ送る',async()=>{
  await interrupted(false); const pushMessageWithRequestId=vi.fn().mockResolvedValue({requestId:'fake'});
  expect(await processAutoReplyDeliveries({DB:test.db} as Env['Bindings'],now,async()=>({pushMessageWithRequestId}) as never)).toBe(1);
  expect(pushMessageWithRequestId).toHaveBeenCalledTimes(1);
 });
 it('送信を始めたあとに消えたclaimは要確認にし、自動再送しない',async()=>{
  await interrupted(true);const client=vi.fn();await processAutoReplyDeliveries({DB:test.db} as Env['Bindings'],now,client);
  expect(client).not.toHaveBeenCalled();
  expect(test.raw.prepare('SELECT status,error_code FROM auto_reply_deliveries').get()).toEqual({status:'failed',error_code:'delayed_delivery_unknown'});
  expect(mocks.finish).toHaveBeenCalledWith(test.db,expect.objectContaining({status:'failed',errorCode:'delayed_delivery_unknown'}));
 });
 it('遅延設定を外した後も、1人1回の不明結果は新しい返信で上書きしない',async()=>{
  test.raw.exec("INSERT INTO auto_reply_versions(id,auto_reply_id,version_number,status,definition_snapshot,created_at) VALUES('v','r',1,'published','{}','2026-10-06T00:00:00Z')");
  await interrupted(true);await processAutoReplyDeliveries({DB:test.db} as Env['Bindings'],now,vi.fn());
  const {hasAlreadyRepliedOnce}=await import('./auto-reply-conditions.js');
  expect(await hasAlreadyRepliedOnce(test.db,{id:'r',once_per_friend:1,reply_delay_seconds:0},'f')).toBe(true);
 });
 it('旧い期限無しclaimも黙って残さず、要確認にする',async()=>{
  test.raw.exec("UPDATE auto_reply_deliveries SET status='claimed',due_at='2026-10-06T00:00:00Z',created_at='2026-10-06T00:00:00Z'");
  await processAutoReplyDeliveries({DB:test.db} as Env['Bindings'],now,vi.fn());
  expect(test.raw.prepare('SELECT status,error_code FROM auto_reply_deliveries').get()).toEqual({status:'failed',error_code:'delayed_delivery_unknown'});
 });
});
