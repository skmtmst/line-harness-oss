import { resolveSendInterpolationExtra } from '../../services/interpolation-context.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1,insertFriend,type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { getFriendById,ensureAutoReplyPublishedVersion,type AutoReply } from '@line-crm/db';

import { matchAndReply,retryAutoReplyActionRuns } from './auto-reply.js';
import { hasAlreadyRepliedOnce } from './auto-reply-conditions.js';
import { processAutoReplyDeliveries } from './auto-reply-delivery.js';
const actions=vi.hoisted(()=>vi.fn());
vi.mock('./auto-reply-operator-action.js',async original=>({...await original<Record<string,unknown>>(),runAutoReplyAction:actions}));
vi.mock('../../services/interpolation-context.js',async original=>{
 const actual=await original<typeof import('../../services/interpolation-context.js')>();
 return {...actual,resolveSendInterpolationExtra:vi.fn(actual.resolveSendInterpolationExtra)};
});
vi.mock('../../services/send-entitlements.js',()=>({getSendPermissionForAccount:async()=>({allowed:true})}));
let f:SqliteD1;
const success={executed:1,failed:0,skippedByCondition:0,skippedByOnce:0,skippedIncomplete:0,scenarioTouched:false};
beforeEach(()=>{f=createTestD1();insertFriend(f.raw,'f');actions.mockReset();
 f.raw.prepare(`INSERT INTO auto_replies(id,keyword,response_type,response_content,once_per_friend,is_active,actions_json)
 VALUES('r','予約','text','案内',1,1,?)`).run(JSON.stringify([{id:'ok',actionType:'tag',config:{op:'add',tagIds:['a']}},{id:'bad',actionType:'tag',config:{op:'add',tagIds:['b']}}]));
 actions.mockImplementation(async(_:unknown,action:{id:string})=>action.id==='auto-reply-action-1'?{...success,executed:0,failed:1}:success);
});
afterEach(()=>f.raw.close());
async function reply(event:string,client:never){const friend=(await getFriendById(f.db,'f'))!;return matchAndReply(f.db,client,friend,'予約','fake-token',{incomingEventId:event,occurredAt:new Date().toISOString(),lineAccountId:null});}
describe('SEND-S04: 部分失敗で1人1回を消化せず、届いた返信を再送しない',()=>{
 it.each([false,true])('遅延=%s: 次の一致は返信を送らず、手動再試行は失敗した動作だけ',async delayed=>{
  if(delayed) {
   const version=await ensureAutoReplyPublishedVersion(f.db,f.raw.prepare("SELECT * FROM auto_replies WHERE id='r'").get() as AutoReply);
   f.raw.prepare(`INSERT INTO auto_reply_versions(id,auto_reply_id,version_number,status,definition_snapshot,created_at)
    SELECT 'delayed-version',auto_reply_id,2,'published',json_set(definition_snapshot,'$.replyDelaySeconds',1),created_at FROM auto_reply_versions WHERE id=?`).run(version.id);
   f.raw.exec("UPDATE auto_replies SET current_published_version_id='delayed-version' WHERE id='r'");
  }
  const replyMessageWithRequestId=vi.fn(async()=>({requestId:'fake'}));
  const pushMessageWithRequestId=vi.fn(async()=>({requestId:'fake'}));
  const client={replyMessageWithRequestId,pushMessageWithRequestId} as never;
  await reply('event-1',client);
  expect(resolveSendInterpolationExtra).toHaveBeenCalledWith(f.db,'f',expect.any(String),{kind:'auto_reply',id:'r'});
  if(delayed) await processAutoReplyDeliveries({DB:f.db} as never,new Date(Date.now()+2000),async()=>client);
  expect(await hasAlreadyRepliedOnce(f.db,{id:'r',once_per_friend:1,reply_delay_seconds:delayed?1:0},'f')).toBe(false);
  expect(f.raw.prepare('SELECT COUNT(*) n FROM auto_reply_hits').get()).toEqual({n:0});
  const evaluation=(f.raw.prepare("SELECT id FROM auto_reply_evaluations WHERE incoming_event_id='event-1'").get() as {id:string}).id;
  await reply('event-2',client);
  expect(replyMessageWithRequestId.mock.calls.length+pushMessageWithRequestId.mock.calls.length).toBe(1);
  expect(actions).toHaveBeenCalledTimes(2);
  actions.mockResolvedValue(success);
  await retryAutoReplyActionRuns(f.db,{evaluationId:evaluation,allowedAccountIds:[],canSeeUnassigned:true});
  expect(actions).toHaveBeenCalledTimes(3);
  expect(actions.mock.calls[2][1].id).toBe('auto-reply-action-1');
  expect(await hasAlreadyRepliedOnce(f.db,{id:'r',once_per_friend:1,reply_delay_seconds:delayed?1:0},'f')).toBe(true);
  expect(replyMessageWithRequestId.mock.calls.length+pushMessageWithRequestId.mock.calls.length).toBe(1);
 });
});
