import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * 実の停止API・公開APIを、別のD1接続からの割り込みと一緒に動かす試験(#621)。
 *
 * ここでは @line-crm/db を差し替えない。実装が本当に使っている lease の
 * 書込み条件を通す。試験の中に「理想の手順」を書き直すと、実装から fence を
 * 外しても緑のままになり、逆変異を検出できない。
 * 差し替えるのは LINE への fetch と権限判定だけ。
 */

const accountAccessMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
}));
vi.mock('../services/account-access.js', () => accountAccessMocks);

const { richMenuGroups } = await import('./rich-menu-groups.js');
const {
  acquirePublishLease,
  isPublishLeaseHeld,
} = await import('@line-crm/db');

type TestEnv = {
  Variables: { staff: { id: string; role: 'owner' | 'admin' | 'staff' } };
  Bindings: { DB: D1Database; IMAGES: R2Bucket };
};

/**
 * 実スキーマ(bootstrap.sql)からそのまま作る。
 * 手書きの写しにすると列のズレで route が 500 になり、
 * 「競合で止まった」のか「試験のスキーマが古い」のか見分けられなくなる。
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

/** 指定文が実行される直前に一度だけ割り込む。 */
function hookedDb(db: D1Database, match: RegExp, hook: () => Promise<void>): D1Database {
  let fired = false;
  const runHook = async () => {
    if (fired) return;
    fired = true;
    await hook();
  };
  type Bound = { run(): Promise<unknown>; first<T>(): Promise<T>; all<T>(): Promise<T> };
  const wrapBound = (bound: Bound) => ({
    async run() { await runHook(); return bound.run(); },
    async first<T,>() { await runHook(); return bound.first<T>(); },
    async all<T,>() { await runHook(); return bound.all<T>(); },
  });
  return {
    ...(db as unknown as Record<string, unknown>),
    prepare: (query: string) => {
      const real = (db as unknown as {
        prepare(q: string): { bind(...p: unknown[]): Bound } & Bound;
      }).prepare(query);
      if (!match.test(query)) return real;
      return {
        bind: (...p: unknown[]) => wrapBound(real.bind(...p)),
        run: () => wrapBound(real).run(),
        first: <T,>() => wrapBound(real).first<T>(),
        all: <T,>() => wrapBound(real).all<T>(),
      };
    },
  } as unknown as D1Database;
}

function makeR2Stub(): R2Bucket {
  return {
    async put() { return {} as never; },
    async get() { return null; },
  } as unknown as R2Bucket;
}

function setupApp(db: D1Database) {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', role: 'owner' });
    c.env = { DB: db, IMAGES: makeR2Stub() };
    await next();
  });
  app.route('/', richMenuGroups);
  return app;
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = setupSqlite();
  db = asD1(sqlite);
  sqlite.prepare(
    `INSERT INTO rich_menu_groups (id, account_id, name, status, size, chat_bar_text, is_default_for_all)
     VALUES ('g1', 'acc-1', 'メニュー', 'published', 'large', 'menu', 1)`,
  ).run();
  sqlite.prepare(
    `INSERT INTO rich_menu_pages (id, group_id, order_index, name, alias_id, line_richmenu_id)
     VALUES ('p1', 'g1', 0, 'ページ1', 'lhx-g1-0', 'line-old-1')`,
  ).run();
  // LINE への呼び出しはすべて成功したことにする。
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

function groupRow() {
  return sqlite.prepare(
    `SELECT status AS s, publishing_owner AS o, publishing_generation AS g FROM rich_menu_groups WHERE id = 'g1'`,
  ).get() as { s: string; o: string | null; g: number };
}

function pageRichMenuId(): string | null {
  return (sqlite.prepare(`SELECT line_richmenu_id AS v FROM rich_menu_pages WHERE id = 'p1'`).get() as { v: string | null }).v;
}

/** 実行が長引いて lease が切れた状態を作る(時刻の担い手はこの行だけ)。 */
function expireLease() {
  sqlite.prepare(
    `UPDATE rich_menu_groups SET publishing_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = 'g1'`,
  ).run();
}

