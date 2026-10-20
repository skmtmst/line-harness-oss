import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { enrollFriendInScenario, publishScenarioVersion } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { runScenarioOp } from './scenario-actions.js';

let f: SqliteD1;
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('external access forbidden'); }));
  f = createTestD1();
  f.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES ('a','ch','fixture','fake','fake');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('f','Uf','a');
    INSERT INTO scenarios(id,name,line_account_id,trigger_type,allow_concurrent) VALUES ('old','元','a','manual',1),('new','先','a','manual',1);
    INSERT INTO scenario_steps(id,scenario_id,step_order,delay_minutes,message_type,message_content) VALUES ('s-old','old',0,10,'text','fake'),('s-new','new',0,10,'text','fake');`);
  for (const id of ['old', 'new']) {
    await publishScenarioVersion(f.db, id, { staffId: null, idempotencyKey: id });
    expect(await enrollFriendInScenario(f.db, 'f', id)).not.toBeNull();
  }
  f.raw.exec("UPDATE friend_scenarios SET status='paused' WHERE scenario_id='new'");
});
afterEach(() => { f.raw.close(); vi.unstubAllGlobals(); });

for (const restart of ['from_read', 'from_start'] as const) {
for (const changed of ['completed', 'unpublished'] as const) {
  test(`D-03 仲間 ${restart}/${changed}: 読み取り後に先を開始できなくなっても元を止めない`, async () => {
    if (restart === 'from_start') f.raw.exec("DELETE FROM friend_scenarios WHERE scenario_id='new'");
    const batch = f.db.batch.bind(f.db);
    f.db.batch = async <T = unknown>(statements: D1PreparedStatement[]) => {
      f.raw.exec(changed === 'completed'
        ? "UPDATE friend_scenarios SET status='completed' WHERE scenario_id='new'"
        : "UPDATE scenarios SET current_published_version_id=NULL WHERE id='new'");
      return batch<T>(statements);
    };
    await expect(runScenarioOp(f.db, 'f', 'old', {
      op: 'start', scenarioId: 'new', restart, rememberPrevious: true,
    }, 'answer')).rejects.toThrow();
    expect(f.raw.prepare("SELECT status FROM friend_scenarios WHERE scenario_id='old'").get()).toEqual({ status: 'active' });
    expect(f.raw.prepare("SELECT status FROM friend_scenarios WHERE scenario_id='new'").get()).toEqual({ status: changed === 'completed' ? 'completed' : restart === 'from_read' ? 'paused' : 'active' });
  });
}
}
