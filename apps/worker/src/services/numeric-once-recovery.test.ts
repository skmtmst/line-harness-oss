import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { runActionRows, type ScenarioActionRow } from '../features/scenarios/scenario-actions.js';

let f: SqliteD1;
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('external access forbidden'); }));
  f = createTestD1();
  f.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES ('a','ch','fixture','fake','fake');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('f','Uf','a');
    INSERT INTO friend_fields(id,name,field_key,type) VALUES ('field','fixture','count','number');
    INSERT INTO friend_field_values(friend_id,field_id,value) VALUES ('f','field','10');
    INSERT INTO common_vars(id,line_account_id,name,var_key,value) VALUES ('var','a','fixture','count','10');`);
});
afterEach(() => { f.raw.close(); vi.unstubAllGlobals(); });

for (const actionType of ['common_var', 'friend_field'] as const) {
  test(`D-01 仲間 ${actionType}: 1回だけの記録が落ちても別イベント・別公開版で二重加算しない`, async () => {
    const action: ScenarioActionRow = {
      id: 'version-1-action', fires_key: 'original-action', scenario_id: 'scenario', hook: 'step_sent',
      step_id: null, choice_index: null, sort_order: 0, action_type: actionType,
      config_json: JSON.stringify({ varKey: 'count', fieldId: 'field', op: 'add', value: '2' }),
      condition_json: null, repeat_on_refire: 0,
    };
    f.raw.exec(`CREATE TRIGGER once_outage BEFORE INSERT ON scenario_pinned_action_fires BEGIN SELECT RAISE(ABORT,'once checkpoint lost'); END;`);
    expect((await runActionRows(f.db, [action], 'f', { fires: 'pinned', accountId: 'a', sourceEventId: 'event-a' })).failed).toBe(1);
    f.raw.exec('DROP TRIGGER once_outage');
    expect((await runActionRows(f.db, [{ ...action, id: 'version-2-action' }], 'f', { fires: 'pinned', accountId: 'a', sourceEventId: 'event-b' })).failed).toBe(0);
    const table = actionType === 'common_var' ? 'common_vars' : 'friend_field_values';
    expect(f.raw.prepare(`SELECT value FROM ${table}`).get()).toEqual({ value: '12' });
    expect(f.raw.prepare('SELECT COUNT(*) AS n FROM scenario_pinned_action_fires').get()).toEqual({ n: 1 });
  });
}
