import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { processAutomationRun, processDueAutomationRuns, startAutomationRun } from './automation-engine.js';
import { createAutomationDraftFromTemplate, getAutomationDraft, updateAutomationDraft } from './automation-drafts.js';
import { createCommonAction, getCommonActionDetail } from '../../services/common-actions.js';
import { scheduleAutomationWait } from './automation-wait.js';
import { getRun, getStep } from './automation-run-state.js';

let t: SqliteD1;
const startAt = '2026-03-09T18:00:00.000Z';
beforeEach(() => {
  t = createTestD1();
  t.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','店舗','t','s');
    INSERT INTO friends(id,line_account_id,line_user_id,display_name) VALUES('f','a','UID','友だち');
    INSERT INTO rt_organizations(id,account_id,name) VALUES('o','a','組織');
    INSERT INTO rt_stores(id,organization_id,name,code,line_account_id,timezone) VALUES('s','o','店','S','a','America/New_York');`);
});
afterEach(() => t.raw.close());

async function startWait(params: Record<string, unknown>, eventType = 'friend_add', sourceId = 'event', createdAt = startAt) {
  t.raw.prepare(`INSERT INTO automation_definitions(id,line_account_id,name,status) VALUES('auto','a','待つ','active')`).run();
  const actions = [{ id: 'wait', type: 'wait', params, onFailure: 'stop' }, { id: 'after', type: 'record', params: {}, onFailure: 'stop' }];
  t.raw.prepare(`INSERT INTO automation_versions(id,automation_id,version_number,status,trigger_type,action_config,published_at)
    VALUES('v','auto',1,'published',?,?,?)`).run(eventType, JSON.stringify(actions), createdAt);
  t.raw.exec("UPDATE automation_definitions SET current_published_version_id='v' WHERE id='auto'");
  if (eventType.startsWith('restaurant.') && sourceId === 'event') sourceId = 'rt:r:2:restaurant.departed';
  const result = await startAutomationRun(t.db, { lineAccountId: 'a', automationId: 'auto', sourceEventId: sourceId,
    idempotencyKey: sourceId, friendId: 'f', inputEvent: { type: eventType }, conditionMatched: true, now: createdAt });
  return result.runId!;
}
function origin(at = '2026-03-07T22:00:00Z') {
  t.raw.prepare(`INSERT INTO rt_reservations(id,store_id,source,customer_name,line_uid,guest_count,starts_at,ends_at,status)
    VALUES('r','s','line','友だち','UID',2,?,?,'confirmed')`).run(new Date(Date.parse(at)-7200000).toISOString(),new Date(Date.parse(at)-1800000).toISOString());
  t.raw.prepare("INSERT INTO rt_seat_visit_marks(id,reservation_id,store_id,kind,marked_at) VALUES('visit','r','s','visited',?)").run(new Date(Date.parse(at)-3600000).toISOString());
  t.raw.prepare("UPDATE rt_reservations SET status='visited',departed_at=?,customer_version=customer_version+1 WHERE id='r'").run(at);
  t.raw.prepare("UPDATE rt_reservation_events SET occurred_at=? WHERE id='rt:r:2:restaurant.departed'").run(at);
}
const runState = (id: string) => t.raw.prepare('SELECT status,resume_at FROM automation_runs WHERE id=?').get(id);

it('指定した5分で後続処理が1回だけ動く', async () => {
  const id = await startWait({ durationMinutes: 5 }), record = vi.fn(async () => {});
  expect(await processAutomationRun(t.db, id, { now: '2026-03-09T19:00:00.000Z', executors: { record } })).toBe('waiting');
  expect(runState(id)).toEqual({ status: 'waiting', resume_at: '2026-03-09T19:05:00.000Z' });
  await processDueAutomationRuns(t.db, { now: '2026-03-09T19:04:59.000Z', executors: { record } });
  expect(record).not.toHaveBeenCalled();
  await processDueAutomationRuns(t.db, { now: '2026-03-09T19:05:00.000Z', executors: { record } });
  await processDueAutomationRuns(t.db, { now: '2026-03-09T19:06:00.000Z', executors: { record } });
  expect(record).toHaveBeenCalledTimes(1);
});
it('1年を超える公開済みの待機も実行できる', async () => {
  const id = await startWait({ durationMinutes: 525605 });
  expect(await processAutomationRun(t.db, id, { now: startAt })).toBe('waiting');
  expect(runState(id)).toEqual({ status: 'waiting', resume_at: '2027-03-09T18:05:00.000Z' });
});

it('待機時刻の記録が失敗しても、手順だけを待機中にしない', async () => {
  const params = { durationMinutes: 5 }, id = await startWait(params);
  t.raw.exec(`UPDATE automation_runs SET status='running' WHERE id='${id}';
    UPDATE automation_run_steps SET status='running' WHERE step_key='wait';
    CREATE TRIGGER wait_write_fault BEFORE UPDATE ON automation_runs WHEN NEW.resume_at='2026-03-09T18:05:00.000Z'
    BEGIN SELECT RAISE(ABORT,'wait_write_fault'); END;`);
  const run = await getRun(t.db, id), step = await getStep(t.db, id, 'wait');
  await expect(scheduleAutomationWait(t.db,run!,step!,params,startAt,{})).rejects.toThrow('wait_write_fault');
  expect(t.raw.prepare('SELECT status,output_json FROM automation_run_steps WHERE step_key=?').get('wait')).toEqual({ status: 'running', output_json: null });
  expect(runState(id)).toEqual({ status: 'running', resume_at: null });
});
it('取り消された実行の手順を待機中に戻さない', async () => {
  const params = { durationMinutes: 5 }, id = await startWait(params);
  t.raw.prepare("UPDATE automation_runs SET status='running' WHERE id=?").run(id);
  t.raw.exec("UPDATE automation_run_steps SET status='running' WHERE step_key='wait'");
  const run = await getRun(t.db, id), step = await getStep(t.db, id, 'wait');
  t.raw.prepare("UPDATE automation_runs SET status='cancelled' WHERE id=?").run(id);
  await scheduleAutomationWait(t.db,run!,step!,params,startAt,{});
  expect(t.raw.prepare('SELECT status,output_json FROM automation_run_steps WHERE step_key=?').get('wait')).toEqual({ status: 'running', output_json: null });
  expect(runState(id)).toEqual({ status: 'cancelled', resume_at: null });
});
it('飲食以外の翌日は実行開始の日本時間で固定し、実行の遅れで動かさない', async () => {
  const id = await startWait({ mode: 'next_day', sendAtTime: '10:00' });
  expect(await processAutomationRun(t.db, id, { now: '2026-03-11T05:00:00.000Z' })).toBe('waiting');
  expect(runState(id)).toEqual({ status: 'waiting', resume_at: '2026-03-11T01:00:00.000Z' });
});
it('飲食の翌日は保存済みの出来事と店の暦を使い、夏時間も処理の遅れも基準を変えない', async () => {
  origin();
  const id = await startWait({ mode: 'next_day', sendAtTime: '02:30' }, 'restaurant.departed', 'event', '2026-03-07T22:00:00.000Z');
  expect(await processAutomationRun(t.db, id, { now: '2026-03-08T08:00:00.000Z' })).toBe('waiting');
  expect(runState(id)).toEqual({ status: 'waiting', resume_at: '2026-03-08T07:30:00.000Z' });
});
it.each(['missing', 'account', 'friend', 'type'])('飲食の出来事が一致しなければ待機・後続処理を作らない: %s', async (kind) => {
  if (kind !== 'missing') {
    origin();
    if (kind === 'account') t.raw.exec("UPDATE rt_reservation_events SET line_account_id='other'");
    if (kind === 'friend') t.raw.exec("UPDATE rt_reservation_events SET friend_id='other'");
    if (kind === 'type') t.raw.exec("UPDATE rt_reservation_events SET event_type='restaurant.arrived'");
  }
  const id = await startWait({ mode: 'next_day', sendAtTime: '10:00' }, 'restaurant.departed'), record = vi.fn(async () => {});
  expect(id).toBeNull();
  expect(record).not.toHaveBeenCalled();
  expect(t.raw.prepare('SELECT count(*) AS total FROM automation_runs').get()).toEqual({ total: 0 });
});
it.each([{ durationMinutes: 30 }, { mode: 'next_day', sendAtTime: '10:15' }])('下書きと共通アクションの両方で保存して読み直せる: %j', async (params) => {
  const created = await createAutomationDraftFromTemplate(t.db, { templateKey: 'received-message-tag', lineAccountId: 'a', operationKey: 'wait-edit-operation' });
  const actions = [{ id: 'wait', type: 'wait' as const, params, onFailure: 'stop' as const }];
  await updateAutomationDraft(t.db, { id: created.id, lineAccountId: 'a', expectedDraftVersionId: created.draftVersionId,
    name: '待機', eventType: 'friend_add', triggerConfig: {}, actions });
  expect((await getAutomationDraft(t.db, { id: created.id, lineAccountId: 'a' }))?.actions).toEqual(actions);
  const common = await createCommonAction(t.db, { lineAccountId: 'a', name: '待機', actions });
  expect((await getCommonActionDetail(t.db, { id: common.id, lineAccountId: 'a' }))?.versions[0].actions).toEqual(actions);
});
it.each([{ mode: 'next_day', sendAtTime: '24:00' }, { durationMinutes: 6 }])('不正な待機は両方の保存口で拒否する: %j', async (params) => {
  const created = await createAutomationDraftFromTemplate(t.db, { templateKey: 'received-message-tag', lineAccountId: 'a', operationKey: 'wait-edit-operation' });
  const actions = [{ id: 'wait', type: 'wait' as const, params, onFailure: 'stop' as const }];
  await expect(updateAutomationDraft(t.db, { id: created.id, lineAccountId: 'a', expectedDraftVersionId: created.draftVersionId,
    name: '待機', eventType: 'friend_add', triggerConfig: {}, actions })).rejects.toMatchObject({ code: 'wait_invalid' });
  await expect(createCommonAction(t.db, { lineAccountId: 'a', name: '待機', actions })).rejects.toMatchObject({ code: 'wait_minutes_invalid' });
});

it.each([
  ['friend_add', '2026-03-11T14:59:59.999Z', 1],
  ['friend_add', '2026-03-11T15:00:00.000Z', 0],
  ['restaurant.departed', '2026-03-08T14:59:59.999Z', 1],
  ['restaurant.departed', '2026-03-08T15:00:00.000Z', 0],
] as const)('翌日待機は日本時間の予定日を越えると送らない: %s %s', async (eventType, resumeNow, sends) => {
  if (eventType.startsWith('restaurant.')) origin();
  const createdAt = eventType.startsWith('restaurant.') ? '2026-03-07T22:00:00.000Z' : startAt;
  const time = eventType.startsWith('restaurant.') ? '02:30' : '10:00';
  const id = await startWait({ mode: 'next_day', sendAtTime: time }, eventType, 'event', createdAt);
  await processAutomationRun(t.db, id, { now: createdAt });
  const record = vi.fn(async () => {});
  await processDueAutomationRuns(t.db, { now: resumeNow, executors: { record } });
  await processDueAutomationRuns(t.db, { now: resumeNow, executors: { record } });
  expect(record).toHaveBeenCalledTimes(sends);
  expect(runState(id)).toMatchObject({ status: sends ? 'success' : 'cancelled' });
  if (!sends) expect(t.raw.prepare("SELECT status,error_code,error_message FROM automation_run_steps WHERE step_key='wait'").get())
    .toEqual({ status: 'cancelled', error_code: 'wait_expired', error_message: '期限切れで送らなかった' });
});
it('予定日を越えて初めて処理した翌日待機も期限切れとして閉じる', async () => {
  const id = await startWait({ mode: 'next_day', sendAtTime: '10:00' }), record = vi.fn(async () => {});
  expect(await processAutomationRun(t.db, id, { now: '2026-03-12T00:00:00.000Z', executors: { record } })).toBe('cancelled');
  await processDueAutomationRuns(t.db, { now: '2026-03-12T01:00:00.000Z', executors: { record } });
  expect(record).not.toHaveBeenCalled();
  expect(t.raw.prepare("SELECT error_message FROM automation_run_steps WHERE step_key='wait'").get())
    .toEqual({ error_message: '期限切れで送らなかった' });
});
it('翌日待機が完了して後続だけ再試行になっても、予定日を越えたら実行しない', async () => {
  const id = await startWait({ mode: 'next_day', sendAtTime: '10:00' }), record = vi.fn(async () => {});
  await processAutomationRun(t.db, id, { now: startAt });
  t.raw.prepare("UPDATE automation_run_steps SET status='success' WHERE step_key='wait'").run();
  t.raw.prepare("UPDATE automation_runs SET current_step=1 WHERE id=?").run(id);
  expect(await processAutomationRun(t.db, id, { now: '2026-03-12T00:00:00.000Z', executors: { record } })).toBe('cancelled');
  expect(record).not.toHaveBeenCalled();
  expect(t.raw.prepare("SELECT error_message FROM automation_run_steps WHERE step_key='after'").get())
    .toEqual({ error_message: '期限切れで送らなかった' });
});
