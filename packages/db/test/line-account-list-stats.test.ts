import Database from 'better-sqlite3';
import { beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getLineAccountListStats } from '../src/line-accounts.js';
import { asD1 } from './d1-test-helper.js';

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', 'A', 'token-a', 'secret-a'),
           ('account-b', 'channel-b', 'B', 'token-b', 'secret-b'),
           ('account-c', 'channel-c', 'C', 'token-c', 'secret-c');
    INSERT INTO friends (id, line_user_id, line_account_id, is_following)
    VALUES ('friend-a1', 'Ua1', 'account-a', 1),
           ('friend-a2', 'Ua2', 'account-a', 1),
           ('friend-a3', 'Ua3', 'account-a', 0),
           ('friend-b1', 'Ub1', 'account-b', 1);
    INSERT INTO scenarios (id, name, trigger_type) VALUES ('scenario-1', '案内', 'manual');
    INSERT INTO friend_scenarios (id, friend_id, scenario_id, status)
    VALUES ('enrollment-a1', 'friend-a1', 'scenario-1', 'active'),
           ('enrollment-a2', 'friend-a2', 'scenario-1', 'paused'),
           ('enrollment-b1', 'friend-b1', 'scenario-1', 'active');
    INSERT INTO messages_log
      (id, friend_id, direction, message_type, content, delivery_type, created_at)
    VALUES ('message-a-push', 'friend-a1', 'outgoing', 'text', 'a', 'push', datetime('now', 'start of month', '+1 day')),
           ('message-a-reply', 'friend-a1', 'outgoing', 'text', 'a', 'reply', datetime('now', 'start of month', '+1 day')),
           ('message-a-old', 'friend-a2', 'outgoing', 'text', 'a', 'push', datetime('now', 'start of month', '-1 day')),
           ('message-b-legacy', 'friend-b1', 'outgoing', 'text', 'b', NULL, datetime('now', 'start of month', '+1 day'));
  `);
  db = asD1(sqlite);
});

describe('LINEアカウント一覧の一括集計', () => {
  test('3種類の件数をアカウント別に一度で返し、データがないアカウントも0にする', async () => {
    const prepareCalls: string[] = [];
    const countingDb = {
      ...db,
      prepare(query: string) {
        prepareCalls.push(query);
        return db.prepare(query);
      },
    } as D1Database;

    await expect(
      getLineAccountListStats(countingDb, ['account-a', 'account-b', 'account-c']),
    ).resolves.toEqual({
      'account-a': { friendCount: 2, activeScenarios: 1, messagesThisMonth: 1 },
      'account-b': { friendCount: 1, activeScenarios: 1, messagesThisMonth: 1 },
      'account-c': { friendCount: 0, activeScenarios: 0, messagesThisMonth: 0 },
    });
    expect(prepareCalls).toHaveLength(1);
  });

  test('アカウント数を増やしてもD1問い合わせとbindは1回のまま', async () => {
    const prepareCalls: string[] = [];
    const bindCalls: unknown[][] = [];
    const countingDb = {
      prepare(query: string) {
        prepareCalls.push(query);
        const statement = db.prepare(query);
        return {
          ...statement,
          bind(...values: unknown[]) {
            bindCalls.push(values);
            return statement.bind(...values);
          },
        };
      },
    } as D1Database;

    await getLineAccountListStats(
      countingDb,
      Array.from({ length: 200 }, (_, index) => `account-${index}`),
    );

    expect(prepareCalls).toHaveLength(1);
    expect(bindCalls).toHaveLength(1);
    expect(bindCalls[0]).toHaveLength(1);
  });
});
