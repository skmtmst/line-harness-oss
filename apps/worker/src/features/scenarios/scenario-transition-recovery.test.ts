import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { publishScenarioVersion, enrollFriendInScenario } from '@line-crm/db';
import { emptyLayout } from '@line-crm/shared';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { applyFormLayoutEffects } from '../forms/form-layout-effects.js';
import { runScenarioOp } from './scenario-actions.js';
vi.mock('../../services/event-bus.js', () => ({ fireEvent: vi.fn() }));
let f: SqliteD1;
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('external access forbidden'); }));
  f = createTestD1();
  f.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES ('a','ch','fixture','fake','fake','00000000-0000-4000-8000-000000000001');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('f','Uf','a');
    INSERT INTO scenarios(id,name,line_account_id,trigger_type) VALUES ('old','元','a','manual'),('new','先','a','manual');
    INSERT INTO scenario_steps(id,scenario_id,step_order,delay_minutes,message_type,message_content) VALUES ('step-old','old',0,10,'text','fake'),('step-new','new',0,10,'text','fake');`);
  await publishScenarioVersion(f.db, 'old', { staffId: null, idempotencyKey: 'old' });
  await enrollFriendInScenario(f.db, 'f', 'old');
});
afterEach(() => { f.raw.close(); vi.unstubAllGlobals(); });
for (const unavailable of ['unpublished','stopped','nonconcurrent'] as const) {
  test(`D-03 ${unavailable}: 登録できない先へ移すと失敗が残り、元は動き続ける`, async () => {
    if (unavailable !== 'unpublished') await publishScenarioVersion(f.db, 'new', { staffId: null, idempotencyKey: 'new' });
    if (unavailable === 'stopped') f.raw.exec("UPDATE scenarios SET is_active=0 WHERE id='new'");
    if (unavailable === 'nonconcurrent') f.raw.exec("UPDATE scenarios SET allow_concurrent=0 WHERE id='new'; INSERT INTO friend_scenarios(id,friend_id,scenario_id,status,started_at,updated_at) VALUES ('other-running','f','third','active','2000-01-01','2000-01-01')");
    const layout = emptyLayout();
    layout.options.afterActions = [{ kind: 'research_action', actionType: 'scenario', config: { op: 'start', scenarioId: 'new', rememberPrevious: true }, onFailure: 'stop' }];
    const complete = vi.fn();
    const result = await applyFormLayoutEffects({ db: f.db, formId: 'form', friendId: 'f', layout, answers: {}, idempotencyPrefix: 'submission', onEffectComplete: complete });
    expect(result.failedEffects).toEqual(['afterAction:0']);
    expect(complete).not.toHaveBeenCalled();
    expect(f.raw.prepare("SELECT status FROM friend_scenarios WHERE scenario_id='old'").get()).toEqual({ status: 'active' });
    expect(f.raw.prepare("SELECT COUNT(*) AS n FROM friend_scenarios WHERE scenario_id='new'").get()).toEqual({ n: 0 });
  });
}
test('D-03 通常フォームからの開始も、未公開なら完了と偽らない', async () => {
  const layout = emptyLayout(); layout.options.afterActions = [{ kind:'scenario', op:'start', scenarioId:'new' }];
  const result = await applyFormLayoutEffects({ db:f.db, formId:'form',friendId:'f',layout,answers:{} });
  expect(result.failedEffects).toEqual(['afterAction:0']);
});
test('D-03 成功した先へ登録してから元を止め、戻り先を保つ', async () => {
  await publishScenarioVersion(f.db, 'new', { staffId: null, idempotencyKey: 'new' });
  await runScenarioOp(f.db, 'f', 'old', { op: 'start', scenarioId: 'new', rememberPrevious: true });
  expect(f.raw.prepare('SELECT scenario_id,status,previous_scenario_id FROM friend_scenarios ORDER BY scenario_id').all()).toEqual([
    { scenario_id: 'new', status: 'active', previous_scenario_id: 'old' }, { scenario_id: 'old', status: 'paused', previous_scenario_id: null },
  ]);
});
test('D-03 元の停止に失敗しても、同じ回答の再開で先を増やさず収束する', async () => {
  await publishScenarioVersion(f.db, 'new', { staffId: null, idempotencyKey: 'new' });
  f.raw.exec(`CREATE TRIGGER pause_outage BEFORE UPDATE OF status ON friend_scenarios WHEN NEW.status='paused' BEGIN SELECT RAISE(ABORT,'pause outage'); END;`);
  await expect(runScenarioOp(f.db, 'f', 'old', { op:'start', scenarioId:'new',rememberPrevious:true }, 'answer')).rejects.toThrow('pause outage');
  expect(f.raw.prepare("SELECT status FROM friend_scenarios WHERE scenario_id='old'").get()).toEqual({status:'active'});
  f.raw.exec('DROP TRIGGER pause_outage');
  await runScenarioOp(f.db, 'f', 'old', { op:'start', scenarioId:'new',rememberPrevious:true }, 'answer');
  expect(f.raw.prepare("SELECT COUNT(*) n FROM friend_scenarios WHERE scenario_id='new'").get()).toEqual({n:1});
  expect(f.raw.prepare("SELECT status FROM friend_scenarios WHERE scenario_id='old'").get()).toEqual({status:'paused'});
});
