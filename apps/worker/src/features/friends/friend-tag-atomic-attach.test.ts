import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { attachTagAndFireSideEffects } from './friend-tag-attach.js';
import { fireEvent } from '../../services/event-bus.js';
vi.mock('../../services/event-bus.js', () => ({ fireEvent: vi.fn(async () => undefined) }));
let f: SqliteD1;
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('external access forbidden'); }));
  vi.mocked(fireEvent).mockClear();
  f = createTestD1();
  f.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES ('a','ch','fixture','fake','fake');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('f','Uf','a'); INSERT INTO tags(id,name) VALUES ('t','fixture');`);
});
afterEach(() => { f.raw.close(); vi.unstubAllGlobals(); });
for (const step of ['mileage','scenario_enroll','event_tag_change']) {
  test(`D-04 ${step} 台帳保存直前に停止しても、付与だけ残さず安全に再開する`, async () => {
    f.raw.exec(`CREATE TRIGGER ledger_outage BEFORE INSERT ON friend_tag_side_effect_runs WHEN NEW.step_key='${step}' BEGIN SELECT RAISE(ABORT,'ledger outage'); END;`);
    await expect(attachTagAndFireSideEffects(f.db,'f','t')).rejects.toThrow('ledger outage');
    expect(f.raw.prepare('SELECT COUNT(*) n FROM friend_tags').get()).toEqual({n:0});
    expect(f.raw.prepare('SELECT COUNT(*) n FROM friend_tag_side_effect_runs').get()).toEqual({n:0});
    expect(fireEvent).not.toHaveBeenCalled();
    f.raw.exec('DROP TRIGGER ledger_outage');
    expect(await attachTagAndFireSideEffects(f.db,'f','t')).toEqual({added:true});
    expect(f.raw.prepare('SELECT COUNT(*) n FROM friend_tag_side_effect_runs WHERE status=\'completed\'').get()).toEqual({n:3});
    expect(await attachTagAndFireSideEffects(f.db,'f','t')).toEqual({added:false});
    expect(fireEvent).toHaveBeenCalledTimes(1);
  });
}
test('D-04 保存応答を失っても3工程のpendingが残り、同じタグで補完する', async () => {
  const interrupted = { ...f.db, batch: async (statements: D1PreparedStatement[]) => {
    await f.db.batch(statements); throw new Error('process interrupted after commit');
  } } as unknown as D1Database;
  await expect(attachTagAndFireSideEffects(interrupted,'f','t')).rejects.toThrow('process interrupted');
  expect(f.raw.prepare("SELECT COUNT(*) n FROM friend_tag_side_effect_runs WHERE status='pending'").get()).toEqual({n:3});
  expect(fireEvent).not.toHaveBeenCalled();
  expect(await attachTagAndFireSideEffects(f.db,'f','t')).toEqual({added:false});
  expect(f.raw.prepare("SELECT COUNT(*) n FROM friend_tag_side_effect_runs WHERE status='completed'").get()).toEqual({n:3});
  expect(fireEvent).toHaveBeenCalledTimes(1);
  expect(f.raw.prepare("SELECT COUNT(*) n FROM engagement_events WHERE event_type='tag_added'").get()).toEqual({n:1});
});
test('D-04 二つの付与が並行しても、工程を開き直さず1回だけ発火する', async () => {
  await Promise.all([attachTagAndFireSideEffects(f.db,'f','t'),attachTagAndFireSideEffects(f.db,'f','t')]);
  expect(f.raw.prepare("SELECT COUNT(*) n FROM friend_tag_side_effect_runs WHERE status='completed'").get()).toEqual({n:3});
  expect(fireEvent).toHaveBeenCalledTimes(1);
  expect(f.raw.prepare("SELECT COUNT(*) n FROM engagement_events WHERE event_type='tag_added'").get()).toEqual({n:1});
});
