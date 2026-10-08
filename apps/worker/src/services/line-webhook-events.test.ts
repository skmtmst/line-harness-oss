import {afterEach,beforeEach,describe,expect,test,vi} from 'vitest';
import type {WebhookEvent} from '@line-crm/line-sdk';
import {createTestD1,type SqliteD1} from '../test-utils/d1-sqlite.js';
import {classifyLineWebhookError,processLineWebhookEvents} from './line-webhook-events.js';
let item:SqliteD1;
beforeEach(()=>item=createTestD1());afterEach(()=>item.raw.close());
function event(id:string):WebhookEvent{return {type:'message',replyToken:`private-${id}`,message:{type:'text',id:`message-${id}`,text:'private message'},timestamp:0,
 source:{type:'user',userId:`U-private-${id}`},webhookEventId:id,deliveryContext:{isRedelivery:false},mode:'active'}}
describe('LINE durable event receipts',()=>{
 test('same event resumes only its unfinished steps, then all redeliveries are skipped',async()=>{
  let fails=true;const done=vi.fn(),remaining=vi.fn(async()=>{if(fails)throw new Error('interrupted')});
  const handle=async(_event:WebhookEvent,execution:import('./workflow-execution.js').WorkflowExecution)=>{
   await execution.step('done',done);await execution.step('remaining',remaining);
  };
  const request={db:item.db,events:[event('one')],lineAccountId:null,handle};
  await processLineWebhookEvents(request);fails=false;await processLineWebhookEvents(request);await processLineWebhookEvents(request);
  expect(done).toHaveBeenCalledOnce();expect(remaining).toHaveBeenCalledTimes(2);
  expect(item.raw.prepare("SELECT status FROM line_webhook_events WHERE webhook_event_id='one'").get()).toEqual({status:'succeeded'});
 });
 test('fails closed when receipt storage is unavailable',async()=>{
  item.raw.exec("CREATE TRIGGER broken BEFORE INSERT ON workflow_steps BEGIN SELECT RAISE(ABORT,'private db detail');END");
  const handle=vi.fn(),spy=vi.spyOn(console,'error').mockImplementation(()=>{});
  await processLineWebhookEvents({db:item.db,events:[event('one')],lineAccountId:null,handle});
  expect(handle).not.toHaveBeenCalled();expect(JSON.stringify(spy.mock.calls)).not.toContain('private');spy.mockRestore();
 });
 test('classifies failures without logging the message, user ID or reply token, and handles the next event',async()=>{
  const handle=vi.fn().mockRejectedValueOnce(Object.assign(new Error('private exception'),{name:'LineApiError',status:500})).mockResolvedValueOnce(undefined);
  const spy=vi.spyOn(console,'error').mockImplementation(()=>{});
  await processLineWebhookEvents({db:item.db,events:[event('one'),event('two')],lineAccountId:null,handle});
  expect(item.raw.prepare('SELECT status,last_error FROM line_webhook_events ORDER BY webhook_event_id').all()).toEqual([
   {status:'failed',last_error:'line_api_error'},{status:'succeeded',last_error:null}]);
  expect(JSON.stringify(spy.mock.calls)).not.toContain('private');spy.mockRestore();
 });
 test('legacy failed events have unknown completion and are not replayed automatically',async()=>{
  item.raw.prepare(`INSERT INTO line_webhook_events(webhook_event_id,event_type,status,attempts,received_at,updated_at)
   VALUES('one','message','failed',1,'2026-01-01','2026-01-01')`).run();
  const handle=vi.fn();await processLineWebhookEvents({db:item.db,events:[event('one')],lineAccountId:null,handle});
  expect(handle).not.toHaveBeenCalled();expect(item.raw.prepare('SELECT status FROM workflow_steps').get()).toEqual({status:'unknown'});
 });
 test('reduces raw exception bodies to safe classifications',()=>{
  expect(classifyLineWebhookError(new Error('private error'))).toBe('unknown');
  expect(classifyLineWebhookError(Object.assign(new Error('private error'),{name:'D1Error'}))).toBe('db_error');
  expect(classifyLineWebhookError(new Error('LINE API error: 500 private body'))).toBe('line_api_error');
 });
});
