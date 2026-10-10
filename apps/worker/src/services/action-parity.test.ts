import { beforeEach, expect, test, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { createAutomationActionExecutors } from './automation-action-executors.js';
import { runActionRows, type ScenarioActionRow } from './scenario-actions.js';
import type { AutomationActionContext } from './automation-engine.js';
const line = vi.hoisted(() => ({ pushMessage: vi.fn(async () => ({ requestId: 'accepted' })) }));
vi.mock('@line-crm/line-sdk', async original => ({ ...await original<any>(), LineClient: class { pushMessage = line.pushMessage } }));
let db: ReturnType<typeof createTestD1>;
beforeEach(() => {
  vi.clearAllMocks(); db = createTestD1();
  db.raw.exec(`INSERT INTO tenants(id,name) VALUES('tenant','店');
    INSERT INTO line_accounts(id,channel_id,name,tenant_id,channel_access_token,channel_secret,is_active) VALUES('a','channel','店','tenant','token','secret',1),('b','other','別店','tenant','other','secret',1);
    INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('f','U-f','a','花子');
    INSERT INTO templates(id,name,message_type,message_content,line_account_id) VALUES('t','案内','text','こんにちは','a');
    INSERT INTO reminders(id,name,line_account_id,trigger_type,lifecycle_status) VALUES('r','翌日の案内','a','manual','published'),('foreign','別店','b','manual','published');`);
});
function context(type: string, params: Record<string,unknown>, event = 'event'): AutomationActionContext {
  return { db:db.db,runId:'run',lineAccountId:'a',automationId:'auto',automationVersionId:'v',friendId:'f',sourceEventId:event,inputEvent:{},action:{id:type,type,params,onFailure:'stop'},stepExecutionId:'step',idempotencyKey:event+':'+type,attemptNumber:1,commonActionVersionId:null,isTest:false };
}
function row(type: ScenarioActionRow['action_type'], config: unknown): ScenarioActionRow {
  return { id:type,scenario_id:'',hook:'choice_selected',step_id:null,choice_index:null,sort_order:0,action_type:type,config_json:JSON.stringify(config),condition_json:null,repeat_on_refire:1 };
}
test('シナリオ・自動応答で本文とテンプレートを実際に送る', async () => {
  const result = await runActionRows(db.db,[row('send_message',{content:'受付しました'}),row('send_template',{templateId:'t'})],'f');
  expect(result.failed).toBe(0); expect(line.pushMessage).toHaveBeenCalledTimes(2);
  expect(line.pushMessage.mock.calls.map(call => (call as unknown as [string,Array<{text:string}>])[1][0].text)).toEqual(['受付しました','こんにちは']);
});
test('リマインダを開始・解除し、同じ出来事では重複登録しない', async () => {
  const executors = createAutomationActionExecutors();
  const input = context('start_reminder',{reminderId:'r'});
  expect(executors.start_reminder).toBeTypeOf('function');
  await executors.start_reminder(input); await executors.start_reminder(input);
  expect(db.raw.prepare('SELECT status FROM friend_reminders').all()).toEqual([{status:'active'}]);
  await executors.stop_reminder(context('stop_reminder',{reminderId:'r'}));
  expect(db.raw.prepare('SELECT status FROM friend_reminders').all()).toEqual([{status:'cancelled'}]);
});
test('マイル付与は実行一覧から動き、再送でも二重に付かない', async () => {
  const executors = createAutomationActionExecutors();
  expect(executors.grant_mileage).toBeTypeOf('function');
  const input=context('grant_mileage',{amount:10});
  await executors.grant_mileage(input); await executors.grant_mileage(input);
  expect(db.raw.prepare('SELECT amount FROM mileage_ledger').all()).toEqual([{amount:10}]);
});
test('別店のリマインダへは登録しない', async () => {
  const executors=createAutomationActionExecutors();
  expect(executors.start_reminder).toBeTypeOf('function');
  await expect(executors.start_reminder(context('start_reminder',{reminderId:'foreign'}))).rejects.toThrow();
  expect(db.raw.prepare('SELECT COUNT(*) n FROM friend_reminders').get()).toEqual({n:0});
});

test('ウェビナー完了のタグ以外の処理も実行し、再送で重複しない', async () => {
  db.raw.exec(`INSERT INTO webinars(id,account_id,title,slug,created_at,updated_at) VALUES('w','a','相談','consultation','2026-10-09','2026-10-09');
    INSERT INTO webinar_actions(id,webinar_id,trigger,action_type,config_json,position,version,enabled,created_at,updated_at)
      VALUES('wa','w','completed','send_message','{"content":"参加ありがとうございます"}',0,1,1,'2026-10-09','2026-10-09');`);
  const { runWebinarTriggerActions } = await import('./webinar-action-runner.js');
  const input = {webinarId:'w',friendId:'f',sessionStartAt:1,trigger:'completed' as const};
  await runWebinarTriggerActions(db.db,input); await runWebinarTriggerActions(db.db,input);
  expect(line.pushMessage).toHaveBeenCalledTimes(1);
  expect(db.raw.prepare('SELECT status FROM webinar_action_executions').all()).toEqual([{status:'succeeded'}]);
});

test('同じ出来事の再送は送らず、新しい出来事では送り直す', async () => {
  const actions=[row('send_message',{content:'受付しました'})];
  await runActionRows(db.db,actions,'f',{sourceEventId:'first'});
  await runActionRows(db.db,actions,'f',{sourceEventId:'first'});
  await runActionRows(db.db,actions,'f',{sourceEventId:'second'});
  expect(line.pushMessage).toHaveBeenCalledTimes(2);
});
test('別店のテンプレートは送らず、失敗として数える', async () => {
  db.raw.exec(`UPDATE templates SET line_account_id='b' WHERE id='t'`);
  const result=await runActionRows(db.db,[row('send_template',{templateId:'t'})],'f');
  expect(result.failed).toBe(1);expect(result.executed).toBe(0);expect(line.pushMessage).not.toHaveBeenCalled();
});
test('シナリオのリマインダ操作も登録と解除を実際に行う', async () => {
  await runActionRows(db.db,[row('reminder',{reminderId:'r'})],'f',{sourceEventId:'start'});
  expect(db.raw.prepare('SELECT status FROM friend_reminders').all()).toEqual([{status:'active'}]);
  await runActionRows(db.db,[row('reminder',{reminderId:'r',op:'stop'})],'f',{sourceEventId:'stop'});
  expect(db.raw.prepare('SELECT status FROM friend_reminders').all()).toEqual([{status:'cancelled'}]);
});
