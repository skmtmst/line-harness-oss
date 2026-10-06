import { getNotificationRuleById } from '@line-crm/db';
import type { Env } from '../index.js';
import { dispatchOperatorRule, ruleChannels } from './operator-notification-dispatch.js';
import { runActionRows, type RunActionsResult, type ScenarioActionRow } from './scenario-actions.js';

export type AutoReplyExecutionAction = Omit<ScenarioActionRow,'action_type'> & {action_type: ScenarioActionRow['action_type'] | 'notify_staff'};
export async function validateAutoReplyOperatorAction(db:D1Database,action:AutoReplyExecutionAction,accountId:string,complete:boolean):Promise<string|null> {
 if(action.action_type!=='notify_staff')return null;
 let config:Record<string,unknown>;try{config=JSON.parse(action.config_json)}catch{return '担当者通知の設定を確認してください'}
 if(!config||typeof config!=='object'||Array.isArray(config))return '担当者通知の設定を確認してください';
 const {notificationRuleId,notificationRuleVersion,message}=config;
 if(action.condition_json!==null)return '担当者通知の条件は自動応答の条件に設定してください';
 if(typeof message!=='string'||message.length>2000||!message.trim())return complete?'担当者通知の本文を入力してください':null;
 if(typeof notificationRuleId!=='string'||!notificationRuleId)return complete?'担当者通知の通知先を選んでください':null;
 const rule=await getNotificationRuleById(db,notificationRuleId,accountId);
 if(!rule||rule.is_active!==1)return '担当者通知が見つからないか、公開されていません';
 if(!Number.isSafeInteger(notificationRuleVersion)||notificationRuleVersion!==Number(rule.version??1))return '担当者通知の設定が変わりました。通知先を選び直してください';
 return null;
}
export async function runAutoReplyAction(db:D1Database,action:AutoReplyExecutionAction,friendId:string,input:{lineAccountId:string|null;sourceEventId:string;env?:Env['Bindings']}):Promise<RunActionsResult> {
 if(action.action_type!=='notify_staff')return runActionRows(db,[action as ScenarioActionRow],friendId);
 if(!input.lineAccountId||await validateAutoReplyOperatorAction(db,action,input.lineAccountId,true))throw new Error('notification_action_invalid');
 const config=JSON.parse(action.config_json) as {notificationRuleId:string;message:string};
 const rule=await getNotificationRuleById(db,config.notificationRuleId,input.lineAccountId);
 if(!rule)throw new Error('notification_rule_not_found');
 if(ruleChannels(rule).includes('email')&&!input.env)throw new Error('notification_email_unavailable');
 const result=await dispatchOperatorRule(db,input.env as Env['Bindings'],rule,{lineAccountId:input.lineAccountId,sourceEventId:input.sourceEventId,message:config.message,executionMode:'automatic'});
 const queued=result.accepted+result.pending+result.duplicate>0;
 return {executed:queued?1:0,failed:result.failed>0||(!queued&&result.excluded===0)?1:0,skippedByCondition:!queued&&result.excluded>0?1:0,skippedByOnce:0,skippedIncomplete:0,scenarioTouched:false};
}
