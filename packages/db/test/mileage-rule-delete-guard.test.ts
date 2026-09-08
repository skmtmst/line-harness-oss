import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deleteMileageRule } from '../src/mileage.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database, seen: string[]): D1Database {
  function prepare(query: string): D1PreparedStatement {
    seen.push(query);
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

function ruleExists(sqlite: Database.Database, id: string): boolean {
  return sqlite.prepare(`SELECT 1 AS one FROM mileage_rules WHERE id = ?`).get(id) != null;
}

describe('マイル決めごとの原子削除', () => {
  let sqlite: Database.Database;
  let db: D1Database;
  let seen: string[];

  beforeEach(() => {
    seen = [];
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
    db = asD1(sqlite, seen);
  });

  afterEach(() => sqlite.close());

  it('付与履歴がある決めごとは0件で残る', async () => {
    await expect(deleteMileageRule(db, 'rule-used')).resolves.toBe(0);
    expect(ruleExists(sqlite, 'rule-used')).toBe(true);
  });

  it('取り消し済みの行だけでも0件で残る', async () => {
    await expect(deleteMileageRule(db, 'rule-void-only')).resolves.toBe(0);
    expect(ruleExists(sqlite, 'rule-void-only')).toBe(true);
  });

  it('履歴がない決めごとは1件で消える', async () => {
    await expect(deleteMileageRule(db, 'rule-clean')).resolves.toBe(1);
    expect(ruleExists(sqlite, 'rule-clean')).toBe(false);
  });

  it('二重削除の2回目は0件になる', async () => {
    await expect(deleteMileageRule(db, 'rule-clean')).resolves.toBe(1);
    await expect(deleteMileageRule(db, 'rule-clean')).resolves.toBe(0);
    expect(ruleExists(sqlite, 'rule-clean')).toBe(false);
  });

  it('DELETE文自体が履歴条件を持つ', async () => {
    await deleteMileageRule(db, 'rule-used');
    const deletes = seen.filter((q) => q.trimStart().toUpperCase().startsWith('DELETE'));
    expect(deletes.length).toBeGreaterThan(0);
    for (const q of deletes) {
      const upper = q.toUpperCase();
      expect(upper).toContain('DELETE FROM MILEAGE_RULES');
      expect(upper).toContain('NOT EXISTS');
      expect(upper).toContain('MILEAGE_LEDGER');
      expect(upper).toContain('MILEAGE_RULE_ID');
    }
  });
});
