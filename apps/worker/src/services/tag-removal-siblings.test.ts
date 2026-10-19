import { afterEach,beforeEach,expect,test,vi } from 'vitest';
import { createTestD1,type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { runActionRows,type ScenarioActionRow } from '../features/scenarios/scenario-actions.js';
import { handleQuestionAnswer } from '../features/scenarios/scenario-question-answer.js';
import type { LineClient } from '@line-crm/line-sdk';
import { fireEvent } from './event-bus.js';
vi.mock('./event-bus.js',()=>({fireEvent:vi.fn(async()=>undefined)}));
let f:SqliteD1;
beforeEach(()=>{
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external access forbidden');}));vi.mocked(fireEvent).mockClear();
  f=createTestD1();f.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES ('a','ch','fixture','fake','fake');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('f','Uf','a');
    INSERT INTO tags(id,name,line_account_id) VALUES ('t','fixture','a'); INSERT INTO friend_tags(friend_id,tag_id) VALUES ('f','t');
    INSERT INTO scenarios(id,name,trigger_type,line_account_id) VALUES ('scenario','fixture','manual','a');`);
});
afterEach(()=>{f.raw.close();vi.unstubAllGlobals();});
test('D-05 仲間: シナリオのタグ解除もtag_changeを知らせる',async()=>{
  const action:ScenarioActionRow={id:'remove',scenario_id:'scenario',hook:'choice_selected',step_id:null,choice_index:null,sort_order:0,action_type:'tag',config_json:'{"op":"remove","tagIds":["t"]}',condition_json:null,repeat_on_refire:1};
  expect((await runActionRows(f.db,[action],'f',{accountId:'a',sourceEventId:'choice'})).failed).toBe(0);
  expect(fireEvent).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fireEvent).mock.calls[0].slice(1)).toEqual(['tag_change',{
    friendId:'f',eventData:{tagId:'t',action:'remove'},sourceKind:'friend_tag',
    sourceEventId:expect.stringMatching(/^tag:f:t:remove:.+$/),occurredAt:expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
  },undefined,'a']);
});
test('D-05 仲間: 質問の選択肢からのタグ解除もtag_changeを知らせる',async()=>{
  f.raw.prepare(`INSERT INTO scenario_steps(id,scenario_id,step_order,delay_minutes,message_type,message_content,question_json)
    VALUES ('step','scenario',1,0,'text','fake',?)`).run(JSON.stringify({text:'fixture',tapMode:'single',choices:[{label:'remove',behavior:'none',removeTagIds:['t']}]}));
  const send=vi.fn(async()=>undefined),client={replyMessage:send,pushMessage:send} as unknown as LineClient;
  await handleQuestionAnswer(f.db,client,{id:'f',line_user_id:'Uf'},{stepId:'step',choiceIndex:0,lineAccountId:'a'},'fake-reply');
  expect(fireEvent).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fireEvent).mock.calls[0].slice(1)).toEqual(['tag_change',{
    friendId:'f',eventData:{tagId:'t',action:'remove'},sourceKind:'friend_tag',
    sourceEventId:expect.stringMatching(/^tag:f:t:remove:.+$/),occurredAt:expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
  },undefined,'a']);
  expect(send).not.toHaveBeenCalled();
});
