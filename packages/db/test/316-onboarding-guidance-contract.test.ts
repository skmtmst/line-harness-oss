import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ManualLinkVersionConflictError,
  getManualLink,
  recordCheck,
  startCloneRun,
  upsertManualLink,
} from '../src/index.js';

function asD1(sqlite: Database.Database): D1Database {
  const prepare = (sql: string): D1PreparedStatement => {
    const make = (params: unknown[]): D1PreparedStatement => {
      const execute = () => {
        const statement = sqlite.prepare(sql);
        if (statement.reader) {
          return { success: true, results: statement.all(...params), meta: { changes: 0 } };
        }
        const result = statement.run(...params);
        return { success: true, results: [], meta: { changes: result.changes } };
      };
      return {
        bind: (...next: unknown[]) => make(next),
        async all<T>() {
          return { success: true, results: sqlite.prepare(sql).all(...params) as T[], meta: {} };
        },
        async first<T>() {
          return (sqlite.prepare(sql).get(...params) as T | undefined) ?? null;
        },
        async run<T>() {
          return execute() as T;
        },
        raw: async () => [],
        __execute: execute,
      } as unknown as D1PreparedStatement;
    };
    return make([]);
  };
  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      const transaction = sqlite.transaction(() => statements.map((statement) =>
        (statement as unknown as { __execute: () => D1Result }).__execute()));
      return transaction();
    },
  } as unknown as D1Database;
}

describe('migration 316 はじめの設定と案内', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-1', 'channel-1', '本店', 'token', 'secret');
      INSERT INTO recipes
        (id, name, purpose, creates_summary, version, origin, required_features,
         items_json, item_count, display_order, created_at, updated_at)
      VALUES
        ('recipe-1', '案内', '案内を作る', 'タグ1件', 2, 'org', '[]',
         '[{"kind":"tag","name":"案内","note":"案内用"}]', 1, 1,
         '2026-09-07T00:00:00Z', '2026-09-07T00:00:00Z');
      INSERT INTO manual_links
        (key, key_kind, name, url, status, version, updated_at)
      VALUES ('screen-a', 'screen', '画面A', 'https://help.example.com/a', 'unset', 1,
              '2026-09-07T00:00:00Z');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('マニュアル正本を版付きで更新し、古い版を拒否する', async () => {
    const saved = await upsertManualLink(db, {
      key: 'screen-a',
      keyKind: 'screen',
      name: '画面A',
      url: 'https://help.example.com/new',
      expectedVersion: 1,
      updatedBy: 'env-owner',
    });
    expect(saved).toMatchObject({ version: 2, status: 'unset', last_checked_at: null });
    await expect(upsertManualLink(db, {
      key: 'screen-a',
      keyKind: 'screen',
      name: '古い更新',
      url: 'https://help.example.com/old',
      expectedVersion: 1,
    })).rejects.toBeInstanceOf(ManualLinkVersionConflictError);
  });

  it('リンク確認のHTTP結果と履歴を残す', async () => {
    await recordCheck(db, 'screen-a', {
      ok: false,
      httpStatus: 404,
      errorCode: 'HTTP_404',
      checkedBy: 'env-owner',
    });
    expect(await getManualLink(db, 'screen-a')).toMatchObject({
      status: 'broken', last_http_status: 404, last_error: 'HTTP_404',
    });
    expect(sqlite.prepare(`SELECT status, http_status, error_code, checked_by
                             FROM manual_link_check_history`).get()).toEqual({
      status: 'broken', http_status: 404, error_code: 'HTTP_404', checked_by: 'env-owner',
    });
  });

  it('複製runは版と入力指紋を持ち、queuedから始まる', async () => {
    const recipe = sqlite.prepare(`SELECT * FROM recipes WHERE id = 'recipe-1'`).get() as never;
    const run = await startCloneRun(db, {
      recipe,
      lineAccountId: 'account-1',
      namePrefix: '秋',
      idempotencyKey: 'clone-1',
      requestFingerprint: 'fingerprint-1',
      createdBy: 'staff-1',
    });
    expect(run).toMatchObject({
      recipe_version: 2,
      status: 'queued',
      request_fingerprint: 'fingerprint-1',
    });
  });

  it('複製対象6種が出どころとrunを保持できる', () => {
    for (const table of ['tags', 'templates', 'scenarios', 'reminders', 'auto_replies', 'friend_add_rules']) {
      const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
        'created_from_recipe_id', 'recipe_clone_run_id',
      ]));
    }
  });
});
