vi.mock('./feature-enforcement.js',()=>({featureJobCanRun:async()=>true}));
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createTestD1,insertFriend,type SqliteD1} from '../test-utils/d1-sqlite.js';
import type {Env} from '../index.js';
const fault=vi.hoisted(()=>({tag:true}));
vi.mock('./activity-mileage.js',()=>({awardActivityMileage:async(db:D1Database)=>db.prepare("UPDATE effects SET n=n+1 WHERE id='mileage'").run()}));
vi.mock('./action-score-events.js',()=>({applyActionScoreEvent:async(db:D1Database)=>db.prepare("UPDATE effects SET n=n+1 WHERE id='score'").run()}));
vi.mock('./automation-triggers.js',()=>({dispatchAutomationEventWithLogging:async(db:D1Database)=>{await db.prepare("UPDATE effects SET n=n+1 WHERE id='automation'").run();return []}}));
vi.mock('./friend-tag-attach.js',()=>({attachTagAndFireSideEffects:async(db:D1Database)=>{
 await db.prepare("UPDATE effects SET n=n+1 WHERE id='tag'").run();if(fault.tag)throw new Error('tag after write failed');
}}));
import {recordTrackedClick,processTrackedClick,processDueTrackedClicks} from './tracked-click-steps.js';
let item:SqliteD1;
beforeEach(()=>{item=createTestD1();fault.tag=true;insertFriend(item.raw,'f',{line_account_id:'a'});
 item.raw.exec(`INSERT INTO tracked_links(id,name,original_url,line_account_id)VALUES('l','link','https://example.test','a');
 CREATE TABLE effects(id TEXT PRIMARY KEY,n INTEGER);INSERT INTO effects VALUES('mileage',0),('score',0),('automation',0),('tag',0)`)});
afterEach(()=>item.raw.close());
describe('PKG68 durable click stages',()=>{
 it('persists the queue before redirect work and resumes only the unfinished effects',async()=>{
  const saved=await recordTrackedClick(item.db,{linkId:'l',friendId:'f',accountId:'a',tagId:'tag',scenarioId:null,linkName:'link',conversionPointIds:[]});
  const env={DB:item.db} as Env['Bindings'];
  await expect(processTrackedClick(env,saved.id,saved.plan)).rejects.toThrow();
  expect(item.raw.prepare("SELECT status FROM workflow_steps WHERE step_key='__run'").get()).toEqual({status:'failed'});
  fault.tag=false;await processDueTrackedClicks(env);await processDueTrackedClicks(env);
  expect(item.raw.prepare('SELECT n FROM effects ORDER BY id').all()).toEqual([{n:1},{n:1},{n:1},{n:1}]);
  expect(item.raw.prepare('SELECT click_count FROM tracked_links').get()).toEqual({click_count:1});
  expect(item.raw.prepare("SELECT status FROM workflow_steps WHERE step_key='__run'").get()).toEqual({status:'succeeded'});
 });
 it('does not keep a click without its resume plan if checkpoint storage fails',async()=>{
  item.raw.exec("CREATE TRIGGER no_checkpoint BEFORE INSERT ON workflow_steps BEGIN SELECT RAISE(ABORT,'storage failed'); END");
  await expect(recordTrackedClick(item.db,{linkId:'l',friendId:null,accountId:'a',tagId:null,scenarioId:null,linkName:'link',conversionPointIds:[]})).rejects.toThrow();
  expect(item.raw.prepare('SELECT count(*) AS n FROM link_clicks').get()).toEqual({n:0});
  expect(item.raw.prepare('SELECT click_count FROM tracked_links').get()).toEqual({click_count:0});
 });
});
