import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hasMileageRuleHistory } from '../src/mileage.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() { return (statement.get(...params) as T | undefined) ?? null; },
      async run<T>() {
        const info = statement.run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as T;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement);
    return make([]);
  }
  return { prepare } as unknown as D1Database;
}

describe('マイル決めごとの履歴確認', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-1', 'channel-1', '本店', 'token', 'secret');
      INSERT INTO mileage_programs (id, code, name, created_at, updated_at)
      VALUES ('default', 'default', '標準', datetime('now'), datetime('now'));

      INSERT INTO mileage_rules
        (id, program_id, name, event_type, amount, line_account_id, created_at, updated_at)
      VALUES ('rule-used', 'default', '来店', 'visit', 10, 'account-1', datetime('now'), datetime('now')),
             ('rule-void-only', 'default', '取消済み', 'visit', 10, 'account-1', datetime('now'), datetime('now')),
             ('rule-clean', 'default', '未使用', 'visit', 10, 'account-1', datetime('now'), datetime('now'));

      INSERT INTO friends (id, line_user_id, line_account_id)
      VALUES ('friend-1', 'U1', 'account-1');

      INSERT INTO mileage_ledger
        (id, program_id, beneficiary_friend_id, mileage_rule_id,
         entry_type, status, amount, reason, source,
         idempotency_key, occurred_at, created_at)
      VALUES ('ledger-1', 'default', 'friend-1', 'rule-used',
              'grant', 'available', 10, '来店', 'visit',
              'key-1', datetime('now'), datetime('now')),
             ('ledger-2', 'default', 'friend-1', 'rule-void-only',
              'grant', 'void', 10, '来店', 'visit',
              'key-2', datetime('now'), datetime('now'));
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('付与履歴がある決めごとは履歴ありと判定する', async () => {
    await expect(hasMileageRuleHistory(db, 'rule-used')).resolves.toBe(true);
  });

  it('取り消し済みの行だけでも履歴ありと判定する', async () => {
    await expect(hasMileageRuleHistory(db, 'rule-void-only')).resolves.toBe(true);
  });

  it('履歴がない決めごとは履歴なしと判定する', async () => {
    await expect(hasMileageRuleHistory(db, 'rule-clean')).resolves.toBe(false);
  });

  it('存在しない決めごとは履歴なしと判定する', async () => {
    await expect(hasMileageRuleHistory(db, 'missing')).resolves.toBe(false);
  });
});
