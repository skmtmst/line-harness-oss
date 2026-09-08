/**
 * N-065 回帰テスト: 版管理リマインダの実行記録は、外部キー制約の下でも壊れない。
 *
 * friend_reminder_deliveries.reminder_step_id は旧 reminder_steps への FK。
 * 通 ID に版固有の ID (reminder_version_steps.id) を保存すると実 D1 で
 * FOREIGN KEY constraint failed になる。実行記録は論理通 ID
 * (stable_step_id) で統一し、版が変わっても同じ通を指す。
 * FK OFF では隠れるため、このファイルは { foreign_keys: true } で確かめる。
 */
import { describe, expect, it } from 'vitest';

import type { LineClient } from '@line-crm/line-sdk';

import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';
import { enrollByTrigger } from './reminder-trigger.js';
import { getReminderDeliveryRunSummary } from '@line-crm/db';
import { processReminderDeliveries } from './reminder-delivery.js';

const ACCOUNT = 'vfk-account-1';

function seed(raw: import('better-sqlite3').Database): void {
  raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, ?, 'token', 'secret')`,
  ).run(ACCOUNT, `channel-${ACCOUNT}`, ACCOUNT);
  insertFriend(raw, 'vfk-friend-1', { line_user_id: 'U-vfk-1', line_account_id: ACCOUNT });
  raw.prepare(
    `INSERT INTO reminders
       (id, name, line_account_id, is_active, trigger_type, delivery_mode, lifecycle_status)
     VALUES ('vfk-rule-1', 'rule', ?, 1, 'booking', 'countdown', 'published')`,
  ).run(ACCOUNT);
  raw.prepare(
    `INSERT INTO reminder_steps
       (id, reminder_id, offset_minutes, message_type, message_content)
     VALUES ('vfk-step-1', 'vfk-rule-1', -60, 'text', 'お待ちしています')`,
  ).run();
}

function makeClient(pushes: string[]): LineClient {
  return {
    async pushMessageWithRequestId(userId: string) {
      pushes.push(userId);
      return { data: {}, requestId: 'vfk-request-1' };
    },
  } as unknown as LineClient;
}

describe('版管理リマインダの外部キー整合', () => {
  it('登録・配信・確定を通 ID で統一し、FK=ON でも送れる', async () => {
    const { db, raw } = createTestD1({ foreignKeys: true });
    seed(raw);

    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'vfk-friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      sourceId: 'vfk-bk-1',
      sourceEventId: 'vfk-bk-1',
      lineAccountId: ACCOUNT,
    });
    // 登録で公開版が固定される (版つき)。
    expect(
      raw.prepare(`SELECT reminder_version_id FROM friend_reminders`).get(),
    ).toEqual({ reminder_version_id: expect.any(String) });

    const pushes: string[] = [];
    const result = await processReminderDeliveries(db, makeClient(pushes), {
      now: new Date('2026-09-20T02:00:00.000Z'),
      pause: async () => undefined,
      resolveClient: async (_accountId, fallback) => fallback,
    });
    expect(result).toEqual({ succeeded: 1, skipped: 0, retrying: 0, failed: 0 });
    expect(pushes).toEqual(['U-vfk-1']);

    // 保存された通 ID は旧 reminder_steps に存在する (FK が保たれる)。
    const runStep = raw.prepare(`SELECT reminder_step_id FROM reminder_delivery_runs`).get() as {
      reminder_step_id: string;
    };
    const deliveredStep = raw.prepare(
      `SELECT reminder_step_id FROM friend_reminder_deliveries`,
    ).get() as { reminder_step_id: string };
    expect(runStep.reminder_step_id).toBe('vfk-step-1');
    expect(deliveredStep.reminder_step_id).toBe('vfk-step-1');
    expect(
      raw.prepare(`SELECT id FROM reminder_steps WHERE id = ?`).get(runStep.reminder_step_id),
    ).toEqual({ id: 'vfk-step-1' });

    const summary = await getReminderDeliveryRunSummary(db, 'vfk-rule-1');
    expect(summary.sent).toBe(1);
  });

  it('通の文面を変えても配信ずみ判定は論理通で保つ', async () => {
    const { db, raw } = createTestD1({ foreignKeys: true });
    seed(raw);

    await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'vfk-friend-1',
      startsAtIso: '2026-09-20T01:00:00.000Z',
      sourceId: 'vfk-bk-1',
      sourceEventId: 'vfk-bk-1',
      lineAccountId: ACCOUNT,
    });
    // 版の中身だけ変える (ID は不変)。配信ずみの通と混ざらない。
    raw.prepare(
      `UPDATE reminder_steps SET message_content = ? WHERE id = 'vfk-step-1'`,
    ).run('変更後の文面');

    const pushes: string[] = [];
    const result = await processReminderDeliveries(db, makeClient(pushes), {
      now: new Date('2026-09-20T02:00:00.000Z'),
      pause: async () => undefined,
      resolveClient: async (_accountId, fallback) => fallback,
    });
    expect(result.succeeded).toBe(1);

    // 同じ通の再送は配信ずみとして送らない (二重送信なし)。
    const again = await processReminderDeliveries(db, makeClient(pushes), {
      now: new Date('2026-09-20T03:00:00.000Z'),
      pause: async () => undefined,
      resolveClient: async (_accountId, fallback) => fallback,
    });
    expect(again).toEqual({ succeeded: 0, skipped: 0, retrying: 0, failed: 0 });
    expect(pushes).toEqual(['U-vfk-1']);
  });
});
