import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBroadcastSummary } from '../src/analytics.js';

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
  });

  afterEach(() => {
    sqlite.close();
  });

  test('現行の配信タイトルを集計結果の名前として返す', async () => {
    sqlite.prepare(
      `INSERT INTO broadcasts
         (id, title, message_type, message_content, target_type, status, sent_at, created_at)
       VALUES (?, ?, 'text', 'hello', 'all', 'sent', ?, ?)`,
    ).run('broadcast-1', '8月のお知らせ', '2026-08-22T10:00:00.000', '2026-08-22T09:00:00.000');
    sqlite.prepare(
      `INSERT INTO broadcast_insights
         (id, broadcast_id, delivered, unique_impression, unique_click, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'ready', ?)`,
    ).run('insight-1', 'broadcast-1', 100, 60, 20, '2026-08-22T11:00:00.000');

    const result = await getBroadcastSummary(db, {
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
});
