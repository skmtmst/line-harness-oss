import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getFriendBulkRunDetail, publishScenarioVersion } from '@line-crm/db';
import type { FriendBulkOperation } from '@line-crm/shared';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { startFriendBulkRun, processFriendBulkRun } from './friend-bulk-runs.js';

const actor = { id: 'actor', name: '試験担当', role: 'owner' as const, readOnly: false, tenantId: 'default' };
const NOW = '2026-10-02T00:00:00.000Z';

describe('一括操作の追加分の実行と結果件数', () => {
  let testDb: SqliteD1;
  beforeEach(async () => {
    testDb = createTestD1();
    testDb.raw.exec(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
      VALUES ('a1', 'channel-1', '試験店舗', '', '', 'default');
      INSERT INTO operators (id, name, email) VALUES ('operator-1', '試験担当', 'fixture@example.invalid');
      INSERT INTO support_marks (id, name) VALUES ('mark-1', '対応中');
      INSERT INTO support_mark_scopes (mark_id, tenant_id, line_account_id, created_at)
      VALUES ('mark-1', 'default', 'a1', '${NOW}');
      INSERT INTO reminders (id, name, line_account_id) VALUES ('reminder-1', '試験通知', 'a1');
      INSERT INTO scenarios (id, name, trigger_type, line_account_id)
      VALUES ('scenario-1', '試験配信', 'manual', 'a1');
      INSERT INTO scenario_steps (id, scenario_id, step_order, message_type, message_content)
      VALUES ('step-1', 'scenario-1', 1, 'text', '試験本文');`);
    await publishScenarioVersion(testDb.db, 'scenario-1', { staffId: null, idempotencyKey: 'fixture-publish' });
    for (const id of ['f1', 'f2']) insertFriend(testDb.raw, id, { line_account_id: 'a1', is_following: 1 });
  });
  afterEach(() => testDb.raw.close());
  async function execute(operation: FriendBulkOperation) {
    const { run } = await startFriendBulkRun(testDb.db, actor, {
      selection: { kind: 'explicit', friendIds: ['f1', 'f2'] }, operation,
      idempotencyKey: crypto.randomUUID(), now: NOW,
    });
    await processFriendBulkRun(testDb.db, run.id, { now: NOW });
    return getFriendBulkRunDetail(testDb.db, run.id, 'default');
  }

  it('2人の担当者と対応マークを変え、成功件数と変更済みの件数を返す', async () => {
    expect(await execute({ kind: 'assign_operator', operatorId: 'operator-1' })).toMatchObject({ successCount: 2 });
    expect(testDb.raw.prepare('SELECT operator_id FROM chats').all()).toEqual([{ operator_id: 'operator-1' }, { operator_id: 'operator-1' }]);
    expect(await execute({ kind: 'set_support', markId: 'mark-1' })).toMatchObject({ successCount: 2 });
    expect(testDb.raw.prepare('SELECT support_mark_id FROM friends').all()).toEqual([{ support_mark_id: 'mark-1' }, { support_mark_id: 'mark-1' }]);
    expect(await execute({ kind: 'set_support', markId: 'mark-1' })).toMatchObject({ successCount: 0, skippedCount: 2 });
  });

  it('2人にリマインダを登録し、再登録は重複せず、停止できる', async () => {
    const operation = { kind: 'set_reminder' as const, reminderId: 'reminder-1', targetDate: '2026-10-03T00:00:00.000Z' };
    expect(await execute(operation)).toMatchObject({ successCount: 2 });
    expect(await execute(operation)).toMatchObject({ successCount: 0, skippedCount: 2 });
    expect(await execute({ kind: 'cancel_reminder', reminderId: 'reminder-1' })).toMatchObject({ successCount: 2 });
    expect(testDb.raw.prepare('SELECT status FROM friend_reminders').all()).toEqual([{ status: 'cancelled' }, { status: 'cancelled' }]);
  });

  it('2人のシナリオを始めて止め、結果件数と実際の登録状態が一致する', async () => {
    expect(await execute({ kind: 'start_scenario', scenarioId: 'scenario-1' })).toMatchObject({ successCount: 2 });
    expect(testDb.raw.prepare('SELECT status FROM friend_scenarios').all()).toEqual([{ status: 'active' }, { status: 'active' }]);
    expect(await execute({ kind: 'stop_scenario', scenarioId: 'scenario-1' })).toMatchObject({ successCount: 2 });
    expect(testDb.raw.prepare('SELECT status FROM friend_scenarios').all()).toEqual([{ status: 'paused' }, { status: 'paused' }]);
  });
});
