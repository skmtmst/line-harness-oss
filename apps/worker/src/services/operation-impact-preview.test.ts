import { beforeEach, describe, expect, it } from 'vitest';

import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { getBroadcastAudiencePreview } from './broadcast-audience-preview.js';
import { getOperationImpactPreview } from './operation-impact-preview.js';

let testDb: ReturnType<typeof createTestD1>;

beforeEach(() => {
  testDb = createTestD1();
  testDb.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'channel-1', '店舗1', 'token', 'secret'),
            ('account-2', 'channel-2', '店舗2', 'token', 'secret')`,
  ).run();
  testDb.raw.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id)
     VALUES ('friend-1', 'user-1', '一郎', 'account-1'),
            ('friend-2', 'user-2', '二郎', 'account-1'),
            ('friend-3', 'user-3', '三郎', 'account-2')`,
  ).run();
});

describe('緊急停止の影響集計', () => {
  it('現在の配信台帳から対象アカウントの設定数と友だち数を返す', async () => {
    testDb.raw.prepare(
      `INSERT INTO broadcasts
       (id, title, message_type, message_content, target_type, status, scheduled_at, line_account_id)
       VALUES ('broadcast-1', '予約配信', 'text', '本文', 'all', 'scheduled', '2026-09-05T11:00:00.000Z', 'account-1'),
              ('broadcast-2', '別店配信', 'text', '本文', 'all', 'scheduled', '2026-09-05T10:00:00.000Z', 'account-2')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
       VALUES ('scenario-1', '共通シナリオ', 'manual', 1, NULL)`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO friend_scenarios (id, friend_id, scenario_id, status)
       VALUES ('fs-1', 'friend-1', 'scenario-1', 'active'),
              ('fs-2', 'friend-3', 'scenario-1', 'active')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO reminders (id, name, is_active, line_account_id)
       VALUES ('reminder-1', '来店前', 1, 'account-1')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO friend_reminders (id, friend_id, reminder_id, target_date, status)
       VALUES ('fr-1', 'friend-2', 'reminder-1', '2026-09-06T10:00:00.000Z', 'active')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO automation_definitions (id, line_account_id, name, status)
       VALUES ('automation-1', 'account-1', '予約後処理', 'active')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO automation_versions
       (id, automation_id, version_number, status, trigger_type)
       VALUES ('automation-version-1', 'automation-1', 1, 'published', 'friend_added')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO automation_runs
       (id, line_account_id, automation_id, automation_version_id, friend_id, source_event_id, idempotency_key, status)
       VALUES ('run-1', 'account-1', 'automation-1', 'automation-version-1', 'friend-1', 'event-1', 'key-1', 'queued')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO auto_replies (id, keyword, response_content, is_active, line_account_id)
       VALUES ('reply-global', '予約', '承りました', 1, NULL),
              ('reply-account', '相談', '担当します', 1, 'account-1')`,
    ).run();

    await expect(getOperationImpactPreview(testDb.db, 'account-1')).resolves.toEqual({
      broadcast_dispatch: {
        itemCount: 1,
        friendCount: 2,
        nearestScheduledAt: '2026-09-05T11:00:00.000Z',
      },
      scenario_dispatch: { itemCount: 1, friendCount: 1 },
      reminder_dispatch: { itemCount: 1, friendCount: 1 },
      automation_actions: { itemCount: 1, friendCount: 1, pendingCount: 1 },
      auto_reply_dispatch: { itemCount: 2, friendCount: null },
    });
  });

  it('壊れた絞り込み条件を0人と断定しない', async () => {
    testDb.raw.prepare(
      `INSERT INTO broadcasts
       (id, title, message_type, message_content, target_type, status, scheduled_at, line_account_id, segment_conditions)
       VALUES ('broadcast-broken', '条件不明', 'text', '本文', 'segment', 'scheduled',
               '2026-09-05T11:00:00.000Z', 'account-1', '{broken')`,
    ).run();

    const impact = await getOperationImpactPreview(testDb.db, 'account-1');
    expect(impact.broadcast_dispatch).toMatchObject({ itemCount: 1, friendCount: null });
  });

  it('タグ配信の人数を別アカウントから混ぜない', async () => {
    testDb.raw.prepare("INSERT INTO tags (id, name) VALUES ('tag-1', '対象')").run();
    testDb.raw.prepare(
      `INSERT INTO friend_tags (friend_id, tag_id)
       VALUES ('friend-1', 'tag-1'), ('friend-3', 'tag-1')`,
    ).run();
    const broadcast = {
      id: 'broadcast-tag',
      title: 'タグ配信',
      message_type: 'text',
      message_content: '本文',
      target_type: 'tag',
      target_tag_id: 'tag-1',
      status: 'scheduled',
      scheduled_at: null,
      sent_at: null,
      total_count: 0,
      success_count: 0,
      created_at: '2026-09-04T00:00:00.000Z',
      account_ids: null,
      dedup_priority: null,
      failed_account_ids: null,
      dedup_progress: null,
      batch_lock_at: null,
      track_links: 0,
      line_account_id: 'account-1',
    } as const;

    await expect(getBroadcastAudiencePreview(testDb.db, broadcast, 'account-1'))
      .resolves.toEqual({ count: 1 });
  });

  it('読み取れない複数アカウント配信を0人と断定しない', async () => {
    const broadcast = {
      id: 'broadcast-broken-dedup',
      title: '設定不明',
      message_type: 'text',
      message_content: '本文',
      target_type: 'multi-account-dedup',
      target_tag_id: null,
      status: 'scheduled',
      scheduled_at: null,
      sent_at: null,
      total_count: 0,
      success_count: 0,
      created_at: '2026-09-04T00:00:00.000Z',
      account_ids: '{broken',
      dedup_priority: null,
      failed_account_ids: null,
      dedup_progress: null,
      batch_lock_at: null,
      track_links: 0,
    } as const;

    await expect(getBroadcastAudiencePreview(testDb.db, broadcast, null))
      .resolves.toEqual({ count: null });
  });
});

/** `db.prepare` の呼び出し回数を数える。件数を仕込む前に作り直すこと。 */
function countPrepareCalls(db: D1Database): { db: D1Database; count: () => number } {
  let calls = 0;
  const wrapped = {
    prepare: (sql: string) => {
      calls += 1;
      return db.prepare(sql);
    },
    batch: (statements: D1PreparedStatement[]) => db.batch(statements),
  } as unknown as D1Database;
  return { db: wrapped, count: () => calls };
}

/** 一斉配信を大量に仕込む。監視対象はクエリ本数であって、内容は問わない。 */
function seedScheduledBroadcasts(raw: (typeof testDb)['raw'], accountId: string, from: number, to: number): void {
  const insert = raw.prepare(
    `INSERT INTO broadcasts
     (id, title, message_type, message_content, target_type, status, scheduled_at, line_account_id)
     VALUES (?, ?, 'text', '本文', 'all', 'scheduled', ?, ?)`,
  );
  for (let i = from; i < to; i += 1) {
    insert.run(`broadcast-bulk-${i}`, `一斉配信${i}`, `2026-09-05T11:${String(i % 60).padStart(2, '0')}:00.000Z`, accountId);
  }
}

/*
  緊急停止の直前確認は「急いでいるときほど遅くなる」と本末転倒になる。
  停止対象が増えても、確認1回あたりのクエリ本数は増えてはいけない
  （Issue #737）。所要時間そのものは環境で揺れるため試験化せず、
  代わりに `db.prepare` の呼び出し回数という決定的な値で固定する。
*/
describe('緊急停止の直前確認: クエリ本数が件数に比例しない(Issue #737)', () => {
  it('停止対象が60件でも600件でもクエリ本数は変わらない', async () => {
    seedScheduledBroadcasts(testDb.raw, 'account-1', 0, 60);
    const counted60 = countPrepareCalls(testDb.db);
    await getOperationImpactPreview(counted60.db, 'account-1');
    const queries60 = counted60.count();

    seedScheduledBroadcasts(testDb.raw, 'account-1', 60, 600);
    const counted600 = countPrepareCalls(testDb.db);
    await getOperationImpactPreview(counted600.db, 'account-1');
    const queries600 = counted600.count();

    expect(queries60).toBeGreaterThan(0);
    expect(queries600).toBe(queries60);
  });

  it('件数(itemCount)は上限を超えても実数のまま、対象者数(friendCount)は代表サンプルの下限値になる', async () => {
    testDb.raw.prepare(
      "INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following) VALUES ('friend-following-1', 'user-following-1', '四郎', 'account-1', 1)",
    ).run();
    seedScheduledBroadcasts(testDb.raw, 'account-1', 0, 600);

    const impact = await getOperationImpactPreview(testDb.db, 'account-1');

    expect(impact.broadcast_dispatch.itemCount).toBe(600);
    expect(impact.broadcast_dispatch.friendCountIsPartial).toBe(true);
    // サンプル上限(50件)ぶんの対象者数だけを数えた下限値。600件全部の対象者数(実際は
    // もっと多い)を「0人」や「実数」と偽らないことが目的で、正確な値そのものは問わない。
    expect(impact.broadcast_dispatch.friendCount).not.toBeNull();
  });
});
