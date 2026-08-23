import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const migrationPath = join(packageRoot, 'migrations', '176_tenant_foundation.sql');
const BENIGN_REPLAY_ERROR = /duplicate column name|already exists/i;

function applyMigration(db: Database.Database): void {
  const statements = readFileSync(migrationPath, 'utf8')
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    try {
      db.exec(statement);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!BENIGN_REPLAY_ERROR.test(message)) throw error;
    }
  }
}

describe('176 tenant foundation', () => {
  it('既存行を既定の統括へ割り当て、安全なマイグレーション経路で再実行できる', () => {
    const db = new Database(':memory:');
    db.exec(readFileSync(join(packageRoot, 'schema.sql'), 'utf8'));
    db.exec(readFileSync(join(packageRoot, 'migrations', '168_restaurant_test_foundation.sql'), 'utf8'));
    db.prepare(`INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('line-1', 'channel-1', '店舗LINE', 'token', 'secret')`).run();
    db.prepare(`INSERT INTO staff_members
      (id, name, role, api_key) VALUES ('staff-1', '担当者', 'admin', 'api-key')`).run();
    db.prepare(`INSERT INTO rt_organizations
      (id, account_id, name) VALUES ('org-1', 'line-1', '飲食店組織')`).run();

    applyMigration(db);
    const defaultTenantId = '00000000-0000-4000-8000-000000000001';
    for (const table of ['line_accounts', 'staff_members', 'rt_organizations']) {
      expect(db.prepare(`SELECT tenant_id FROM ${table}`).get()).toEqual({
        tenant_id: defaultTenantId,
      });
    }

    // 再実行前にNULLへ戻し、データ補完も再び効くことを確認する。
    db.exec(`UPDATE line_accounts SET tenant_id = NULL;
      UPDATE staff_members SET tenant_id = NULL;
      UPDATE rt_organizations SET tenant_id = NULL;`);
    expect(() => applyMigration(db)).not.toThrow();
    for (const table of ['line_accounts', 'staff_members', 'rt_organizations']) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id IS NULL`).get())
        .toEqual({ count: 0 });
    }
    expect(db.prepare('SELECT id, name FROM tenants').all()).toEqual([
      { id: defaultTenantId, name: '既定の統括' },
    ]);
  });
});
