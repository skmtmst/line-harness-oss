import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite';
import {
  getScenarioRuns,
  saveScenarioDraft,
  simulateScenario,
} from './scenario-v6-contract';

function addAccount(raw: Database.Database, id: string): void {
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active)
     VALUES (?, ?, ?, ?, '', 1)`,
  ).run(id, `channel-${id}`, id, `token-${id}`);
}

function addScenario(raw: Database.Database, id: string, accountId: string): void {
  raw.prepare(
    `INSERT INTO scenarios
       (id, name, trigger_type, line_account_id, delivery_mode, is_active)
     VALUES (?, ?, 'manual', ?, 'relative', 1)`,
  ).run(id, id, accountId);
}

function addStep(raw: Database.Database, scenarioId: string, id = 'step-1'): void {
  raw.prepare(
    `INSERT INTO scenario_steps
       (id, scenario_id, step_order, delay_minutes, message_type, message_content,
        is_draft, target_condition_json)
     VALUES (?, ?, 0, 0, 'text', 'こんにちは', 0, NULL)`,
  ).run(id, scenarioId);
}

describe('scenario V6 API contract service', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    addAccount(testDb.raw, 'account-1');
    addAccount(testDb.raw, 'account-2');
    addScenario(testDb.raw, 'scenario-1', 'account-1');
    addScenario(testDb.raw, 'scenario-2', 'account-2');
    addStep(testDb.raw, 'scenario-1');
  });

  it('simulateは実友だちを数えるだけで購読を増やさない', async () => {
    insertFriend(testDb.raw, 'friend-1', { line_account_id: 'account-1' });
    insertFriend(testDb.raw, 'friend-2', { line_account_id: 'account-1' });
    insertFriend(testDb.raw, 'friend-blocked', { line_account_id: 'account-1', is_following: 0 });
    insertFriend(testDb.raw, 'friend-other', { line_account_id: 'account-2' });
    testDb.raw.prepare(
      `INSERT INTO friend_scenarios
         (id, friend_id, scenario_id, current_step_order, status, started_at, updated_at)
       VALUES ('subscription-1', 'friend-1', 'scenario-1', -1, 'active', '2026-09-07', '2026-09-07')`,
    ).run();

    const result = await simulateScenario(testDb.db, {
      scenarioId: 'scenario-1',
      lineAccountId: 'account-1',
      startAt: '2026-09-07T10:00:00+09:00',
    });

    expect(result).toMatchObject({
      sideEffects: false,
      audience: {
        accountTotal: 3,
        matched: 2,
        alreadySubscribed: 1,
        newStartPlanned: 1,
        excluded: 1,
      },
      steps: [{ id: 'step-1', targetCount: 2 }],
    });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS total FROM friend_scenarios').get())
      .toEqual({ total: 1 });
  });

  it('友だちも通も無いシナリオは空状態を返す', async () => {
    addScenario(testDb.raw, 'scenario-empty', 'account-1');
    const result = await simulateScenario(testDb.db, {
      scenarioId: 'scenario-empty',
      lineAccountId: 'account-1',
    });
    expect(result.audience).toMatchObject({ accountTotal: 0, matched: 0, newStartPlanned: 0 });
    expect(result.steps).toEqual([]);
  });

  it('下書き保存は第2期アクションを連番で保存し、古い版を409にする', async () => {
    const action = {
      id: 'mileage-1',
      hook: 'step_sent',
      stepId: 'step-1',
      type: 'adjust_mileage',
      params: { amount: 10, reason: '初回案内を完了' },
      onFailure: 'stop',
    };
    const first = await saveScenarioDraft(testDb.db, {
      scenarioId: 'scenario-1', lineAccountId: 'account-1', expectedVersion: 0,
      afterActions: [action], staffId: 'owner-1',
    });
    expect(first).toMatchObject({ version: 1, afterActions: [{ type: 'adjust_mileage' }] });

    const second = await saveScenarioDraft(testDb.db, {
      scenarioId: 'scenario-1', lineAccountId: 'account-1', expectedVersion: 1,
      afterActions: [action], staffId: 'owner-2',
    });
    expect(second.version).toBe(2);
    await expect(saveScenarioDraft(testDb.db, {
      scenarioId: 'scenario-1', lineAccountId: 'account-1', expectedVersion: 1,
      afterActions: [action], staffId: 'owner-1',
    })).rejects.toMatchObject({ code: 'version_conflict', status: 409 });
  });

  it('第2期の待機時間は正本のdurationを5分単位で受け取る', async () => {
    const saved = await saveScenarioDraft(testDb.db, {
      scenarioId: 'scenario-1', lineAccountId: 'account-1', expectedVersion: 0,
      staffId: 'owner-1',
      afterActions: [{
        id: 'wait-1', hook: 'scenario_completed', type: 'wait',
        params: { duration: 10 }, onFailure: 'stop',
      }],
    });
    expect(saved.afterActions[0]?.params).toEqual({ durationMinutes: 10 });

    await expect(saveScenarioDraft(testDb.db, {
      scenarioId: 'scenario-1', lineAccountId: 'account-1', expectedVersion: 1,
      staffId: 'owner-1',
      afterActions: [{
        id: 'wait-2', hook: 'scenario_completed', type: 'wait',
        params: { duration: 7 }, onFailure: 'stop',
      }],
    })).rejects.toMatchObject({ code: 'wait_invalid' });
  });

  it('別アカウントのシナリオと参照先を隠す', async () => {
    await expect(simulateScenario(testDb.db, {
      scenarioId: 'scenario-1', lineAccountId: 'account-2',
    })).rejects.toMatchObject({ code: 'not_found', status: 404 });

    testDb.raw.prepare(
      "INSERT INTO tags (id, name, line_account_id) VALUES ('tag-other', '別店舗', 'account-2')",
    ).run();
    await expect(saveScenarioDraft(testDb.db, {
      scenarioId: 'scenario-1', lineAccountId: 'account-1', expectedVersion: 0,
      staffId: 'owner-1',
      afterActions: [{
        id: 'tag-1', hook: 'step_sent', stepId: 'step-1', type: 'add_tag',
        params: { tagId: 'tag-other' }, onFailure: 'stop',
      }],
    })).rejects.toMatchObject({ code: 'resource_not_found' });
  });

  it('runsは購読・テスト送信・枠・通別実績を実データから返す', async () => {
    insertFriend(testDb.raw, 'friend-1', { line_account_id: 'account-1', display_name: '田中さん' });
    testDb.raw.prepare(
      `INSERT INTO friend_scenarios
         (id, friend_id, scenario_id, current_step_order, status, started_at,
          next_delivery_at, updated_at)
       VALUES ('subscription-1', 'friend-1', 'scenario-1', 0, 'active',
               '2026-09-07T09:00:00+09:00', '2026-09-07T12:00:00+09:00', '2026-09-07')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO messages_log
         (id, friend_id, direction, message_type, content, scenario_step_id,
          source, line_account_id, created_at)
       VALUES
         ('message-1', 'friend-1', 'outgoing', 'text', '本番', 'step-1',
          'scenario', 'account-1', '2026-09-07T10:00:00+09:00'),
         ('message-test', 'friend-1', 'outgoing', 'text', 'テスト', 'step-1',
          'scenario_test', 'account-1', '2026-09-07T10:05:00+09:00')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO broadcasts
         (id, title, message_type, message_content, status, line_account_id, scheduled_at)
       VALUES ('broadcast-1', '同時配信', 'text', '案内', 'scheduled',
               'account-1', '2026-09-07T12:00:30+09:00')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO tracked_links
         (id, name, original_url, scenario_id, line_account_id, click_count)
       VALUES ('link-1', '詳細', 'https://example.com', 'scenario-1', 'account-1', 4)`,
    ).run();

    const result = await getScenarioRuns(testDb.db, {
      scenarioId: 'scenario-1', lineAccountId: 'account-1', limit: 20,
      quotaFetcher: async () => ({ limit: 5_000, used: 120 }),
    });
    expect(result).toMatchObject({
      summary: { active: 1, paused: 0, completed: 0, delivering: 0 },
      subscriptions: [{ friendName: '田中さん', status: 'active' }],
      testSends: [{ friendName: '田中さん', messageCount: 1 }],
      quota: { limit: 5_000, used: 120, remaining: 4_880, state: 'available' },
      concurrentBroadcasts: [{ id: 'broadcast-1' }],
      scenarioClickTotal: 4,
      steps: [{ delivered: 1, opened: { value: null, state: 'unavailable' } }],
    });
  });

  it('DB失敗を成功や空状態に置き換えない', async () => {
    const broken = {
      prepare() {
        throw new Error('database unavailable');
      },
    } as unknown as D1Database;
    await expect(simulateScenario(broken, {
      scenarioId: 'scenario-1', lineAccountId: 'account-1',
    })).rejects.toThrow('database unavailable');
  });
});
