import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createTestD1,insertFriend,type SqliteD1} from '../test-utils/d1-sqlite.js';
vi.mock('./feature-enforcement.js',()=>({featureJobCanRun:async()=>true}));
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
  const dispatch=vi.fn(async(request:Request)=>{seen.push(request.clone());return new Response('{}',{status:fail?503:200})});
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
 it('stopping does not mark sent and five failures exhaust automatic attempts',async()=>{
  const dispatch=vi.fn(async()=>new Response('{}',{status:503}));stop.value=true;
  await processWebinarFollowups(item.db,options(dispatch));expect(item.raw.prepare('SELECT count(*) AS n FROM webinar_journey_followups').get()).toEqual({n:0});
  stop.value=false;
  for(let i=0;i<6;i++){await processWebinarFollowups(item.db,options(dispatch));vi.advanceTimersByTime(3600_000)}
  expect(dispatch).toHaveBeenCalledTimes(5);
  expect(item.raw.prepare('SELECT status,attempt_count FROM workflow_steps').get()).toEqual({status:'exhausted',attempt_count:5});
 });
 it('can recover from missing LIFF configuration without creating an empty wire snapshot',async()=>{
  item.raw.prepare('UPDATE line_accounts SET liff_id=NULL').run();
  const dispatch=vi.fn(async()=>new Response('{}',{status:200}));
  await processWebinarFollowups(item.db,{...options(dispatch),defaultLiffId:null});expect(dispatch).not.toHaveBeenCalled();
  item.raw.prepare("UPDATE line_accounts SET liff_id='restored'").run();vi.advanceTimersByTime(60_000);
  expect(await processWebinarFollowups(item.db,options(dispatch))).toEqual({sent:1,failed:0});
 });
});
