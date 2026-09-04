import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import type { ActionDefinition, AutomationActionExecutor } from './automation-engine';
import {
  dispatchAutomationEvent,
  processOverdueSupportMarkTriggers,
  processScheduledAutomationTriggers,
} from './automation-triggers';

const NOW = '2026-08-26T00:02:00.000Z';

function addAccount(raw: Database.Database, id: string, timezone = 'Asia/Tokyo'): void {
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, timezone)
     VALUES (?, ?, ?, '', '', 1, ?)`,
  ).run(id, `channel-${id}`, id, timezone);
}

function addFriend(raw: Database.Database, id: string, accountId: string): void {
  raw.prepare(
    `INSERT INTO friends
       (id, line_user_id, display_name, line_account_id, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, '{}', ?, ?)`,
  ).run(id, `U-${id}`, id, accountId, NOW, NOW);
}

function addAutomation(
  raw: Database.Database,
  input: {
    id: string;
    accountId?: string;
    triggerType: string;
    triggerConfig?: Record<string, unknown>;
    conditionConfig?: Record<string, unknown>;
    action?: ActionDefinition;
    priority?: number;
  },
): void {
  const accountId = input.accountId ?? 'account-1';
  const versionId = `${input.id}-v1`;
  raw.prepare(
    `INSERT INTO automation_definitions
       (id, line_account_id, name, status, priority)
     VALUES (?, ?, ?, 'active', ?)`,
  ).run(input.id, accountId, input.id, input.priority ?? 0);
  raw.prepare(
    `INSERT INTO automation_versions
       (id, automation_id, version_number, status, trigger_type, trigger_config,
        condition_config, action_config, published_at)
     VALUES (?, ?, 1, 'published', ?, ?, ?, ?, ?)`,
  ).run(
    versionId,
    input.id,
    input.triggerType,
    JSON.stringify(input.triggerConfig ?? {}),
    JSON.stringify(input.conditionConfig ?? {}),
    JSON.stringify([input.action ?? { id: 'record', type: 'record', params: {}, onFailure: 'stop' }]),
    NOW,
  );
  raw.prepare(
    `UPDATE automation_definitions SET current_published_version_id = ? WHERE id = ?`,
  ).run(versionId, input.id);
}

describe('V6オートメーションのきっかけ接続', () => {
  let testDb: SqliteD1;
  let record: ReturnType<typeof vi.fn>;
  let executors: Record<string, AutomationActionExecutor>;

  beforeEach(() => {
    testDb = createTestD1();
    addAccount(testDb.raw, 'account-1');
    addAccount(testDb.raw, 'account-2');
    addFriend(testDb.raw, 'friend-1', 'account-1');
    addFriend(testDb.raw, 'friend-2', 'account-2');
    record = vi.fn(async () => ({ output: { recorded: true } }));
    executors = { record };
  });

  it('フォームIDが一致する公開版だけを開始し、同じ回答を二重実行しない', async () => {
    addAutomation(testDb.raw, {
      id: 'form-match', triggerType: 'form_submitted', triggerConfig: { formId: 'form-1' },
    });
    addAutomation(testDb.raw, {
      id: 'form-other', triggerType: 'form_submitted', triggerConfig: { formId: 'form-2' },
    });
    const input = {
      lineAccountId: 'account-1', eventType: 'form_submitted', sourceEventId: 'submission-1',
      friendId: 'friend-1', eventData: { formId: 'form-1', submissionId: 'submission-1' },
    };

    expect(await dispatchAutomationEvent(testDb.db, input, { now: NOW, executors }))
      .toMatchObject([{ automationId: 'form-match', kind: 'created', status: 'success' }]);
    expect(await dispatchAutomationEvent(testDb.db, input, { now: NOW, executors }))
      .toMatchObject([{ automationId: 'form-match', kind: 'existing', status: 'success' }]);
    expect(record).toHaveBeenCalledTimes(1);
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM automation_runs`).get())
      .toEqual({ count: 1 });
  });

  it('友だち条件は既存の共通条件部品で判定し、条件外も履歴へ残す', async () => {
    testDb.raw.prepare(`INSERT INTO tags (id, name) VALUES ('vip', 'VIP')`).run();
    addAutomation(testDb.raw, {
      id: 'vip-only', triggerType: 'link_clicked',
      conditionConfig: { operator: 'AND', rules: [{ type: 'tag_exists', value: 'vip' }] },
    });

    const result = await dispatchAutomationEvent(testDb.db, {
      lineAccountId: 'account-1', eventType: 'link_clicked', sourceEventId: 'click-1',
      friendId: 'friend-1', eventData: { trackedLinkId: 'link-1' },
    }, { now: NOW, executors });

    expect(result).toMatchObject([{ automationId: 'vip-only', status: 'skipped_condition' }]);
    expect(record).not.toHaveBeenCalled();
    expect(testDb.raw.prepare(`SELECT status FROM automation_runs`).get())
      .toEqual({ status: 'skipped_condition' });
  });

  it('別アカウントの友だちを実行対象にしない', async () => {
    addAutomation(testDb.raw, { id: 'booking', triggerType: 'calendar_booked' });
    const result = await dispatchAutomationEvent(testDb.db, {
      lineAccountId: 'account-1', eventType: 'calendar_booked', sourceEventId: 'booking-1',
      friendId: 'friend-2', eventData: { bookingType: 'salon' },
    }, { now: NOW, executors });

    expect(result).toMatchObject([{
      automationId: 'booking', kind: 'configuration_error', error: 'friend_account_mismatch',
    }]);
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM automation_runs`).get())
      .toEqual({ count: 0 });
  });

  it('対応マークの自動変更は条件に合う最優先の1本だけを実行する', async () => {
    addAutomation(testDb.raw, {
      id: 'mark-low', triggerType: 'support_mark_change', priority: 10,
      triggerConfig: { kind: 'support_mark_rule', event: 'message_received' },
    });
    addAutomation(testDb.raw, {
      id: 'mark-high', triggerType: 'support_mark_change', priority: 100,
      triggerConfig: { kind: 'support_mark_rule', event: 'message_received' },
    });

    const result = await dispatchAutomationEvent(testDb.db, {
      lineAccountId: 'account-1', eventType: 'message_received', sourceEventId: 'webhook-mark-1',
      friendId: 'friend-1', eventData: {},
    }, { now: NOW, executors });

    expect(result).toMatchObject([{ automationId: 'mark-high', status: 'success' }]);
    expect(record).toHaveBeenCalledTimes(1);
    expect(testDb.raw.prepare(`SELECT automation_id FROM automation_runs`).all())
      .toEqual([{ automation_id: 'mark-high' }]);
  });

  it('返信期限超過は期限時刻を不変IDにして同じ会話を二重実行しない', async () => {
    addAutomation(testDb.raw, {
      id: 'mark-overdue', triggerType: 'support_mark_change', priority: 100,
      triggerConfig: { kind: 'support_mark_rule', event: 'response_overdue' },
    });
    testDb.raw.prepare(
      `INSERT INTO chats
         (id, friend_id, status, line_account_id, next_response_due_at, created_at, updated_at)
       VALUES ('chat-1', 'friend-1', 'unread', 'account-1',
               '2026-08-25T00:00:00.000Z', ?, ?)`,
    ).run(NOW, NOW);

    const first = await processOverdueSupportMarkTriggers(testDb.db, {
      now: NOW, executors, limit: 10,
    });
    const second = await processOverdueSupportMarkTriggers(testDb.db, {
      now: NOW, executors, limit: 10,
    });

    expect(first).toMatchObject([{ automationId: 'mark-overdue', kind: 'created' }]);
    expect(second).toMatchObject([{ automationId: 'mark-overdue', kind: 'existing' }]);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('不明なきっかけ設定を全員一致として扱わない', async () => {
    addAutomation(testDb.raw, {
      id: 'bad-config', triggerType: 'form_submitted', triggerConfig: { unknown: true },
    });
    const result = await dispatchAutomationEvent(testDb.db, {
      lineAccountId: 'account-1', eventType: 'form_submitted', sourceEventId: 'submission-bad',
      friendId: 'friend-1', eventData: { formId: 'form-1' },
    }, { now: NOW, executors });

    expect(result).toMatchObject([{
      automationId: 'bad-config', kind: 'configuration_error',
      error: 'trigger_config_unknown:unknown',
    }]);
    expect(record).not.toHaveBeenCalled();
  });

  it('毎日の指定時刻をアカウントのタイムゾーンで5分内に一度だけ起動する', async () => {
    addAutomation(testDb.raw, {
      id: 'daily', triggerType: 'daily',
      triggerConfig: { time: '09:00', friendIds: ['friend-1'] },
    });

    const first = await processScheduledAutomationTriggers(testDb.db, {
      now: NOW, executors,
    });
    const replay = await processScheduledAutomationTriggers(testDb.db, {
      now: '2026-08-26T00:04:00.000Z', executors,
    });
    const outside = await processScheduledAutomationTriggers(testDb.db, {
      now: '2026-08-26T00:05:00.000Z', executors,
    });

    expect(first).toMatchObject({ due: 1, results: [{ kind: 'created', status: 'success' }] });
    expect(replay).toMatchObject({ due: 1, results: [{ kind: 'existing', status: 'success' }] });
    expect(outside).toEqual({ due: 0, results: [] });
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('毎週は曜日が一致するときだけ起動する', async () => {
    addAutomation(testDb.raw, {
      id: 'weekly', triggerType: 'weekly',
      triggerConfig: { time: '09:00', weekdays: [3], friendIds: ['friend-1'] },
    });
    expect(await processScheduledAutomationTriggers(testDb.db, { now: NOW, executors }))
      .toMatchObject({ due: 1 });
    expect(await processScheduledAutomationTriggers(testDb.db, {
      now: '2026-08-27T00:02:00.000Z', executors,
    })).toEqual({ due: 0, results: [] });
  });

  it('日時指定は指定後5分だけ対象にし、過去へ遡らない', async () => {
    addAutomation(testDb.raw, {
      id: 'datetime', triggerType: 'datetime',
      triggerConfig: { at: '2026-08-26T00:00:00.000Z', friendIds: ['friend-1'] },
    });
    expect(await processScheduledAutomationTriggers(testDb.db, { now: NOW, executors }))
      .toMatchObject({ due: 1, results: [{ status: 'success' }] });
    expect(await processScheduledAutomationTriggers(testDb.db, {
      now: '2026-08-26T00:05:00.000Z', executors,
    })).toEqual({ due: 0, results: [] });
  });

  it('1回の安全上限を超える日時対象は一部だけ実行せず設定エラーにする', async () => {
    addFriend(testDb.raw, 'friend-3', 'account-1');
    addAutomation(testDb.raw, {
      id: 'capacity', triggerType: 'daily',
      triggerConfig: { time: '09:00', friendIds: ['friend-1', 'friend-3'] },
    });

    expect(await processScheduledAutomationTriggers(testDb.db, {
      now: NOW, executors, limit: 1,
    })).toMatchObject({
      due: 1,
      results: [{ kind: 'configuration_error', error: 'scheduled_trigger_capacity_exceeded' }],
    });
    expect(record).not.toHaveBeenCalled();
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM automation_runs`).get())
      .toEqual({ count: 0 });
  });

  it('タイムゾーンのない日時と5分刻みでない定期時刻を拒否する', async () => {
    addAutomation(testDb.raw, {
      id: 'datetime-no-zone', triggerType: 'datetime',
      triggerConfig: { at: '2026-08-26T00:00:00', friendIds: ['friend-1'] },
    });
    addAutomation(testDb.raw, {
      id: 'daily-off-grid', triggerType: 'daily',
      triggerConfig: { time: '09:02', friendIds: ['friend-1'] },
    });

    const result = await processScheduledAutomationTriggers(testDb.db, {
      now: NOW, executors,
    });
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ automationId: 'datetime-no-zone', error: 'trigger_config_at_invalid' }),
      expect.objectContaining({ automationId: 'daily-off-grid', error: 'trigger_config_time_invalid' }),
    ]));
    expect(record).not.toHaveBeenCalled();
  });
});
