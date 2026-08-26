import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ensureAnalyticsUrlExposureCoverage,
  extractTrackedLinkKeys,
  processPendingAnalyticsUrlExposures,
  recordUnknownAnalyticsUrlExposures,
} from '../src/analytics-url-exposures.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const info = statement.run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as T;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement);
    return make([]);
  }
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      const results: unknown[] = [];
      sqlite.transaction(() => {
        for (const statement of statements) results.push(statement.run());
      })();
      return Promise.all(results) as T;
    },
  } as unknown as D1Database;
}

describe('V6 URL露出投影', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.prepare(
      `INSERT INTO line_accounts (
         id, channel_id, name, channel_access_token, channel_secret
       ) VALUES ('account-a','ca','A','ta','sa'),
                ('account-b','cb','B','tb','sb')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO friends (id, line_user_id, line_account_id)
       VALUES ('friend-a','Ua','account-a'),
              ('friend-b','Ub','account-b')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO tracked_links (
         id, name, original_url, line_account_id, short_code
       ) VALUES ('link-a','AのURL','https://example.com/a','account-a','same-code'),
                ('link-b','BのURL','https://example.com/b','account-b','other-code')`,
    ).run();
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('本文から計測URLだけを重複なく最大50件取り出す', () => {
    expect(extractTrackedLinkKeys(
      'https://x.example/t/abc?f=1 https://x.example/t/abc) /t/def#top',
    )).toEqual(['abc', 'def']);
    expect(extractTrackedLinkKeys('https://example.com/not-tracked')).toEqual([]);
  });

  it('送信成功ログのうち計測URLを含むものだけを待ち行列へ入れる', () => {
    const insert = sqlite.prepare(
      `INSERT INTO messages_log (
         id, friend_id, direction, message_type, content, line_account_id, created_at
       ) VALUES (?, 'friend-a', ?, 'text', ?, ?, '2026-08-26T01:00:00.000Z')`,
    );
    insert.run('outgoing-url', 'outgoing', 'https://h.example/t/same-code', null);
    insert.run('outgoing-plain', 'outgoing', 'URLなし', 'account-a');
    insert.run('incoming-url', 'incoming', 'https://h.example/t/same-code', 'account-a');

    expect(sqlite.prepare(
      `SELECT message_id, line_account_id, status FROM analytics_url_exposure_queue`,
    ).all()).toEqual([
      { message_id: 'outgoing-url', line_account_id: 'account-a', status: 'pending' },
    ]);
  });

  it('アカウントを混ぜず、同じ送信を二重計上しない', async () => {
    sqlite.prepare(
      `INSERT INTO messages_log (
         id, friend_id, direction, message_type, content, line_account_id, source, created_at
       ) VALUES ('message-a','friend-a','outgoing','text',?,NULL,'manual','2026-08-26T01:00:00.000Z')`,
    ).run('案内 https://h.example/t/same-code と https://h.example/t/other-code');

    await expect(processPendingAnalyticsUrlExposures(db, {
      now: '2026-08-26T01:05:00.000Z',
    })).resolves.toMatchObject({ claimed: 1, processed: 1, failed: 0, exposures: 1 });
    await expect(processPendingAnalyticsUrlExposures(db, {
      now: '2026-08-26T01:10:00.000Z',
    })).resolves.toMatchObject({ claimed: 0, processed: 0, exposures: 0 });

    expect(sqlite.prepare(
      `SELECT line_account_id, message_id, friend_id, tracked_link_id, source_kind
         FROM analytics_url_exposures`,
    ).all()).toEqual([{
      line_account_id: 'account-a',
      message_id: 'message-a',
      friend_id: 'friend-a',
      tracked_link_id: 'link-a',
      source_kind: 'manual',
    }]);
  });

  it('取得開始日は初回値を固定し、後から過去へ広げない', async () => {
    await ensureAnalyticsUrlExposureCoverage(db, {
      lineAccountId: 'account-a',
      availableFrom: '2026-08-26T01:00:00.000Z',
      updatedAt: '2026-08-26T01:00:00.000Z',
    });
    await ensureAnalyticsUrlExposureCoverage(db, {
      lineAccountId: 'account-a',
      availableFrom: '2026-08-20T01:00:00.000Z',
      updatedAt: '2026-08-27T01:00:00.000Z',
    });
    expect(sqlite.prepare(
      `SELECT available_from, state, updated_at FROM analytics_event_coverage
        WHERE line_account_id = 'account-a' AND event_type = 'url_exposed'`,
    ).get()).toEqual({
      available_from: '2026-08-26T01:00:00.000Z',
      state: 'available',
      updated_at: '2026-08-27T01:00:00.000Z',
    });
  });

  it('受信者一覧を取れない全員配信は人数を推測せず印だけを残す', async () => {
    await expect(recordUnknownAnalyticsUrlExposures(db, {
      lineAccountId: 'account-a',
      messageId: 'line-broadcast:b1',
      content: 'https://h.example/t/same-code',
      sourceKind: 'broadcast_all',
      sourceId: 'b1',
      sentAt: '2026-08-26T01:00:00.000Z',
    })).resolves.toBe(1);
    await expect(recordUnknownAnalyticsUrlExposures(db, {
      lineAccountId: 'account-a',
      messageId: 'line-broadcast:b1',
      content: 'https://h.example/t/same-code',
      sourceKind: 'broadcast_all',
      sourceId: 'b1',
      sentAt: '2026-08-26T01:00:00.000Z',
    })).resolves.toBe(0);
    expect(sqlite.prepare(
      `SELECT tracked_link_id, friend_id, audience_state, source_kind
         FROM analytics_url_exposures`,
    ).all()).toEqual([{
      tracked_link_id: 'link-a',
      friend_id: null,
      audience_state: 'unknown',
      source_kind: 'broadcast_all',
    }]);
  });

  it('導入時点で既存アカウントの取得開始日を記録する', () => {
    sqlite.exec(readFileSync(join(ROOT, 'migrations/190_analytics_url_exposures.sql'), 'utf8'));
    const coverage = sqlite.prepare(
      `SELECT state, available_from FROM analytics_event_coverage
        WHERE line_account_id = 'account-a' AND event_type = 'url_exposed'`,
    ).get() as { state: string; available_from: string };
    expect(coverage.state).toBe('available');
    expect(new Date(coverage.available_from).toString()).not.toBe('Invalid Date');
  });
});
