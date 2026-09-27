import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ERROR_MESSAGE_SEED,
  createRecipe,
  getRecipeById,
  listErrorMessages,
  listRecipes,
} from '../src/index.js';

/**
 * migration 463・464: エラー文面の対応表と組織レシピ（要件 v6-34 §9・§7-5）。
 *
 * 守りたいのは 3 点。
 *   1. 対応表の初期データが入っていて、文面と次の行動が引ける
 *   2. 組織レシピは持ち主のアカウントの範囲にだけ見える
 *   3. 「閉じた」列が増えても既存の行を壊さない
 */

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

describe('migration 463・464 エラー対応表と組織レシピ', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES
        ('account-1', 'ch-1', '本店', 't1', 's1'),
        ('account-2', 'ch-2', '支店', 't2', 's2');
      INSERT INTO recipes
        (id, name, purpose, creates_summary, version, origin, required_features,
         items_json, item_count, display_order, created_at, updated_at)
      VALUES
        ('recipe-builtin', '初期同梱', '案内を作る', 'タグ1件', 1, 'builtin', '[]',
         NULL, NULL, 1, '2026-09-07T00:00:00Z', '2026-09-07T00:00:00Z');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('対応表の初期データが入っていて、文面と次の行動が引ける', async () => {
    const rows = await listErrorMessages(db);
    expect(rows.length).toBeGreaterThanOrEqual(40);
    const internal = rows.find((row) => row.code === 'Internal Server Error');
    expect(internal?.message).toContain('追跡番号');
    expect(internal?.next_action_kind).toBe('retry');
    // 出典の無い行を作らない（§9-2「追加するときは出典を必ず書く」）。
    expect(rows.every((row) => row.source.trim().length > 0)).toBe(true);
    // 文面に内部語・英語の原文を混ぜない。
    expect(rows.every((row) => !/SQLITE|stack|undefined|null/i.test(row.message))).toBe(true);
  });

  it('「閉じた」列が増えても既存のスタッフ行を壊さない', () => {
    sqlite.exec(`
      INSERT INTO staff_members (id, name, role, api_key)
      VALUES ('staff-1', '担当', 'owner', 'key-1');
    `);
    const row = sqlite
      .prepare(`SELECT getting_started_dismissed_at FROM staff_members WHERE id = 'staff-1'`)
      .get() as { getting_started_dismissed_at: string | null };
    expect(row.getting_started_dismissed_at).toBeNull();
  });

  it('migration の種データとコード側の seed が一致する（どちらか片方だけ更新しない）', () => {
    const sql = readFileSync(
      join(import.meta.dirname, '..', 'migrations', '463_error_messages_and_getting_started_dismiss.sql'),
      'utf8',
    );
    const codes = new Set(ERROR_MESSAGE_SEED.map((row) => row.code));
    for (const row of ERROR_MESSAGE_SEED) {
      expect(
        sql.includes(`('${row.code}'`),
        `migration 463 に '${row.code}' の行がありません`,
      ).toBe(true);
    }
    // 逆方向：migration にだけある行も無いか。
    const migrationCodes = [...sql.matchAll(/^\s*\('([^']+)'/gm)].map((m) => m[1]);
    for (const code of migrationCodes) {
      expect(codes.has(code), `ERROR_MESSAGE_SEED に '${code}' がありません`).toBe(true);
    }
  });

  it('組織レシピを作れる（origin=org、持ち主のアカウントを持つ）', async () => {
    const recipe = await createRecipe(db, {
      name: '新規登録7日間フォロー',
      purpose: '友だちが増えたあと、7日かけて関係を作ります。',
      createsSummary: 'タグ1つ、シナリオ7通',
      lineAccountId: 'account-1',
      createdByStaffId: 'staff-1',
      items: [{ kind: 'tag', name: '新規', note: '案内用' }],
    });
    expect(recipe.origin).toBe('org');
    expect(recipe.line_account_id).toBe('account-1');
    expect(recipe.item_count).toBe(1);
  });

  it('組織レシピは持ち主の範囲にだけ見える', async () => {
    await createRecipe(db, {
      name: '本店だけのレシピ',
      purpose: 'p',
      createsSummary: 'c',
      lineAccountId: 'account-1',
    });
    const account1 = await listRecipes(db, 'account-1');
    expect(account1.map((r) => r.id)).toContain('recipe-builtin');
    expect(account1.filter((r) => r.origin === 'org')).toHaveLength(1);

    const account2 = await listRecipes(db, 'account-2');
    expect(account2.map((r) => r.id)).toEqual(['recipe-builtin']);

    const noAccount = await listRecipes(db);
    expect(noAccount.map((r) => r.id)).toEqual(['recipe-builtin']);
  });

  it('別の組織のレシピは無いものとして扱う（404相当）', async () => {
    const recipe = await createRecipe(db, {
      name: '本店だけのレシピ',
      purpose: 'p',
      createsSummary: 'c',
      lineAccountId: 'account-1',
    });
    expect(await getRecipeById(db, recipe.id, 'account-1')).not.toBeNull();
    expect(await getRecipeById(db, recipe.id, 'account-2')).toBeNull();
    expect(await getRecipeById(db, recipe.id, null)).toBeNull();
    // accountId を渡さない呼び出しは範囲を絞らない（内部の複製導線用）。
    expect(await getRecipeById(db, recipe.id)).not.toBeNull();
  });
});
