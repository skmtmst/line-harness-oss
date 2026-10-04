import { afterEach,expect,it,vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
const dispatch=vi.hoisted(()=>vi.fn(async()=>({accepted:1,pending:0,failed:0,excluded:0,duplicate:0})));
vi.mock('./operator-notification-dispatch.js',()=>({dispatchOperatorRule:dispatch,ruleChannels:()=>['dashboard']}));
import { runAutoReplyAction,validateAutoReplyOperatorAction,type AutoReplyExecutionAction } from './auto-reply-operator-action.js';
import { parseAutoReplyActions,parseAutoReplyActionSnapshot } from './auto-reply.js';
afterEach(()=>vi.clearAllMocks());
it('通知設定の所属・公開・版を検査し、自動送信の同じ識別キーを使う',async()=>{
 const {db,raw}=createTestD1();
 try {
  raw.exec(`INSERT INTO notification_rules(id,name,event_type,conditions,channels,line_account_id,is_active,version) VALUES('r','notify','message_received','{}','["dashboard"]','a',1,2)`);
  const action=parseAutoReplyActions(JSON.stringify([{actionType:'notify_staff',config:{notificationRuleId:'r',notificationRuleVersion:2,message:'受信箱を確認してください'},onFailure:'stop'}]))[0];
  expect(await validateAutoReplyOperatorAction(db,action,'other',true)).toBeTruthy();
  expect(await runAutoReplyAction(db,action,'f',{lineAccountId:'a',sourceEventId:'stable'})).toMatchObject({executed:1,failed:0});
  expect(dispatch).toHaveBeenCalledWith(db,undefined,expect.objectContaining({id:'r',version:2}),{lineAccountId:'a',sourceEventId:'stable',message:'受信箱を確認してください',executionMode:'automatic'});
  expect(parseAutoReplyActionSnapshot(JSON.stringify(action))).toMatchObject({action_type:'notify_staff'});
  raw.exec("UPDATE notification_rules SET version=3 WHERE id='r'");
  await expect(runAutoReplyAction(db,action,'f',{lineAccountId:'a',sourceEventId:'stable'})).rejects.toThrow('notification_action_invalid');expect(dispatch).toHaveBeenCalledTimes(1);
  const missing={...action,config_json:JSON.stringify({notificationRuleId:'',message:'通知'})} as AutoReplyExecutionAction;
  expect(await validateAutoReplyOperatorAction(db,missing,'a',false)).toBeNull();
  expect(await validateAutoReplyOperatorAction(db,missing,'a',true)).toBeTruthy();
 } finally{raw.close();}
});
