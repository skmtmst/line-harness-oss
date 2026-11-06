import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createTestD1,insertFriend,type SqliteD1} from '../../test-utils/d1-sqlite.js';
vi.mock('../../services/feature-enforcement.js',()=>({featureJobCanRun:async()=>true}));
vi.mock('@line-crm/db',async()=>({...await vi.importActual<typeof import('@line-crm/db')>('@line-crm/db'),isOperationCapabilityStopped:async()=>stop.value}));
const stop=vi.hoisted(()=>({value:false}));
import {processWebinarFollowups} from './webinar-followups.js';
let item:SqliteD1;
beforeEach(()=>{item=createTestD1();stop.value=false;vi.useFakeTimers();vi.setSystemTime(new Date('2099-10-08T12:00:00Z'));
 insertFriend(item.raw,'f',{line_account_id:'a'});item.raw.exec(`
 INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,liff_id)VALUES('a','c','account','private-token','s','liff');
 INSERT INTO webinars(id,account_id,title,slug,created_at,updated_at)VALUES('w','a','original','demo','2026-10-01','2026-10-01');
 INSERT INTO webinar_followup_configs(webinar_id,enabled_at,stage_enabled_at,picker_delay_minutes)VALUES('w','2026-10-01','2026-10-01',30);
 INSERT INTO webinar_picker_opens(webinar_id,friend_id,opened_at)VALUES('w','f','2026-10-08T10:00:00Z')`)});
afterEach(()=>{item.raw.close();vi.useRealTimers()});
const options=(dispatch:(request:Request)=>Promise<Response>)=>({proxyBaseUrl:'https://proxy.test',defaultAccessToken:'private-token',defaultLiffId:'liff',proxyDispatch:dispatch});
describe('W9 bounded automatic followup recovery',()=>{
 it('retries a transient failure later with the same number and immutable text',async()=>{
  const seen:Request[]=[];let fail=true;
  const dispatch=vi.fn(async(request:Request)=>{seen.push(request.clone());return new Response('{}',{status:fail?429:200})});
  expect(await processWebinarFollowups(item.db,options(dispatch))).toEqual({sent:0,failed:1});
  await processWebinarFollowups(item.db,options(dispatch));expect(dispatch).toHaveBeenCalledOnce();
  item.raw.prepare("UPDATE webinars SET title='edited'").run();vi.advanceTimersByTime(60_000);fail=false;
  expect(await processWebinarFollowups(item.db,options(dispatch))).toEqual({sent:1,failed:0});
  expect(await seen[1]!.json()).toEqual(await seen[0]!.json());
  expect(seen[1]!.headers.get('x-line-retry-key')).toBe(seen[0]!.headers.get('x-line-retry-key'));
  expect(seen[1]!.headers.has('X-Line-Harness-Source')).toBe(false);
  await processWebinarFollowups(item.db,options(dispatch));expect(dispatch).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(item.raw.prepare('SELECT input_json FROM workflow_steps').all())).not.toContain('private-token');
 });
 it('stopping does not mark sent and four rejections exhaust automatic attempts',async()=>{
  const dispatch=vi.fn(async()=>new Response('{}',{status:429}));stop.value=true;
  await processWebinarFollowups(item.db,options(dispatch));expect(item.raw.prepare('SELECT count(*) AS n FROM webinar_journey_followups').get()).toEqual({n:0});
  stop.value=false;
  for(let i=0;i<6;i++){await processWebinarFollowups(item.db,options(dispatch));vi.advanceTimersByTime(3600_000)}
  expect(dispatch).toHaveBeenCalledTimes(4);
  expect(item.raw.prepare('SELECT status,attempt_count FROM workflow_steps').get()).toEqual({status:'exhausted',attempt_count:4});
 });
 it('can recover from missing LIFF configuration without creating an empty wire snapshot',async()=>{
  item.raw.prepare('UPDATE line_accounts SET liff_id=NULL').run();
  const dispatch=vi.fn(async()=>new Response('{}',{status:200}));
  await processWebinarFollowups(item.db,{...options(dispatch),defaultLiffId:null});expect(dispatch).not.toHaveBeenCalled();
  item.raw.prepare("UPDATE line_accounts SET liff_id='restored'").run();vi.advanceTimersByTime(60_000);
  expect(await processWebinarFollowups(item.db,options(dispatch))).toEqual({sent:1,failed:0});
 });
 it.each(['disconnect','accepted_storage_failure'])('does not send an unknown followup again: %s',async failure=>{
  const dispatch=vi.fn(async()=>{if(failure==='disconnect')throw new Error('lost response');return new Response('{}',{headers:{'x-line-request-id':'accepted-webinar'}})});
  if(failure==='accepted_storage_failure')item.raw.exec("CREATE TRIGGER fail_followup_completion BEFORE UPDATE ON workflow_steps WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'injected'); END");
  await processWebinarFollowups(item.db,options(dispatch));
  vi.advanceTimersByTime(3600_000);await processWebinarFollowups(item.db,options(dispatch));
  expect(dispatch).toHaveBeenCalledOnce();
  if(failure==='accepted_storage_failure') {
    const row=item.raw.prepare('SELECT result_json FROM workflow_steps').get() as {result_json:string};
    expect(JSON.parse(row.result_json)).toEqual({requestId:'accepted-webinar'});
  }
  expect(item.raw.prepare('SELECT status,error_code FROM workflow_steps').get()).toEqual({status:'unknown',error_code:'delivery_unknown'});
 });

 it('holds an ambiguous historical followup failure without resetting attempts or its key',async()=>{
  const dispatch=vi.fn(async()=>new Response('{}',{status:429}));await processWebinarFollowups(item.db,options(dispatch));
  item.raw.exec("UPDATE workflow_steps SET error_code='delivery_failed',max_attempts=5");
  const before=item.raw.prepare('SELECT retry_key,attempt_count FROM workflow_steps').get();
  vi.advanceTimersByTime(3600_000);await processWebinarFollowups(item.db,options(dispatch));
  expect(dispatch).toHaveBeenCalledOnce();expect(item.raw.prepare('SELECT retry_key,attempt_count FROM workflow_steps').get()).toEqual(before);
  expect(item.raw.prepare('SELECT status,error_code FROM workflow_steps').get()).toEqual({status:'unknown',error_code:'delivery_unknown'});
 });

});

it('stores an over-budget Retry-After without shortening it or sending again',async()=>{
 const now=Date.now();
 const dispatch=vi.fn(async()=>new Response('{}',{status:429,headers:{'Retry-After':'7200'}}));
 await processWebinarFollowups(item.db,options(dispatch));
 expect(item.raw.prepare('SELECT status,error_code,next_attempt_at FROM workflow_steps').get()).toEqual({status:'exhausted',error_code:'retry_after_exceeds_budget',next_attempt_at:now+7200_000});
 vi.advanceTimersByTime(3600_000);await processWebinarFollowups(item.db,options(dispatch));
 expect(dispatch).toHaveBeenCalledOnce();
});
