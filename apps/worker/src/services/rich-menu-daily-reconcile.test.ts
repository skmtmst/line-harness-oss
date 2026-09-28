import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jstDayStart, processDailyRichMenuReconcile } from './rich-menu-daily-reconcile.js';
import type { LineRichMenuClient } from '../lib/rich-menu-publisher.js';

/**
 * K(#822): 毎日の自動照合。実SQLite＋偽LINE client。
 * 見つけたずれは直さず台帳に残す。同じ日は2回見ない。
 */

const BOOTSTRAP_SQL = readFileSync(
  join(import.meta.dirname, '../../../../packages/db/bootstrap.sql'),
  'utf8',
);

function setupSqlite() {
  const sqlite = new Database(':memory:');
  sqlite.exec(BOOTSTRAP_SQL);
  sqlite.prepare(
    `INSERT INTO line_accounts (id, name, channel_id, channel_access_token, channel_secret)
     VALUES ('acc-1', 'アカウント', 'ch-1', 'token', 'secret')`,
  ).run();
  return sqlite;
}

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const build = (...params: unknown[]) => {
        const stmt = sqlite.prepare(query);
        return {
          async run() {
            const info = stmt.run(...params);
            return { success: true, meta: { changes: info.changes } };
          },
          async first<T>() {
            return (stmt.reader ? (stmt.get(...params) as T) : null) ?? null;
          },
          async all<T>() {
            return { results: stmt.all(...params) as T[], success: true, meta: {} };
          },
        };
      };
      return {
        bind: (...params: unknown[]) => build(...params),
        run: () => build().run(),
        first: <T,>() => build().first<T>(),
        all: <T,>() => build().all<T>(),
      };
    },
    batch: async (stmts: unknown[]) => {
      for (const stmt of stmts as Array<{ run: () => Promise<unknown> }>) await stmt.run();
      return [];
    },
  } as unknown as D1Database;
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = setupSqlite();
  db = asD1(sqlite);
});

function insertPublishedGroup(id = 'g1') {
  sqlite.prepare(
    `INSERT INTO rich_menu_groups (id, account_id, name, status, size, chat_bar_text, is_default_for_all)
     VALUES (?, 'acc-1', 'メニュー', 'published', 'large', 'menu', 0)`,
  ).run(id);
  sqlite.prepare(
    `INSERT INTO rich_menu_pages (id, group_id, order_index, name, alias_id, line_richmenu_id)
     VALUES ('p1', ?, 0, 'ページ1', 'lhx-x-0', 'rm-gone')`,
  ).run(id);
}

function fakeLine(): LineRichMenuClient {
  return {
    listRichMenus: vi.fn(async () => []),
    getCurrentDefaultRichMenuId: vi.fn(async () => null),
  } as unknown as LineRichMenuClient;
}

describe('毎日の自動照合', () => {
  it('公開中だけ見て、ずれを直さず台帳に残す', async () => {
    insertPublishedGroup('g1');
    sqlite.prepare(
      `INSERT INTO rich_menu_groups (id, account_id, name, status, size, chat_bar_text, is_default_for_all)
       VALUES ('g2', 'acc-1', '下書き', 'draft', 'large', 'menu', 0)`,
    ).run();

    const result = await processDailyRichMenuReconcile(db, {
      now: new Date('2026-09-27T00:00:00.000Z'),
      makeLineClient: () => fakeLine(),
      newId: () => `run-${Math.random().toString(36).slice(2)}`,
    });
    expect(result).toEqual({ checked: 1, withDiffs: 1, failed: 0 });

    const runs = sqlite.prepare(`SELECT mode AS m, status AS s, diffs_json AS d FROM rich_menu_publish_runs`).all() as Array<{ m: string; s: string; d: string }>;
    expect(runs).toHaveLength(1);
    expect(runs[0].m).toBe('scheduled_reconcile');
    expect(runs[0].s).toBe('succeeded');
    expect(JSON.parse(runs[0].d)).toContain('stale_page_richmenu_id');
    // 直していない（記録は外したまま）
    const page = sqlite.prepare(`SELECT line_richmenu_id AS v FROM rich_menu_pages WHERE id = 'p1'`).get() as { v: string | null };
    expect(page.v).toBe('rm-gone');
  });

  it('同じ日は2回見ない。日が変わればまた見る', async () => {
    insertPublishedGroup('g1');
    let n = 0;
    const deps = (now: Date) => ({
      now,
      makeLineClient: () => fakeLine(),
      newId: () => `run-${(n += 1)}`,
    });

    const first = await processDailyRichMenuReconcile(db, deps(new Date('2026-09-27T00:00:00.000Z')));
    expect(first.checked).toBe(1);
    const second = await processDailyRichMenuReconcile(db, deps(new Date('2026-09-27T12:00:00.000Z')));
    expect(second).toEqual({ checked: 0, withDiffs: 0, failed: 0 });
    const third = await processDailyRichMenuReconcile(db, deps(new Date('2026-09-28T00:00:00.000Z')));
    expect(third.checked).toBe(1);
  });

  it('LINEが読めない group は数えるだけで止めない', async () => {
    insertPublishedGroup('g1');
    const broken = { listRichMenus: vi.fn(async () => { throw new Error('LINE down'); }) } as unknown as LineRichMenuClient;
    const result = await processDailyRichMenuReconcile(db, {
      now: new Date('2026-09-27T00:00:00.000Z'),
      makeLineClient: () => broken,
    });
    expect(result).toEqual({ checked: 0, withDiffs: 0, failed: 1 });
  });

  it('日本日の始まりは9時間ずらす', () => {
    // 09-27 08:59 UTC = 09-27 17:59 JST → 09-27
    expect(jstDayStart(new Date('2026-09-27T08:59:00.000Z'))).toBe('2026-09-27T00:00:00.000');
    // 09-27 15:00 UTC = 09-28 00:00 JST → 09-28
    expect(jstDayStart(new Date('2026-09-27T15:00:00.000Z'))).toBe('2026-09-28T00:00:00.000');
  });
});
