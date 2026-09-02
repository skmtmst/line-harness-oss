import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  captureFriendAddEventAttribution,
  listFriendAddEvents,
  markFriendAddEventRouting,
  recordFriendAddAttributionCandidate,
  recordFriendAddEvent,
} from '../src/friend-add-events.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const benign = /duplicate column name|already exists/i;

function execSafe(sqlite: Database.Database, sql: string): void {
  for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map((value) => value.trim()).filter(Boolean)) {
    try { sqlite.exec(statement); } catch (error) {
      if (!benign.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  }
}

function setup(): Database.Database {
  const sqlite = new Database(':memory:');
  execSafe(sqlite, readFileSync(join(root, 'schema.sql'), 'utf8'));
  for (const file of readdirSync(join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    execSafe(sqlite, readFileSync(join(root, 'migrations', file), 'utf8'));
  }
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'channel-1', 'Account 1', 'token', 'secret'),
            ('account-2', 'channel-2', 'Account 2', 'token', 'secret')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO friends (id, line_user_id, line_account_id, display_name, ref_code, created_at, updated_at)
     VALUES ('friend-1', 'U-1', 'account-1', '田中さん', 'first-touch', ?, ?),
            ('friend-2', 'U-2', 'account-2', '別店舗さん', NULL, ?, ?)`,
  ).run('2026-08-24T09:00:00.000+09:00', '2026-08-24T09:00:00.000+09:00',
        '2026-08-24T09:00:00.000+09:00', '2026-08-24T09:00:00.000+09:00');
  sqlite.prepare(
    `INSERT INTO entry_routes (id, ref_code, name) VALUES ('route-1', 'current-link', '夏の広告')`,
  ).run();
  return sqlite;
}

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const make = (params: unknown[]) => ({
        async run() {
          const info = sqlite.prepare(query).run(...params);
          return { results: [], success: true, meta: { changes: info.changes } };
        },
        async first<T>() { return (sqlite.prepare(query).get(...params) as T) ?? null; },
        async all<T>() { return { results: sqlite.prepare(query).all(...params) as T[], success: true, meta: {} }; },
      });
      return { bind: (...params: unknown[]) => make(params), ...make([]) };
    },
  } as unknown as D1Database;
}

describe('friend add V6 event ledger', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => { sqlite = setup(); db = asD1(sqlite); });

  test('今回リンクをイベントへ結び付けても初回流入コードを上書きしない', async () => {
    const candidate = await recordFriendAddAttributionCandidate(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', refCode: 'current-link',
      entryRouteId: 'route-1', source: 'liff', occurredAt: '2026-08-24T10:00:00.000+09:00',
    });
    const eventId = await recordFriendAddEvent(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', webhookEventId: 'webhook-1',
      friendKind: 'returning', isUnblockedHint: true,
      occurredAt: '2026-08-24T10:00:01.000+09:00',
    });
    expect(await captureFriendAddEventAttribution(db, {
      eventId, lineAccountId: 'account-1', friendId: 'friend-1',
      now: '2026-08-24T10:00:02.000+09:00',
    })).toEqual({ refCode: 'current-link', entryRouteId: 'route-1' });
    await markFriendAddEventRouting(db, {
      eventId, lineAccountId: 'account-1', status: 'completed',
    });

    expect(sqlite.prepare(`SELECT ref_code FROM friends WHERE id = 'friend-1'`).get())
      .toEqual({ ref_code: 'first-touch' });
    expect(sqlite.prepare(`SELECT status, consumed_by_event_id FROM friend_add_attribution_candidates WHERE id = ?`).get(candidate.id))
      .toEqual({ status: 'consumed', consumed_by_event_id: eventId });
  });

  test('取れなかったイベントは unavailable、後着候補は late のまま混同しない', async () => {
    const eventId = await recordFriendAddEvent(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', webhookEventId: 'webhook-2',
      friendKind: 'first_time', occurredAt: '2026-08-24T11:00:00.000+09:00',
    });
    await markFriendAddEventRouting(db, {
      eventId, lineAccountId: 'account-1', status: 'completed',
    });
    const late = await recordFriendAddAttributionCandidate(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', refCode: 'current-link', source: 'liff',
      occurredAt: '2026-08-24T11:01:00.000+09:00',
    });
    expect(late.status).toBe('late');
  });

  test('Webhookの取得待ち中に届いた候補はlateにせず取得できる', async () => {
    const eventId = await recordFriendAddEvent(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', webhookEventId: 'webhook-open',
      friendKind: 'first_time', occurredAt: '2026-08-24T11:30:00.000+09:00',
    });
    const candidate = await recordFriendAddAttributionCandidate(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', refCode: 'current-link', source: 'liff',
      occurredAt: '2026-08-24T11:30:00.500+09:00',
    });
    expect(candidate.status).toBe('pending');
    expect(await captureFriendAddEventAttribution(db, {
      eventId, lineAccountId: 'account-1', friendId: 'friend-1',
      now: '2026-08-24T11:30:01.000+09:00',
    })).toMatchObject({ refCode: 'current-link' });
  });

  test('一覧と集計は指定アカウントから漏れない', async () => {
    const event1 = await recordFriendAddEvent(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', webhookEventId: 'webhook-a',
      friendKind: 'returning', occurredAt: '2026-08-24T12:00:00.000+09:00',
    });
    await markFriendAddEventRouting(db, { eventId: event1, lineAccountId: 'account-1', status: 'suppressed' });
    await recordFriendAddEvent(db, {
      lineAccountId: 'account-2', friendId: 'friend-2', webhookEventId: 'webhook-b',
      friendKind: 'first_time', occurredAt: '2026-08-24T12:01:00.000+09:00',
    });

    const list = await listFriendAddEvents(db, { lineAccountId: 'account-1' });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ friendId: 'friend-1', displayName: '田中さん', kind: 'returning' });
    expect(list.summary).toMatchObject({ total: 1, returning: 1, firstTime: 0 });
  });
});
