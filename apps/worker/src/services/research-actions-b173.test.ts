import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { emptyLayout, type FormAction } from '@line-crm/shared';
import { applyFormLayoutEffects } from './form-layout-effects.js';
vi.mock('./event-bus.js', () => ({ fireEvent: vi.fn() }));
let db: SqliteD1;
beforeEach(() => {
  db = createTestD1();
  db.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES ('a1','ch1','試験','token','secret');
    UPDATE line_accounts SET tenant_id='00000000-0000-4000-8000-000000000001';
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('f1','U1','a1');
    INSERT INTO friend_fields(id,name,field_key,type) VALUES ('field1','来店数','visits','number');
    INSERT INTO support_marks(id,name) VALUES ('mark1','確認済み');
    INSERT INTO common_vars(id,line_account_id,name,var_key,value) VALUES ('var1','a1','回答数','count','0');
    INSERT INTO templates(id,name,message_type,message_content,line_account_id,published_version) VALUES ('tpl1','お礼','text','お礼の文','a1',1);
    INSERT INTO reminders(id,name,line_account_id,lifecycle_status) VALUES ('rem1','次の案内','a1','published');`);
});
afterEach(() => db.raw.close());
function action(actionType: Extract<FormAction, { kind: 'research_action' }>['actionType'], config: Record<string, unknown>): FormAction { return { kind: 'research_action', actionType, config, onFailure: 'continue' }; }
test('情報欄・対応マーク・共通情報を更新し、テキストとテンプレートを実送信、リマインダへ登録する', async () => {
  const layout = emptyLayout(); layout.options.afterActions = [action('friend_field', { fieldId: 'field1', op: 'add', value: '2' }), action('support_mark', { markId: 'mark1' }), action('common_var', { varKey: 'count', op: 'add', value: '1' }), action('send_message', { content: '回答ありがとう' }), action('send_template', { templateId: 'tpl1' }), action('reminder', { reminderId: 'rem1' })];
  const pushText = vi.fn(async (_text: string, _suffix?: string) => undefined); const onEffectComplete = vi.fn(async () => undefined);
  const result = await applyFormLayoutEffects({ db: db.db, formId: 'form1', friendId: 'f1', layout, answers: {}, idempotencyPrefix: 'submission1', pushText, onEffectComplete });
  expect(result.failedEffects).toEqual([]);
  expect(db.raw.prepare('SELECT value FROM friend_field_values').all()).toEqual([{ value: '2' }]);
  expect(db.raw.prepare('SELECT support_mark_id FROM friends').get()).toEqual({ support_mark_id: 'mark1' });
  expect(db.raw.prepare('SELECT value FROM common_vars').get()).toEqual({ value: '1' });
  expect(pushText.mock.calls.map(call => call[0])).toEqual(['回答ありがとう', 'お礼の文']);
  expect(db.raw.prepare('SELECT friend_id,reminder_id,source_event_id FROM friend_reminders').all()).toEqual([{ friend_id: 'f1', reminder_id: 'rem1', source_event_id: 'submission1:reminder:afterAction:5' }]);
  expect(onEffectComplete).toHaveBeenCalledTimes(6);
  const again = await applyFormLayoutEffects({ db: db.db, formId: 'form1', friendId: 'f1', layout, answers: {}, idempotencyPrefix: 'submission1', pushText, skipEffect: () => true });
  expect(again.failedEffects).toEqual([]); expect(pushText).toHaveBeenCalledTimes(2);
  expect(db.raw.prepare('SELECT value FROM common_vars').get()).toEqual({ value: '1' });
});
test('送信経路がないとき・使えないイベントのときは完了と偽らない', async () => {
  const layout = emptyLayout(); layout.options.afterActions = [action('send_message', { content: '本文' }), action('event_booking', { eventId: 'event1' })];
  const result = await applyFormLayoutEffects({ db: db.db, formId: 'form1', friendId: 'f1', layout, answers: {} });
  expect(result.failedEffects).toEqual(['afterAction:0', 'afterAction:1']);
});
