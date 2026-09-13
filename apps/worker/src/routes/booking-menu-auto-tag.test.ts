/*
 * E-03 #657: 予約メニューの自動タグ(menus.auto_tag_id)を、実 SQLite と実ルートで見張る。
 *
 * 文字列検査ではなく HTTP → ルート → 実 DB まで通す。ここで止めたい崩れ方:
 *
 *   1. 整理済み(archived)のタグを POST/PUT が受け取り、二度と使わないタグへ
 *      メニューが繋がったまま保存される。
 *   2. 別アカウントのタグ ID を保存できてしまう(cross-account)。
 *   3. 保存の時点では active でも、その後タグが整理された既存メニューが、
 *      予約成立時にそのまま付与し、後続副作用(シナリオ enrollment・
 *      tag_change イベント・マイル)まで動かす。
 *   4. auto_tag_id に文字列以外(数値・配列・オブジェクト・真偽値)が来ると
 *      `.trim()` が TypeError になり、入力不備が 500 として返る。
 *
 * 3 は「設定 → archive → 予約」を1本の実 DB で通して確かめる。waitUntil の
 * 中で付与するため、この試験の ExecutionContext は渡された Promise を集めて
 * 待つ(投げっぱなしにしない)。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Env } from '../index.js';

// 送る側(LINE 通知)は対象外。予約の成否とタグ付与だけを見る。
vi.mock('../services/booking-notifier.js', () => ({
  sendBookingNotification: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
}));

const { default: booking } = await import('./booking.js');

/** better-sqlite3 を D1 の口へ。`?` と `?1` の両方の並びを受ける。 */
function asD1(sqlite: Database.Database): D1Database {
  function call<T>(run: (...args: unknown[]) => T, params: unknown[]): T {
    try {
      return run(...params);
    } catch (error) {
      if (!/parameter/i.test(String((error as Error)?.message))) throw error;
      return run(Object.fromEntries(params.map((value, index) => [String(index + 1), value])));
    }
  }
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      const bound = (params: unknown[]): D1PreparedStatement => ({
        bind: (...next: unknown[]) => bound(next),
        all: async <T>() => ({
          success: true,
          results: call((...a) => statement.all(...a), params) as T[],
          meta: {},
        }),
        first: async <T>() => (call((...a) => statement.get(...a), params) as T | undefined) ?? null,
        run: async <T>() => {
          const changes = statement.reader
            ? (call((...a) => statement.all(...a), params) as unknown[]).length
            : call((...a) => statement.run(...a), params).changes;
          return { success: true, results: [], meta: { changes } } as T;
        },
        raw: async () => [],
      } as unknown as D1PreparedStatement);
      return bound([]);
    },
    async batch(statements: D1PreparedStatement[]) {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      return out;
    },
  };
  return db as unknown as D1Database;
}

/**
 * 自動タグの付与は fire-and-forget(waitUntil)。投げっぱなしにすると
 * 「付いていない」のか「まだ走っていない」のか見分けられないので、
 * 渡された Promise を集めて明示的に待てるようにする。
 */
function collectingExecCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => { pending.push(promise); },
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  return {
    ctx,
    async settle() {
      // waitUntil の中でさらに waitUntil が積まれても取りこぼさない。
      while (pending.length > 0) await Promise.allSettled(pending.splice(0));
    },
  };
}

const ACCOUNT = 'account-a';
const OTHER_ACCOUNT = 'account-b';
/** JST 2026-11-02(月) 11:00 = 02:00Z。下のシフト 10:00-19:00 の中。 */
const SLOT_UTC = '2026-11-02T02:00:00.000Z';

