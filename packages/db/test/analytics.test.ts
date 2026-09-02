import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getBroadcastSummary,
  getDailyMessageCounts,
  getLinkClickSummary,
  getTagFieldCross,
  getTrackedLinkStats,
} from '../src/analytics.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const stmt = sqlite.prepare(query);
      return {
        bind(...params: unknown[]) {
          return {
            async all<T>() {
              return { results: stmt.all(...params) as T[], success: true, meta: {} };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('getBroadcastSummary', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    db = asD1(sqlite);
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
    ).run(
      'account-a', 'channel-a', 'A店', 'token-a', 'secret-a',
      'account-b', 'channel-b', 'B店', 'token-b', 'secret-b',
    );
  });

  afterEach(() => {
    sqlite.close();
  });

  test('現行の配信タイトルを集計結果の名前として返す', async () => {
    sqlite.prepare(
      `INSERT INTO broadcasts
         (id, line_account_id, title, message_type, message_content, target_type, status, sent_at, created_at)
       VALUES (?, ?, ?, 'text', 'hello', 'all', 'sent', ?, ?)`,
    ).run('broadcast-1', 'account-a', '8月のお知らせ', '2026-08-22T10:00:00.000', '2026-08-22T09:00:00.000');
    sqlite.prepare(
      `INSERT INTO broadcasts
         (id, line_account_id, title, message_type, message_content, target_type, status, sent_at, created_at)
       VALUES (?, ?, ?, 'text', 'hello', 'all', 'sent', ?, ?)`,
    ).run('broadcast-2', 'account-b', '別店舗のお知らせ', '2026-08-22T10:00:00.000', '2026-08-22T09:00:00.000');
    sqlite.prepare(
      `INSERT INTO broadcast_insights
         (id, broadcast_id, delivered, unique_impression, unique_click, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'ready', ?)`,
    ).run('insight-1', 'broadcast-1', 100, 60, 20, '2026-08-22T11:00:00.000');

    const result = await getBroadcastSummary(db, 'account-a', {
      from: '2026-08-01',
      to: '2026-08-31T23:59:59.999',
    });

    expect(result).toEqual([
      {
        broadcastId: 'broadcast-1',
        name: '8月のお知らせ',
        sentAt: '2026-08-22T10:00:00.000',
        delivered: 100,
        uniqueImpression: 60,
        uniqueClick: 20,
        suppressedByAudienceSize: false,
      },
    ]);
  });

  test('送受信数に別のLINE公式アカウントの記録を混ぜない', async () => {
    sqlite.prepare(
      `INSERT INTO friends (id, line_user_id, display_name, line_account_id)
       VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
    ).run(
      'friend-a', 'line-user-a', 'Aさん', 'account-a',
      'friend-b', 'line-user-b', 'Bさん', 'account-b',
    );
    const insert = sqlite.prepare(
      `INSERT INTO messages_log
         (id, friend_id, direction, message_type, content, delivery_type, line_account_id, created_at)
       VALUES (?, ?, ?, 'text', 'hello', ?, ?, ?)`,
    );
    insert.run('message-a-1', 'friend-a', 'outgoing', 'push', 'account-a', '2026-08-22T10:00:00.000');
    insert.run('message-a-2', 'friend-a', 'incoming', null, 'account-a', '2026-08-22T11:00:00.000');
    insert.run('message-b-1', 'friend-b', 'outgoing', 'push', 'account-b', '2026-08-22T12:00:00.000');

    const result = await getDailyMessageCounts(db, 'account-a', {
      from: '2026-08-01',
      to: '2026-08-31T23:59:59.999',
    });

    expect(result).toEqual([
      {
        date: '2026-08-22',
        outgoing: 1,
        incoming: 1,
        reply: 0,
        push: 1,
        fromBroadcast: 0,
        fromScenario: 0,
      },
    ]);
  });

  test('URL一覧とクリック数に別のLINE公式アカウントの記録を混ぜない', async () => {
    sqlite.prepare(
      `INSERT INTO friends (id, line_user_id, display_name, line_account_id)
       VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
    ).run(
      'friend-a', 'line-user-a', 'Aさん', 'account-a',
      'friend-b', 'line-user-b', 'Bさん', 'account-b',
    );
    sqlite.prepare(
      `INSERT INTO tracked_links (id, name, original_url, line_account_id)
       VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
    ).run(
      'link-a', 'A店の案内', 'https://example.com/a', 'account-a',
      'link-b', 'B店の案内', 'https://example.com/b', 'account-b',
    );
    sqlite.prepare(
      `INSERT INTO link_clicks (id, tracked_link_id, friend_id, clicked_at)
       VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
    ).run(
      'click-a', 'link-a', 'friend-a', '2026-08-22T10:00:00.000',
      'click-b', 'link-b', 'friend-b', '2026-08-22T10:00:00.000',
    );
    const range = { from: '2026-08-01', to: '2026-08-31T23:59:59.999' };

    await expect(getLinkClickSummary(db, 'account-a', range)).resolves.toEqual([
      { trackedLinkId: 'link-a', name: 'A店の案内', clicks: 1, uniqueFriends: 1 },
    ]);
    await expect(getTrackedLinkStats(db, 'account-a', range)).resolves.toEqual([
      {
        trackedLinkId: 'link-a',
        name: 'A店の案内',
        originalUrl: 'https://example.com/a',
        shortCode: null,
        tagName: null,
        scenarioName: null,
        isActive: true,
        clicks: 1,
        uniqueFriends: 1,
        firstClickedAt: '2026-08-22T10:00:00.000',
        lastClickedAt: '2026-08-22T10:00:00.000',
      },
    ]);
  });

  test('クロス集計に別のLINE公式アカウントの友だちを混ぜない', async () => {
    sqlite.prepare(
      `INSERT INTO friends (id, line_user_id, display_name, line_account_id)
       VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
    ).run(
      'friend-a', 'line-user-a', 'Aさん', 'account-a',
      'friend-b', 'line-user-b', 'Bさん', 'account-b',
    );
    sqlite.prepare(
      `INSERT INTO friend_fields (id, name, field_key, type)
       VALUES ('field-prefecture', '都道府県', 'prefecture', 'text')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO tags (id, name, line_account_id)
       VALUES (?, ?, ?), (?, ?, ?)`,
    ).run(
      'tag-a', 'A店のお客様', 'account-a',
      'tag-b', 'B店のお客様', 'account-b',
    );
    sqlite.prepare(
      `INSERT INTO friend_tags (friend_id, tag_id)
       VALUES (?, ?), (?, ?)`,
    ).run('friend-a', 'tag-a', 'friend-b', 'tag-b');
    sqlite.prepare(
      `INSERT INTO friend_field_values (friend_id, field_id, value)
       VALUES (?, 'field-prefecture', ?), (?, 'field-prefecture', ?)`,
    ).run('friend-a', '東京都', 'friend-b', '大阪府');

    await expect(getTagFieldCross(db, 'account-a', 'field-prefecture')).resolves.toEqual([
      { row: 'A店のお客様', col: '東京都', count: 1 },
    ]);
  });
});
