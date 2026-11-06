import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { emptyLayout, type FormAction } from '@line-crm/shared';

import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { applyFormLayoutEffects } from './form-layout-effects.js';
import { fireEvent } from '../../services/event-bus.js';
vi.mock('../../services/event-bus.js', () => ({ fireEvent: vi.fn(async () => undefined) }));
let f: SqliteD1;
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('external access forbidden'); }));
  vi.mocked(fireEvent).mockReset().mockResolvedValue(undefined);
  f = createTestD1();
  f.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES ('a','ch','fixture','fake','fake','00000000-0000-4000-8000-000000000001');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('f','Uf','a'); INSERT INTO tags(id,name,line_account_id) VALUES ('t','fixture','a'); INSERT INTO friend_tags(friend_id,tag_id) VALUES ('f','t');`);
});
afterEach(() => { f.raw.close(); vi.unstubAllGlobals(); });
for (const kind of ['tag','research_action'] as const) {
  test(`D-05 ${kind}: フォームから解除したタグを自動化へ1回だけ知らせる`, async () => {
    const layout = emptyLayout();
    layout.options.afterActions = [kind === 'tag' ? {kind:'tag',op:'remove',tagIds:['t']} : {kind:'research_action',actionType:'tag',config:{op:'remove',tagIds:['t']},onFailure:'stop'}] as FormAction[];
    const input = {db:f.db,friendId:'f',formId:'form',layout,answers:{},idempotencyPrefix:'answer'};
    expect((await applyFormLayoutEffects(input)).failedEffects).toEqual([]);
    expect(fireEvent).toHaveBeenCalledWith(f.db,'tag_change',{
      friendId:'f',eventData:{tagId:'t',action:'remove'},
      sourceEventId:expect.stringMatching(/^tag:f:t:remove:.+$/),sourceKind:'friend_tag',
      occurredAt:expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    },undefined,'a');
    expect(f.raw.prepare('SELECT COUNT(*) n FROM friend_tags').get()).toEqual({n:0});
    await applyFormLayoutEffects(input);
    expect(fireEvent).toHaveBeenCalledTimes(1);
  });
}
test('D-05 タグ解除の通知結果が不明なら再送せず、工程失敗と確認通知を残す', async () => {
  vi.mocked(fireEvent).mockRejectedValueOnce(new Error('accepted then interrupted'));
  const layout = emptyLayout(); layout.options.afterActions = [{kind:'tag',op:'remove',tagIds:['t']}];
  const input = {db:f.db,friendId:'f',formId:'form',layout,answers:{},idempotencyPrefix:'answer'};
  expect((await applyFormLayoutEffects(input)).failedEffects).toEqual(['afterAction:0']);
  expect((await applyFormLayoutEffects(input)).failedEffects).toEqual(['afterAction:0']);
  expect(fireEvent).toHaveBeenCalledTimes(1);
  expect(f.raw.prepare("SELECT COUNT(*) n FROM notifications WHERE event_type='friend_tag_detach_stuck'").get()).toEqual({n:1});
});
test('D-05 解除と記録の保存失敗はタグを戻し、再開で1回だけ発火する', async () => {
  f.raw.exec(`CREATE TRIGGER receipt_outage BEFORE INSERT ON audit_events WHEN NEW.source_kind='friend_tag_detach' BEGIN SELECT RAISE(ABORT,'receipt outage'); END;`);
  const layout = emptyLayout(); layout.options.afterActions = [{kind:'tag',op:'remove',tagIds:['t']}];
  const input = {db:f.db,friendId:'f',formId:'form',layout,answers:{},idempotencyPrefix:'answer'};
  expect((await applyFormLayoutEffects(input)).failedEffects).toEqual(['afterAction:0']);
  expect(f.raw.prepare('SELECT COUNT(*) n FROM friend_tags').get()).toEqual({n:1});
  expect(fireEvent).not.toHaveBeenCalled();
  f.raw.exec('DROP TRIGGER receipt_outage');
  expect((await applyFormLayoutEffects(input)).failedEffects).toEqual([]);
  expect(fireEvent).toHaveBeenCalledTimes(1);
});