describe('E-03 #657 予約メニューの自動タグ: 保存時と実行時の active/account 検証', () => {
  let sqlite: Database.Database;
  let app: Hono<Env>;
  let env: { DB: D1Database };

  beforeEach(() => {
    // 「過去日時」で 422 になる時限式の試験にしないため時計を固定する。
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T03:00:00.000Z'));

    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, liff_id, timezone)
      VALUES
        ('${ACCOUNT}', 'channel-a', 'A店', 'token-a', 'secret-a', 'liff-a-1', 'Asia/Tokyo'),
        ('${OTHER_ACCOUNT}', 'channel-b', 'B店', 'token-b', 'secret-b', 'liff-b-1', 'Asia/Tokyo');
      INSERT INTO booking_settings (id, line_account_id, timezone)
      VALUES ('settings-a', '${ACCOUNT}', 'Asia/Tokyo');
      INSERT INTO staff (id, line_account_id, name, display_name)
      VALUES ('staff-a', '${ACCOUNT}', '担当A', '担当A');
      INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
      VALUES ('friend-a', 'U-a-1', '予約者A', '${ACCOUNT}', 1);
      INSERT INTO staff_shifts (id, staff_id, work_date, start_time, end_time)
      VALUES ('shift-nov2', 'staff-a', '2026-11-02', '10:00', '19:00');

      -- タグ3種: 同アカウントの有効／同アカウントの整理済み／別アカウントの有効
      INSERT INTO tags (id, name, color, line_account_id, status)
      VALUES
        ('tag-active', '予約済み', '#111111', '${ACCOUNT}', 'active'),
        ('tag-archived', '旧キャンペーン', '#222222', '${ACCOUNT}', 'archived'),
        ('tag-other-account', 'B店の有効タグ', '#333333', '${OTHER_ACCOUNT}', 'active');
    `);

    app = new Hono<Env>();
    app.use('*', async (c, next) => {
      c.set('staff', { id: 'staff-a', name: '担当A', role: 'owner', readOnly: false });
      return next();
    });
    app.route('/', booking);
    env = { DB: asD1(sqlite) };
  });

  afterEach(() => {
    sqlite.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function createMenu(body: Record<string, unknown>) {
    return app.request(
      `/api/booking/admin/menus?account_id=${ACCOUNT}`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'カット', duration_minutes: 60, buffer_after_minutes: 0, base_price: 8000,
          ...body,
        }),
        headers: { 'Content-Type': 'application/json' },
      },
      env,
    );
  }

  function updateMenu(id: string, body: Record<string, unknown>) {
    return app.request(
      `/api/booking/admin/menus/${id}?account_id=${ACCOUNT}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          name: 'カット', duration_minutes: 60, buffer_after_minutes: 0, base_price: 8000,
          ...body,
        }),
        headers: { 'Content-Type': 'application/json' },
      },
      env,
    );
  }

  function menuRows() {
    return sqlite.prepare(`SELECT id, name, auto_tag_id FROM menus ORDER BY id`).all() as
      Array<{ id: string; name: string; auto_tag_id: string | null }>;
  }

  describe('POST /api/booking/admin/menus', () => {
    test('同アカウントの有効タグは受け付け、実 DB に auto_tag_id が残る', async () => {
      const res = await createMenu({ auto_tag_id: 'tag-active' });
      expect(res.status).toBe(201);
      expect(menuRows()).toEqual([
        expect.objectContaining({ auto_tag_id: 'tag-active' }),
      ]);
    });

    test('整理済み(archived)タグは 400 tag_not_found で、メニュー自体を作らない', async () => {
      const res = await createMenu({ auto_tag_id: 'tag-archived' });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: 'tag_not_found' });
      expect(menuRows()).toEqual([]);
    });

    test('別アカウントの有効タグは 400 tag_not_found で、メニュー自体を作らない', async () => {
      const res = await createMenu({ auto_tag_id: 'tag-other-account' });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: 'tag_not_found' });
      expect(menuRows()).toEqual([]);
    });

    test('null と空文字はタグなしとして 201 で通す', async () => {
      expect((await createMenu({ auto_tag_id: null })).status).toBe(201);
      expect((await createMenu({ name: '空文字', auto_tag_id: '   ' })).status).toBe(201);
      expect(menuRows().map((row) => row.auto_tag_id)).toEqual([null, null]);
    });

    test.each([
      ['数値', 123],
      ['真偽値', true],
      ['配列', ['tag-active']],
      ['オブジェクト', { id: 'tag-active' }],
    ])('文字列以外(%s)の auto_tag_id は 400 invalid_auto_tag_id で、500 にしない', async (_label, value) => {
      const res = await createMenu({ auto_tag_id: value });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: 'invalid_auto_tag_id' });
      expect(menuRows()).toEqual([]);
    });
  });

  describe('PUT /api/booking/admin/menus/:id', () => {
    beforeEach(() => {
      sqlite.exec(`
        INSERT INTO menus (id, line_account_id, name, duration_minutes, buffer_after_minutes,
                           base_price, auto_tag_id)
        VALUES ('menu-a', '${ACCOUNT}', 'カット', 60, 0, 8000, 'tag-active');
      `);
    });

    function storedAutoTag() {
      return (sqlite.prepare(`SELECT auto_tag_id FROM menus WHERE id = 'menu-a'`)
        .get() as { auto_tag_id: string | null }).auto_tag_id;
    }

    test('整理済みタグへの付け替えは 400 で、いま入っている設定を壊さない', async () => {
      const res = await updateMenu('menu-a', { auto_tag_id: 'tag-archived' });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: 'tag_not_found' });
      expect(storedAutoTag()).toBe('tag-active');
    });

    test('別アカウントのタグへの付け替えは 400 で、いま入っている設定を壊さない', async () => {
      const res = await updateMenu('menu-a', { auto_tag_id: 'tag-other-account' });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: 'tag_not_found' });
      expect(storedAutoTag()).toBe('tag-active');
    });

    test('文字列以外の auto_tag_id は 400 invalid_auto_tag_id で、設定を壊さない', async () => {
      const res = await updateMenu('menu-a', { auto_tag_id: 42 });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: 'invalid_auto_tag_id' });
      expect(storedAutoTag()).toBe('tag-active');
    });

    test('auto_tag_id を送らない古いクライアントは、いまの設定を消さない', async () => {
      const res = await updateMenu('menu-a', {});
      expect(res.status).toBe(200);
      expect(storedAutoTag()).toBe('tag-active');
    });

    test('null を明示すれば解除できる', async () => {
      const res = await updateMenu('menu-a', { auto_tag_id: null });
      expect(res.status).toBe(200);
      expect(storedAutoTag()).toBeNull();
    });
  });

  describe('結合: 設定した後にタグを整理してから予約する', () => {
    /** LINE の id_token 検証だけ差し替える。DB もルートも本物のまま。 */
    function stubLineVerify() {
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('api.line.me/oauth2/v2.1/verify')) {
          return new Response(JSON.stringify({ sub: 'U-a-1' }), { status: 200 });
        }
        throw new Error(`想定外の外部呼び出し: ${url}`);
      }));
    }

    async function setUpMenuWithAutoTag(): Promise<string> {
      const created = await createMenu({ auto_tag_id: 'tag-active' });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      sqlite.prepare(`INSERT INTO staff_menus (staff_id, menu_id, is_offered) VALUES (?, ?, 1)`)
        .run('staff-a', id);
      return id;
    }

    function liffBook(menuId: string, key: string, exec: ExecutionContext) {
      return app.request(
        '/api/liff/booking/requests?liffId=liff-a-1',
        {
          method: 'POST',
          body: JSON.stringify({ menu_id: menuId, staff_id: 'staff-a', starts_at: SLOT_UTC }),
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
            Authorization: 'Bearer dummy-id-token',
          },
        },
        env,
        exec,
      );
    }

    function friendTagRows() {
      return sqlite.prepare(`SELECT friend_id, tag_id FROM friend_tags ORDER BY tag_id`).all() as
        Array<{ friend_id: string; tag_id: string }>;
    }

    test('有効なままなら、予約成立で自動タグが1件だけ付く', async () => {
      stubLineVerify();
      const menuId = await setUpMenuWithAutoTag();
      const exec = collectingExecCtx();

      const res = await liffBook(menuId, 'auto-tag-active-1', exec.ctx);
      expect(res.status).toBe(201);
      await exec.settle();

      expect(friendTagRows()).toEqual([{ friend_id: 'friend-a', tag_id: 'tag-active' }]);
    });

    test('設定後に整理されたタグは、予約は通っても付与も後続副作用も起こさない', async () => {
      stubLineVerify();
      const menuId = await setUpMenuWithAutoTag();

      // 設定した後にタグを整理する。メニューには auto_tag_id が残ったまま。
      sqlite.exec(`UPDATE tags SET status = 'archived' WHERE id = 'tag-active'`);
      expect(
        (sqlite.prepare(`SELECT auto_tag_id FROM menus WHERE id = ?`).get(menuId) as
          { auto_tag_id: string | null }).auto_tag_id,
      ).toBe('tag-active');

      const exec = collectingExecCtx();
      const res = await liffBook(menuId, 'auto-tag-archived-1', exec.ctx);
      // 予約そのものは通す。タグの整理は予約を断る理由にならない。
      expect(res.status).toBe(201);
      await exec.settle();

      // 付与されない = 後続副作用(シナリオ enrollment・tag_change・マイル)も走らない。
      expect(friendTagRows()).toEqual([]);
      expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM friend_scenarios`).get()).toEqual({ n: 0 });
    });

    test('メニューが別アカウントのタグを抱えていても、予約実行時に付与しない', async () => {
      stubLineVerify();
      const menuId = await setUpMenuWithAutoTag();

      // 保存の口は塞いだので、過去に入り込んだ行を直接作って実行時の守りだけを見る。
      sqlite.prepare(`UPDATE menus SET auto_tag_id = 'tag-other-account' WHERE id = ?`).run(menuId);

      const exec = collectingExecCtx();
      const res = await liffBook(menuId, 'auto-tag-cross-account-1', exec.ctx);
      expect(res.status).toBe(201);
      await exec.settle();

      expect(friendTagRows()).toEqual([]);
    });

    test('同じ Idempotency-Key の再送では、予約もタグ付与も二重にならない', async () => {
      stubLineVerify();
      const menuId = await setUpMenuWithAutoTag();
      const exec = collectingExecCtx();

      const first = await liffBook(menuId, 'auto-tag-retry-1', exec.ctx);
      expect(first.status).toBe(201);
      await exec.settle();
      const second = await liffBook(menuId, 'auto-tag-retry-1', exec.ctx);
      expect(second.status).toBe(201);
      await exec.settle();

      expect(await first.json()).toEqual(await second.json());
      expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM bookings`).get()).toEqual({ n: 1 });
      expect(friendTagRows()).toEqual([{ friend_id: 'friend-a', tag_id: 'tag-active' }]);
    });
  });
});
