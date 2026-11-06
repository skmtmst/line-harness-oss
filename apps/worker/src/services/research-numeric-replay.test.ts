import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { emptyLayout, type FormAction } from '@line-crm/shared';

import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { applyFormLayoutEffects } from '../features/forms/form-layout-effects.js';
vi.mock('./event-bus.js', () => ({ fireEvent: vi.fn() }));
let fixture: SqliteD1;
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('external access forbidden'); }));
  fixture = createTestD1();
  fixture.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES ('a','ch','fixture','fake','fake','00000000-0000-4000-8000-000000000001');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('f','Uf','a');
    INSERT INTO friend_fields(id,name,field_key,type) VALUES ('field','回答数','count','number');
    INSERT INTO common_vars(id,line_account_id,name,var_key,value) VALUES ('var','a','回答数','count','10');
    INSERT INTO friend_field_values(friend_id,field_id,value) VALUES ('f','field','10');`);
});
afterEach(() => { fixture.raw.close(); vi.unstubAllGlobals(); });
for (const actionType of ['common_var', 'friend_field'] as const) {
  for (const op of ['add','sub'] as const) {
    test(`D-01 ${actionType}/${op}: 完了記録直前の中断後も同じ回答の増減は1回`, async () => {
      const layout = emptyLayout();
      layout.options.afterActions = [{ kind: 'research_action', actionType, config: { varKey: 'count', fieldId: 'field', op, value: '2' }, onFailure: 'stop' } as FormAction];
      const input = { db: fixture.db, formId: 'form', friendId: 'f', layout, answers: {}, idempotencyPrefix: 'submission-a' };
      await expect(applyFormLayoutEffects({ ...input, onEffectComplete: async () => { throw new Error('checkpoint lost'); } })).rejects.toThrow('checkpoint lost');
      expect((await applyFormLayoutEffects(input)).failedEffects).toEqual([]);
      const query = actionType === 'common_var' ? 'SELECT value FROM common_vars' : 'SELECT value FROM friend_field_values';
      expect(fixture.raw.prepare(query).get()).toEqual({ value: op === 'add' ? '12' : '8' });
      // 別の回答は別の出来事。最初の回答の再開が終わっても加減算を止めない。
      expect((await applyFormLayoutEffects({ ...input, idempotencyPrefix: 'submission-b' })).failedEffects).toEqual([]);
      expect(fixture.raw.prepare(query).get()).toEqual({ value: op === 'add' ? '14' : '6' });
      if (actionType === 'common_var') expect(fixture.raw.prepare('SELECT COUNT(*) AS n FROM common_var_versions').get()).toEqual({ n: 2 });
    });
  }
}
test('D-01 受領記録の保存失敗は数値と履歴を戻し、再開後に1回だけ加算する', async () => {
  const layout = emptyLayout();
  layout.options.afterActions = [{ kind: 'research_action', actionType: 'common_var', config: { varKey: 'count', op: 'add', value: '2' }, onFailure: 'stop' }];
  const input = { db: fixture.db, formId: 'form', friendId: 'f', layout, answers: {}, idempotencyPrefix: 'submission' };
  fixture.raw.exec(`CREATE TRIGGER receipt_outage BEFORE INSERT ON audit_events WHEN NEW.source_kind='scenario_numeric_action' BEGIN SELECT RAISE(ABORT,'receipt outage'); END;`);
  expect((await applyFormLayoutEffects(input)).failedEffects).toEqual(['afterAction:0']);
  expect(fixture.raw.prepare('SELECT value FROM common_vars').get()).toEqual({ value: '10' });
  expect(fixture.raw.prepare('SELECT COUNT(*) AS n FROM common_var_versions').get()).toEqual({ n: 0 });
  fixture.raw.exec('DROP TRIGGER receipt_outage');
  expect((await applyFormLayoutEffects(input)).failedEffects).toEqual([]);
  expect(fixture.raw.prepare('SELECT value FROM common_vars').get()).toEqual({ value: '12' });
});
test('D-01 同じ回答の並行再開も加算は1回', async () => {
  const layout = emptyLayout();
  layout.options.afterActions = [{ kind: 'research_action', actionType: 'common_var', config: { varKey: 'count', op: 'add', value: '2' }, onFailure: 'stop' }];
  const input = { db: fixture.db, formId: 'form', friendId: 'f', layout, answers: {}, idempotencyPrefix: 'submission' };
  expect((await Promise.all([applyFormLayoutEffects(input), applyFormLayoutEffects(input)])).map(r => r.failedEffects)).toEqual([[], []]);
  expect(fixture.raw.prepare('SELECT value FROM common_vars').get()).toEqual({ value: '12' });
});
