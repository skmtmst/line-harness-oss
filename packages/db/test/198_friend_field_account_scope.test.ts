import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getFriendFieldListSummary,
  getFriendFieldsForScope,
  getFriendFieldValuesForMigration,
} from '../src/friend-fields.js';
import { asD1 } from './d1-test-helper.js';

const ROOT = join(import.meta.dirname, '..');
const MIGRATION = readFileSync(join(ROOT, 'migrations/198_friend_field_account_scope.sql'), 'utf8');
const LEGACY_TENANT = '00000000-0000-4000-8000-000000000001';

describe('198 友だち情報欄のLINEアカウント分離', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
      CREATE TABLE tenants (id TEXT PRIMARY KEY);
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id));
      CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL REFERENCES line_accounts(id));
      CREATE TABLE folders (id TEXT PRIMARY KEY);
      CREATE TABLE friend_fields (
        id TEXT PRIMARY KEY, folder_id TEXT, name TEXT NOT NULL, field_key TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL, options_json TEXT, default_value TEXT, source TEXT NOT NULL DEFAULT 'manual',
        ec_field_path TEXT, ec_is_master INTEGER NOT NULL DEFAULT 0, is_personal INTEGER NOT NULL DEFAULT 0,
        is_starred INTEGER NOT NULL DEFAULT 0, display_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE friend_field_values (
        friend_id TEXT NOT NULL REFERENCES friends(id), field_id TEXT NOT NULL REFERENCES friend_fields(id),
        value TEXT, updated_by TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY (friend_id, field_id)
      );
      INSERT INTO tenants VALUES ('${LEGACY_TENANT}'), ('tenant-2');
      INSERT INTO line_accounts VALUES ('account-1', '${LEGACY_TENANT}'), ('account-2', '${LEGACY_TENANT}'), ('account-3', 'tenant-2');
      INSERT INTO friends VALUES ('friend-1', 'account-1'), ('friend-2', 'account-2');
      INSERT INTO friend_fields VALUES
        ('legacy', NULL, '共通項目', 'legacy_key', 'text', NULL, NULL, 'manual', NULL, 0, 0, 0, 0, '2026-01-01', '2026-01-01'),
        ('account-field', NULL, '店舗1専用', 'account_key', 'text', NULL, NULL, 'manual', NULL, 0, 0, 0, 1, '2026-01-01', '2026-01-01');
    `);
    sqlite.exec(MIGRATION);
    sqlite.prepare(`INSERT INTO friend_field_scopes (field_id, tenant_id, line_account_id, created_at) VALUES (?, ?, ?, ?)`)
      .run('account-field', LEGACY_TENANT, 'account-1', '2026-01-01');
    db = asD1(sqlite);
  });

  it('既存の共通項目を残し、別アカウントの専用項目を見せない', async () => {
    expect((await getFriendFieldsForScope(db, { tenantId: LEGACY_TENANT, lineAccountId: 'account-1' })).map((field) => field.id))
      .toEqual(['account-field', 'legacy']);
    expect((await getFriendFieldsForScope(db, { tenantId: LEGACY_TENANT, lineAccountId: 'account-2' })).map((field) => field.id))
      .toEqual(['legacy']);
    expect(await getFriendFieldsForScope(db, { tenantId: 'tenant-2', lineAccountId: 'account-3' }))
      .toEqual([]);
  });

  it('dry-runは選択中アカウントの友だちだけを読む', async () => {
    sqlite.prepare(`INSERT INTO friend_field_values VALUES (?, ?, ?, ?, datetime('now'))`).run('friend-1', 'legacy', '店舗1', 'form');
    sqlite.prepare(`INSERT INTO friend_field_values VALUES (?, ?, ?, ?, datetime('now'))`).run('friend-2', 'legacy', '店舗2', 'form');
    expect(await getFriendFieldValuesForMigration(db, 'legacy', { tenantId: LEGACY_TENANT, lineAccountId: 'account-1' }))
      .toEqual([{ friend_id: 'friend-1', value: '店舗1' }]);
  });

  it('一覧の人数は項目ごとの合計ではなく、友だちを重複せず数える', async () => {
    sqlite.prepare(`INSERT INTO friend_field_values VALUES (?, ?, ?, ?, datetime('now'))`).run('friend-1', 'legacy', '値1', 'form');
    sqlite.prepare(`INSERT INTO friend_field_values VALUES (?, ?, ?, ?, datetime('now'))`).run('friend-1', 'account-field', '値2', 'form');
    await expect(getFriendFieldListSummary(db, { tenantId: LEGACY_TENANT, lineAccountId: 'account-1' }))
      .resolves.toMatchObject({ total: 2, inUse: 2, registeredFriends: 1, updatedThisMonth: 2, formLinks: null });
  });
});
