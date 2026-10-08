import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Hono} from 'hono';
import {createTestD1,insertFriend,type SqliteD1} from '../test-utils/d1-sqlite.js';
import type {Env} from '../index.js';
import type {LineClient} from '@line-crm/line-sdk';
import {handleQuestionAnswer,resumeQuestionAnswer,registerLegacyQuestionAnswers} from './scenario-question-answer.js';
import {scenarios} from '../routes/scenarios.js';
let item:SqliteD1,client:LineClient,send:ReturnType<typeof vi.fn>;
const friend={id:'f',line_user_id:'Uf'};
beforeEach(()=>{item=createTestD1();insertFriend(item.raw,'f');send=vi.fn().mockResolvedValue(undefined);
 client={replyMessage:send,pushMessage:send} as unknown as LineClient;
 item.raw.exec(`INSERT INTO scenarios(id,name,trigger_type,delivery_mode)VALUES('s','scenario','manual','relative');
 INSERT INTO tags(id,name,color)VALUES('one','one','#000'),('two','two','#000')`);
 item.raw.prepare(`INSERT INTO scenario_steps(id,scenario_id,step_order,delay_minutes,message_type,message_content,question_json)
 VALUES('step','s',1,0,'text','',?)`).run(JSON.stringify({text:'question',tapMode:'single',choices:[{label:'first',behavior:'none',addTagIds:['one','two'],reply:'accepted'},{label:'second',behavior:'none'}]}));
});
afterEach(()=>item.raw.close());
const root=()=>item.raw.prepare("SELECT * FROM workflow_steps WHERE process_kind='question_answer' AND step_key='__run'").get() as {scope_id:string;subject_id:string;status:string};
describe('W45 administrator recovery',()=>{
 it('reopens only unfinished choice effects, audits who/when/why, and never replies again',async()=>{
  item.raw.exec("CREATE TRIGGER fail_second BEFORE INSERT ON friend_tags WHEN NEW.tag_id='two' BEGIN SELECT RAISE(ABORT,'temporary storage failure');END");
  await handleQuestionAnswer(item.db,client,friend,{stepId:'step',choiceIndex:0},'private-reply');
  expect(root().status).toBe('failed');expect(send).toHaveBeenCalledOnce();
  item.raw.exec("DROP TRIGGER fail_second;DELETE FROM friend_tags WHERE tag_id='one'");
  const r=root();await resumeQuestionAnswer(item.db,{scopeId:r.scope_id,executionId:r.subject_id,actorId:'owner',reason:'storage recovered',lineClient:client});
  expect(item.raw.prepare('SELECT tag_id FROM friend_tags').all()).toEqual([{tag_id:'two'}]);
  expect(root().status).toBe('succeeded');expect(send).toHaveBeenCalledOnce();
  const audit=item.raw.prepare("SELECT input_json FROM workflow_steps WHERE step_key LIKE 'resume:%'").get() as {input_json:string};
  expect(JSON.parse(audit.input_json)).toMatchObject({actorId:'owner',reason:'storage recovered',at:expect.any(String)});
 });
 it('shows old logs as unknown and requires explicit reconciliation before any effects',async()=>{
  item.raw.prepare(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,scenario_step_id,source,created_at)
   VALUES('old','f','incoming','text','sq:step:0','step','postback','2026-01-01')`).run();
  await registerLegacyQuestionAnswers(item.db,'s',async()=>true);const r=root();expect(r.status).toBe('unknown');
  await expect(resumeQuestionAnswer(item.db,{scopeId:r.scope_id,executionId:r.subject_id,actorId:'owner',reason:'check',lineClient:client})).rejects.toThrow('legacy_answer_unknown');
  expect(item.raw.prepare('SELECT count(*) AS n FROM friend_tags').get()).toEqual({n:0});
  await expect(resumeQuestionAnswer(item.db,{scopeId:r.scope_id,executionId:r.subject_id,actorId:'owner',reason:'check',lineClient:client,
    confirmedChoiceIndex:0,confirmedCompletedSteps:['tag:add:unrelated']})).rejects.toThrow('answer_reconciliation_invalid');
  await resumeQuestionAnswer(item.db,{scopeId:r.scope_id,executionId:r.subject_id,actorId:'owner',reason:'confirmed the old tag and reply',lineClient:client,
    confirmedChoiceIndex:0,confirmedCompletedSteps:['tag:add:one','reply_confirmed']});
  expect(item.raw.prepare('SELECT tag_id FROM friend_tags').all()).toEqual([{tag_id:'two'}]);expect(send).not.toHaveBeenCalled();
 });
 it('rejects read-only and non-admin callers, and moved friends cannot resume in the old scope',async()=>{
  item.raw.prepare("DELETE FROM tags WHERE id='two'").run();await handleQuestionAnswer(item.db,client,friend,{stepId:'step',choiceIndex:0},'reply');
  const r=root();
  const request=async(role:'owner'|'staff',readOnly:boolean)=>{
   const app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',{id:'actor',name:'actor',role,readOnly});await next()});app.route('/',scenarios);
   return app.request(`/api/scenarios/s/question-answers/${r.subject_id}/resume`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reason:'recovered'})},{DB:item.db});
  };
  expect((await request('owner',true)).status).toBe(403);expect((await request('staff',false)).status).toBe(403);
  item.raw.prepare("UPDATE friends SET line_account_id='other' WHERE id='f'").run();
  await expect(resumeQuestionAnswer(item.db,{scopeId:r.scope_id,executionId:r.subject_id,actorId:'owner',reason:'recovered',lineClient:client})).rejects.toThrow('answer_scope_changed');
 });
});