describe('実の停止API × 別D1接続の割り込み', () => {
  test('停止の確定直前に別接続が引き継ぐと、409で止まりpage IDもgroupも変えない', async () => {
    const dbTaker = asD1(sqlite);
    let takerGeneration: number | null = null;

    // 停止APIが「group を draft にする」1文を書く直前に、
    // 実行が長引いて lease が切れ、別接続がそれを取る。
    const dbRoute = hookedDb(db, /UPDATE rich_menu_groups\s+SET status = 'draft'/, async () => {
      expireLease();
      takerGeneration = await acquirePublishLease(dbTaker, 'g1', 'taker-1', new Date().toISOString());
    });

    const res = await setupApp(dbRoute).request('/api/rich-menu-groups/g1/unpublish', { method: 'POST' });

    // 別接続は確かに取れている。
    expect(takerGeneration).toBe(2);
    // 停止APIは成功扱いにしない。
    expect(res.status).toBe(409);
    // 公開中の page ID は消えていない。group も published のまま。
    expect(pageRichMenuId()).toBe('line-old-1');
    expect(groupRow().s).toBe('published');
    // 新しい所有者の lease は無傷。
    expect(groupRow().o).toBe('taker-1');
    expect(groupRow().g).toBe(2);
    expect(await isPublishLeaseHeld(db, 'g1', new Date().toISOString())).toBe(true);
  });

  test('割り込みが無ければ停止は通り、leaseは所有者付きの解放で空く', async () => {
    const res = await setupApp(db).request('/api/rich-menu-groups/g1/unpublish', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(pageRichMenuId()).toBeNull();
    expect(groupRow().s).toBe('draft');
    expect(groupRow().o).toBeNull();
    expect(await isPublishLeaseHeld(db, 'g1', new Date().toISOString())).toBe(false);
  });

  test('取り込みが確定直前に失権したら、409で止まり公開扱いにしない', async () => {
    // 取り込みも group の状態を変える経路。lease を持ったまま alias を作り、
    // 札付き書込みの false を無視しないことを、実の取り込みAPIで見る。
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/content')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200, headers: { 'content-type': 'image/png' },
        });
      }
      if (/\/v2\/bot\/richmenu\/[^/]+$/.test(url)) {
        return new Response(JSON.stringify({
          richMenuId: 'line-imported-1',
          name: '取り込み',
          chatBarText: 'menu',
          size: { width: 2500, height: 1686 },
          areas: [],
        }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }));

    const dbTaker = asD1(sqlite);
    let takerGeneration: number | null = null;

    // 取り込みが page へ ID を書く直前に、lease が切れて別接続が取る。
    const dbRoute = hookedDb(db, /UPDATE rich_menu_pages SET line_richmenu_id = \?/, async () => {
      const created = sqlite.prepare(
        `SELECT id FROM rich_menu_groups WHERE id <> 'g1' ORDER BY rowid DESC LIMIT 1`,
      ).get() as { id: string } | undefined;
      if (!created) return;
      sqlite.prepare(
        `UPDATE rich_menu_groups SET publishing_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`,
      ).run(created.id);
      takerGeneration = await acquirePublishLease(dbTaker, created.id, 'taker-2', new Date().toISOString());
    });

    const res = await setupApp(dbRoute).request(
      '/api/rich-menu-groups/import?accountId=acc-1&richMenuId=line-imported-1',
      { method: 'POST' },
    );

    expect(takerGeneration).toBe(2);
    // 成功応答にしない。
    expect(res.status).toBe(409);
    const created = sqlite.prepare(
      `SELECT id, status FROM rich_menu_groups WHERE id <> 'g1' ORDER BY rowid DESC LIMIT 1`,
    ).get() as { id: string; status: string };
    // 公開扱いになっていない。page にも ID が入っていない。
    expect(created.status).toBe('draft');
    const page = sqlite.prepare(
      `SELECT line_richmenu_id AS v FROM rich_menu_pages WHERE group_id = ?`,
    ).get(created.id) as { v: string | null };
    expect(page.v).toBeNull();
    // 新しい所有者の lease は無傷。
    const held = sqlite.prepare(
      `SELECT publishing_owner AS o FROM rich_menu_groups WHERE id = ?`,
    ).get(created.id) as { o: string | null };
    expect(held.o).toBe('taker-2');
  });

  test('別の処理が公開中なら停止は取得の時点で409になり、何も変えない', async () => {
    const dbOther = asD1(sqlite);
    const generation = await acquirePublishLease(dbOther, 'g1', 'publisher-1', new Date().toISOString());
    expect(generation).toBe(1);

    const res = await setupApp(db).request('/api/rich-menu-groups/g1/unpublish', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(pageRichMenuId()).toBe('line-old-1');
    expect(groupRow().s).toBe('published');
    expect(groupRow().o).toBe('publisher-1');
  });
});
