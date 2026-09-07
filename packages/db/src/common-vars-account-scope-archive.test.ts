import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CommonVarKeyConflictError,
  createCommonVar,
  deleteCommonVar,
  getCommonVarByIdIncludingArchived,
  getCommonVarVersions,
  getCommonVars,
} from './common-vars.js';

const packageRoot = join(import.meta.dirname, '..');
const migration = readFileSync(
  join(packageRoot, 'migrations', '338_common_vars_account_scoped_key_and_archive.sql'),
  'utf8',
);

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes }, results: [] } as T;
      },
    } as unknown as D1PreparedStatement);
    return bound([]);
  }
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run())) as T;
    },
  } as unknown as D1Database;
}

function insertAccount(sqlite: Database.Database, id: string): void {
  sqlite.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, ?, 'token', 'secret')`,
  ).run(id, `channel-${id}`, id);
}

describe('migration 338 のアカウント単位の差し込み名', () => {
  it('同一アカウントの既存重複だけを理由付きでアーカイブし、子の履歴を残す', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE folders (id TEXT PRIMARY KEY);
      CREATE TABLE common_vars (
        id TEXT PRIMARY KEY, folder_id TEXT, name TEXT NOT NULL, var_key TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'text', value TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        line_account_id TEXT, memo TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
        updated_by TEXT, archived_at TEXT, replacement_run_id TEXT
      );
      CREATE TABLE common_var_schedules (
        id TEXT PRIMARY KEY, var_id TEXT NOT NULL REFERENCES common_vars(id) ON DELETE CASCADE,
        effective_from TEXT NOT NULL, value TEXT NOT NULL, applied_at TEXT
      );
      CREATE TABLE common_var_versions (
        id TEXT PRIMARY KEY,
        common_var_id TEXT NOT NULL REFERENCES common_vars(id) ON DELETE CASCADE,
        version_no INTEGER NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL,
        memo TEXT NOT NULL DEFAULT '', change_reason TEXT NOT NULL, actor_id TEXT,
        created_at TEXT NOT NULL, UNIQUE(common_var_id, version_no)
      );
      CREATE TABLE common_var_replacement_runs (
        id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
        source_common_var_id TEXT NOT NULL REFERENCES common_vars(id),
        replacement_common_var_id TEXT NOT NULL REFERENCES common_vars(id),
        source_version INTEGER NOT NULL, expected_usage_count INTEGER NOT NULL,
        replaced_usage_count INTEGER NOT NULL, actor_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('completed', 'partial')), created_at TEXT NOT NULL
      );
      INSERT INTO line_accounts (id) VALUES ('account-a'), ('account-b');
      INSERT INTO common_vars
        (id, name, var_key, value, created_at, updated_at, line_account_id)
      VALUES
        ('old', '営業時間（旧）', 'shop_hours', '9-18', '2026-01-01', '2026-01-01', 'account-a'),
        ('newer', '営業時間（重複）', 'shop_hours', '10-19', '2026-02-01', '2026-02-01', 'account-a'),
        ('other', '営業時間', 'shop_hours', '11-20', '2026-03-01', '2026-03-01', 'account-b');
      INSERT INTO common_var_versions
        (id, common_var_id, version_no, name, value, change_reason, created_at)
      VALUES ('newer-v1', 'newer', 1, '営業時間（重複）', '10-19', '作成', '2026-02-01');
      INSERT INTO common_var_schedules (id, var_id, effective_from, value)
      VALUES ('schedule-1', 'newer', '2026-09-01', '10-20');
    `);

    sqlite.exec(migration);

    expect(sqlite.prepare(
      `SELECT id, var_key, archived_at, version FROM common_vars ORDER BY id`,
    ).all()).toEqual([
      { id: 'newer', var_key: 'shop_hours__archived_newer', archived_at: expect.any(String), version: 2 },
      { id: 'old', var_key: 'shop_hours', archived_at: null, version: 1 },
      { id: 'other', var_key: 'shop_hours', archived_at: null, version: 1 },
    ]);
    expect(sqlite.prepare(
      `SELECT change_reason FROM common_var_versions
        WHERE common_var_id = 'newer' ORDER BY version_no`,
    ).all()).toEqual([
      { change_reason: '作成' },
      { change_reason: '同一アカウント内で重複していた差し込み名を整理してアーカイブ' },
    ]);
    expect(sqlite.prepare(`SELECT var_id FROM common_var_schedules`).get())
      .toEqual({ var_id: 'newer' });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(() => sqlite.prepare(
      `INSERT INTO common_vars
         (id, name, var_key, created_at, updated_at, line_account_id)
       VALUES ('same-account', '重複', 'shop_hours', '2026-04-01', '2026-04-01', 'account-a')`,
    ).run()).toThrow(/UNIQUE constraint failed/);
  });
});

describe('共通情報のアカウント分離とアーカイブ', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    insertAccount(sqlite, 'account-a');
    insertAccount(sqlite, 'account-b');
    db = asD1(sqlite);
  });

  it('別アカウントでは同じ差し込み名を作れ、同一アカウントだけを重複扱いにする', async () => {
    await createCommonVar(db, {
      lineAccountId: 'account-a', name: 'A店営業時間', varKey: 'shop_hours', actorId: 'staff-a',
    });
    await expect(createCommonVar(db, {
      lineAccountId: 'account-b', name: 'B店営業時間', varKey: 'shop_hours', actorId: 'staff-b',
    })).resolves.toMatchObject({ line_account_id: 'account-b', var_key: 'shop_hours' });
    await expect(createCommonVar(db, {
      lineAccountId: 'account-a', name: 'A店重複', varKey: 'shop_hours', actorId: 'staff-a',
    })).rejects.toBeInstanceOf(CommonVarKeyConflictError);
  });

  it('削除後は一覧から消えるが、行と理由付き履歴は残る', async () => {
    const created = await createCommonVar(db, {
      lineAccountId: 'account-a', name: '営業時間', varKey: 'shop_hours',
      value: '10-19', memo: '店舗共通', actorId: 'staff-a',
    });

    await deleteCommonVar(db, created.id, 'account-a', 'staff-a', '運用終了のため削除');

    await expect(getCommonVars(db, { lineAccountId: 'account-a' })).resolves.toEqual([]);
    await expect(getCommonVarByIdIncludingArchived(db, created.id, 'account-a')).resolves
      .toMatchObject({ id: created.id, archived_at: expect.any(String), version: 2 });
    await expect(getCommonVarVersions(db, created.id, 'account-a')).resolves.toEqual([
      expect.objectContaining({ version_no: 2, change_reason: '運用終了のため削除', actor_id: 'staff-a' }),
      expect.objectContaining({ version_no: 1, change_reason: '作成' }),
    ]);
  });
});
