import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { authMiddleware } from '../middleware/auth.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

/**
 * M950〜M954 の受け入れ試験（`/rich-menus/edit` 深い再監査の直し）。
 *
 * - 実SQLite (createTestD1: bootstrap.sql そのまま・batch は取引で包むので
 *   M950 の原子性を本物の意味で確かめられる)＋実 route＋実 auth。
 * - 差し替えるのは LINE への fetch と R2 だけ（外部副作用）。
 * - 逆変異の担保：直しを戻すと対応する試験が赤になる（M950 は meta だけ残る、
 *   M951 は版なし・古い版が 200、M952 は条件なし出し分けが 200、
 *   M953 は LINE 全滅でも 200・draft 確定、M954 は R2 に孤児が残る）。
 */
const { richMenuGroups } = await import('./rich-menu-groups.js');

const OWNER_KEY = 'test-owner-key';

function setupSqlite() {
  const { db, raw } = createTestD1();
  raw.prepare(
    `INSERT INTO line_accounts (id, name, channel_id, channel_access_token, channel_secret)
     VALUES ('acc-1', 'アカウント', 'ch-1', 'token', 'secret')`,
  ).run();
  raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, is_active)
     VALUES ('st-owner', 'オーナー', 'owner', ?, 1)`,
  ).run(OWNER_KEY);
  return { db, raw };
}

function makeR2Stub() {
  const store = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  const bucket = {
    store,
    deleted,
    async put(key: string, value: Uint8Array) {
      store.set(key, value);
      return {};
    },
    async get(key: string) {
      const body = store.get(key);
      return body ? { body, httpMetadata: {} } : null;
    },
    async delete(key: string) {
      deleted.push(key);
      store.delete(key);
    },
  };
  return bucket as unknown as R2Bucket & { store: Map<string, Uint8Array>; deleted: string[] };
}

function setupApp(db: D1Database, r2: R2Bucket) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.env = { DB: db, IMAGES: r2 } as never;
    await next();
  });
  app.use('*', authMiddleware as never);
  app.route('/', richMenuGroups);
  return app;
}

function authed(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${OWNER_KEY}`);
  return { path, init: { ...init, headers } };
}

const VALID_AREA = {
  boundsX: 0, boundsY: 0, boundsWidth: 100, boundsHeight: 100,
  actionType: 'uri', actionData: { uri: 'https://example.com' }, label: 'リンクを開く',
};

const PNG_2500x1686 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x09, 0xc4, 0x00, 0x00, 0x06, 0x96,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

let db: D1Database;
let raw: Database.Database;
let r2: ReturnType<typeof makeR2Stub>;

beforeEach(() => {
  const setup = setupSqlite();
  db = setup.db;
  raw = setup.raw;
  r2 = makeR2Stub();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function insertGroup(id: string, status: 'draft' | 'published') {
  raw.prepare(
    `INSERT INTO rich_menu_groups (id, account_id, name, status, size, chat_bar_text, is_default_for_all)
     VALUES (?, 'acc-1', 'メニュー', ?, 'large', 'menu', 0)`,
  ).run(id, status);
}

function insertPage(groupId: string, id: string, orderIndex: number, lineRichMenuId: string | null = null) {
  raw.prepare(
    `INSERT INTO rich_menu_pages (id, group_id, order_index, name, alias_id, line_richmenu_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, groupId, orderIndex, `ページ${orderIndex + 1}`, `lhx-${groupId}-${orderIndex}`, lineRichMenuId);
}

function insertArea(pageId: string, id: string) {
  raw.prepare(
    `INSERT INTO rich_menu_areas
       (id, page_id, bounds_x, bounds_y, bounds_width, bounds_height, action_type, action_data, intent, label)
     VALUES (?, ?, 0, 0, 100, 100, 'uri', ?, NULL, 'リンクを開く')`,
  ).run(id, pageId, JSON.stringify({ uri: 'https://example.com' }));
}

function groupRow(id: string): { name: string; status: string; version: number } {
  return raw.prepare(`SELECT name, status, version FROM rich_menu_groups WHERE id = ?`).get(id) as {
    name: string; status: string; version: number;
  };
}

function pageNames(groupId: string): string[] {
  return (
    raw.prepare(`SELECT name AS n FROM rich_menu_pages WHERE group_id = ? ORDER BY order_index`).all(groupId) as Array<{ n: string }>
  ).map((r) => r.n);
}

// ---------------------------------------------------------------------------
// M950: 保存は meta と pages を同じ取引で確定する
// ---------------------------------------------------------------------------

describe('M950: 保存の部分書き込みを残さない', () => {
  test('pages 置換が失敗したら meta も戻る（名前も版もPagesも変わらない）', async () => {
    insertGroup('g1', 'draft');
    insertPage('g1', 'p1', 0);
    insertArea('p1', 'a1');

    // 新規 page の id 発行を衝突させる。2件目の INSERT が PK 違反で落ちる。
    const uuidSpy = vi.spyOn(crypto, 'randomUUID').mockReturnValue('collide-id');
    let res: Response;
    try {
      const { path, init } = authed('/api/rich-menu-groups/g1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: 1,
          name: '新しい名前',
          pages: [
            { name: 'あたらしい1', orderIndex: 0, areas: [VALID_AREA] },
            { name: 'あたらしい2', orderIndex: 1, areas: [VALID_AREA] },
          ],
        }),
      });
      res = await setupApp(db, r2).request(path, init);
    } finally {
      uuidSpy.mockRestore();
    }

    expect(res.status).toBe(500);
    // 直し前はここで name='新しい名前' だけ残る（部分書き込み）。
    expect(groupRow('g1').name).toBe('メニュー');
    expect(pageNames('g1')).toEqual(['ページ1']);
    // 版の検査と書込が別取引だと、版上げだけが残る。版も戻る（進まない）。
    expect(groupRow('g1').version).toBe(1);
  });

  test('正常保存は meta と pages が両方反映され版が +1', async () => {
    insertGroup('g1', 'draft');
    insertPage('g1', 'p1', 0);
    insertArea('p1', 'a1');

    const { path, init } = authed('/api/rich-menu-groups/g1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedVersion: 1,
        name: '新しい名前',
        pages: [{ name: 'あたらしい1', orderIndex: 0, areas: [VALID_AREA] }],
      }),
    });
    const res = await setupApp(db, r2).request(path, init);

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { version: number } };
    expect(body.data.version).toBe(2);
    expect(groupRow('g1')).toMatchObject({ name: '新しい名前', version: 2 });
    expect(pageNames('g1')).toEqual(['あたらしい1']);
  });
});

// ---------------------------------------------------------------------------
// M951: 保存に版を付けて同時編集の上書きを止める
// ---------------------------------------------------------------------------

describe('M951: 保存の版照合', () => {
  test('expectedVersion が無いと 400 で何も書かない', async () => {
    insertGroup('g1', 'draft');

    const { path, init } = authed('/api/rich-menu-groups/g1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '新しい名前' }),
    });
    const res = await setupApp(db, r2).request(path, init);

    expect(res.status).toBe(400);
    expect(groupRow('g1').name).toBe('メニュー');
  });

  test('expectedVersion が不正（0・小数・文字）は 400', async () => {
    insertGroup('g1', 'draft');
    for (const bad of [0, -1, 1.5, '１', null]) {
      const { path, init } = authed('/api/rich-menu-groups/g1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: bad, name: '新しい名前' }),
      });
      const res = await setupApp(db, r2).request(path, init);
      expect(res.status).toBe(400);
    }
    expect(groupRow('g1')).toMatchObject({ name: 'メニュー', version: 1 });
  });

  test('古い版での保存は 409 で何も書かない（同時編集の後勝ちを止める）', async () => {
    insertGroup('g1', 'draft');
    const app = setupApp(db, r2);

    // Aさんが保存（版 1→2）
    const first = authed('/api/rich-menu-groups/g1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, name: 'Aさんの名前' }),
    });
    expect((await app.request(first.path, first.init)).status).toBe(200);

    // 古い画面のままのBさんが保存 → 409。Aさんの内容は残る。
    // 直し前はここが 200 で Aさんの名前が黙って消える。
    const second = authed('/api/rich-menu-groups/g1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, name: 'Bさんの名前' }),
    });
    const res = await app.request(second.path, second.init);
    expect(res.status).toBe(409);
    expect(groupRow('g1')).toMatchObject({ name: 'Aさんの名前', version: 2 });
  });

  test('今の版での保存は 200 で版が +1（空保存は版を進めない）', async () => {
    insertGroup('g1', 'draft');
    const app = setupApp(db, r2);
    const save = (expectedVersion: number, extra: Record<string, unknown> = {}) => {
      const { path, init } = authed('/api/rich-menu-groups/g1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion, ...extra }),
      });
      return app.request(path, init);
    };

    expect((await save(1, { name: 'v2' })).status).toBe(200);
    expect(groupRow('g1').version).toBe(2);
    // 書くものが無い保存は版を進めない（読み直し不要）。
    expect((await save(2)).status).toBe(200);
    expect(groupRow('g1').version).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// M952: 「条件で出し分け・条件なし」を保存口でも断る（作成口と同じ検査）
// ---------------------------------------------------------------------------

describe('M952: 出し分け条件なしの保存拒否', () => {
  const CONDITION = JSON.stringify({ op: 'and', rules: [] });

  test('enabled と条件なしの同時指定は 400', async () => {
    insertGroup('g1', 'draft');

    const { path, init } = authed('/api/rich-menu-groups/g1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, targetingEnabled: true, targetingCondition: null }),
    });
    const res = await setupApp(db, r2).request(path, init);

    // 直し前はここが 200 で誰にも出ないメニューが作れる。
    expect(res.status).toBe(400);
    const row = raw.prepare(`SELECT targeting_enabled AS e FROM rich_menu_groups WHERE id = 'g1'`).get() as { e: number };
    expect(row.e).toBe(0);
  });

  test('条件ありで出している最中に条件だけ外すと 400（合わせた形で見る）', async () => {
    insertGroup('g1', 'draft');
    raw.prepare(`UPDATE rich_menu_groups SET targeting_enabled = 1, targeting_condition = ? WHERE id = 'g1'`)
      .run(CONDITION);

    const { path, init } = authed('/api/rich-menu-groups/g1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, targetingCondition: null }),
    });
    const res = await setupApp(db, r2).request(path, init);

    expect(res.status).toBe(400);
  });

  test('条件なしのまま有効化だけ送っても 400', async () => {
    insertGroup('g1', 'draft');

    const { path, init } = authed('/api/rich-menu-groups/g1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, targetingEnabled: true }),
    });
    const res = await setupApp(db, r2).request(path, init);

    expect(res.status).toBe(400);
  });

  test('条件つきの有効化・無効化との同時解除は通る', async () => {
    insertGroup('g1', 'draft');
    const app = setupApp(db, r2);
    const save = (body: Record<string, unknown>) => {
      const { path, init } = authed('/api/rich-menu-groups/g1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return app.request(path, init);
    };

    expect((await save({ expectedVersion: 1, targetingEnabled: true, targetingCondition: CONDITION })).status)
      .toBe(200);
    // 無効化と条件の解除を同時になら通る（合わせた形で条件なし・無効）。
    expect((await save({ expectedVersion: 2, targetingEnabled: false, targetingCondition: null })).status)
      .toBe(200);
    const row = raw.prepare(`SELECT targeting_enabled AS e, targeting_condition AS c FROM rich_menu_groups WHERE id = 'g1'`).get() as {
      e: number; c: string | null;
    };
    expect(row.e).toBe(0);
    expect(row.c).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M953: 取り下げで LINE 削除が失敗したら成功にしない
// ---------------------------------------------------------------------------

function stubLineFetch(mode: 'ok' | 'fail-all' | 'fail-richmenu-only') {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.endsWith('/bot/user/all/richmenu')) {
      return new Response('{}', { status: 404 }); // 既定メニューなし
    }
    if (method === 'DELETE' && url.includes('/bot/richmenu/')) {
      const isAlias = url.includes('/bot/richmenu/alias/');
      if (mode === 'fail-all') return new Response('line down', { status: 500 });
      if (mode === 'fail-richmenu-only' && !isAlias) return new Response('line down', { status: 500 });
      return new Response('{}', { status: 404 }); // 既に消えている
    }
    return new Response('{}', { status: 200 });
  }));
}

function insertPublishedGroupWithLineIds(id: string, lineIds: Array<string | null>) {
  insertGroup(id, 'published');
  lineIds.forEach((lineId, i) => {
    const pageId = `p${i + 1}`;
    insertPage(id, pageId, i, lineId);
    if (lineId) {
      raw.prepare(`UPDATE rich_menu_pages SET line_richmenu_id = ? WHERE id = ?`).run(lineId, pageId);
    }
  });
}

function publishRunStatus(groupId: string): string | null {
  const row = raw.prepare(`SELECT status AS s FROM rich_menu_publish_runs WHERE group_id = ?`).get(groupId) as {
    s: string;
  } | null;
  return row?.s ?? null;
}

describe('M953: 取り下げの LINE 削除失敗', () => {
  test('LINE 削除が全滅したら 500・published のまま・実行は失敗（再試行できる）', async () => {
    insertPublishedGroupWithLineIds('g1', ['lm-1', 'lm-2']);
    stubLineFetch('fail-all');

    const { path, init } = authed('/api/rich-menu-groups/g1/unpublish', { method: 'POST' });
    const res = await setupApp(db, r2).request(path, init);

    // 直し前はここが 200・draft 確定で、LINE 上にメニューが残る。
    expect(res.status).toBe(500);
    expect(groupRow('g1').status).toBe('published');
    expect(publishRunStatus('g1')).toBe('failed');
  });

  test('一部ページの削除失敗でも 500・published のまま', async () => {
    insertPublishedGroupWithLineIds('g1', ['lm-1', 'lm-2']);
    stubLineFetch('fail-richmenu-only');

    const { path, init } = authed('/api/rich-menu-groups/g1/unpublish', { method: 'POST' });
    const res = await setupApp(db, r2).request(path, init);

    expect(res.status).toBe(500);
    expect(groupRow('g1').status).toBe('published');
    expect(publishRunStatus('g1')).toBe('failed');
  });

  test('LINE 削除が通れば 200・draft 確定・実行は成功', async () => {
    insertPublishedGroupWithLineIds('g1', ['lm-1', 'lm-2']);
    stubLineFetch('ok');

    const { path, init } = authed('/api/rich-menu-groups/g1/unpublish', { method: 'POST' });
    const res = await setupApp(db, r2).request(path, init);

    expect(res.status).toBe(200);
    expect(groupRow('g1').status).toBe('draft');
    expect(publishRunStatus('g1')).toBe('succeeded');
  });
});

// ---------------------------------------------------------------------------
// M954: 画像アップロードで DB 失敗時は R2 を片付ける
// ---------------------------------------------------------------------------

describe('M954: 画像アップロードの R2 孤児', () => {
  /** 画像の記録 UPDATE だけ落とす DB（R2 put は通る）。 */
  function failingImageDb(): D1Database {
    return {
      prepare: (sql: string) => {
        if (/^\s*UPDATE/i.test(sql) && sql.includes('image_r2_key')) {
          const bomb = async (): Promise<never> => {
            throw new Error('db down');
          };
          return { bind: () => ({ run: bomb, first: bomb, all: bomb }) };
        }
        return (db as unknown as { prepare: (sql: string) => unknown }).prepare(sql);
      },
      batch: (stmts: []) => (db as unknown as { batch: (s: []) => Promise<unknown[]> }).batch(stmts),
    } as unknown as D1Database;
  }

  function uploadImage(targetDb: D1Database) {
    const { path, init } = authed('/api/rich-menu-groups/g1/pages/p1/image', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: PNG_2500x1686,
    });
    return setupApp(targetDb, r2).request(path, init);
  }

  test('DB 記録に失敗したら R2 の画像を消して 500（孤児を残さない）', async () => {
    insertGroup('g1', 'draft');
    insertPage('g1', 'p1', 0);

    const res = await uploadImage(failingImageDb());

    expect(res.status).toBe(500);
    // 直し前はここで R2 に1件残る。
    expect(r2.store.size).toBe(0);
    expect(r2.deleted).toHaveLength(1);
    const row = raw.prepare(`SELECT image_r2_key AS k FROM rich_menu_pages WHERE id = 'p1'`).get() as {
      k: string | null;
    };
    expect(row.k).toBeNull();
  });

  test('正常時は R2 に残り DB に記録される', async () => {
    insertGroup('g1', 'draft');
    insertPage('g1', 'p1', 0);

    const res = await uploadImage(db);

    expect(res.status).toBe(200);
    expect(r2.store.size).toBe(1);
    const row = raw.prepare(`SELECT image_r2_key AS k FROM rich_menu_pages WHERE id = 'p1'`).get() as {
      k: string | null;
    };
    expect(row.k).toContain('rich-menus/acc-1/g1/p1/');
  });
});

// ---------------------------------------------------------------------------
// M950/M951 追加照合：版の検査と書込は同じ取引で行う
// ---------------------------------------------------------------------------

describe('M950/M951: 保存の交錯で古い書込が勝たない', () => {
  /**
   * A が版を読んで止まっている間に B が保存を終え、A の書込が最後に来る
   * 交錯。版の検査と書込が別取引だと、A の無条件の書込が B を黙って
   * 上書きする（両方 200）。同じ取引なら A の書込全体が戻って 409 になる。
   */
  test('Aの書込がBの確定より後に来たら A は 409 で B が残る', async () => {
    insertGroup('g1', 'draft');
    insertPage('g1', 'p1', 0);
    insertArea('p1', 'a1');

    let releaseBatch!: () => void;
    let batchReached = false;
    const batchGate = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    const gatedDb = {
      prepare: (sql: string) =>
        (db as unknown as { prepare: (s: string) => unknown }).prepare(sql),
      batch: (stmts: []) => {
        if (!batchReached) {
          batchReached = true;
          return batchGate.then(() =>
            (db as unknown as { batch: (s: []) => Promise<unknown[]> }).batch(stmts),
          );
        }
        return (db as unknown as { batch: (s: []) => Promise<unknown[]> }).batch(stmts);
      },
    } as unknown as D1Database;

    const saveBody = (expectedVersion: number, name: string, pageName: string) => ({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedVersion,
        name,
        pages: [{ name: pageName, orderIndex: 0, areas: [VALID_AREA] }],
      }),
    });
    const appA = setupApp(gatedDb, r2);
    const appB = setupApp(db, r2);
    const reqA = authed('/api/rich-menu-groups/g1', saveBody(1, 'Aさんの名前', 'Aページ'));
    const resAPromise = appA.request(reqA.path, reqA.init);

    // A が書込の取引に入るまで待つ（A は版上げ済み・書込前のことがある）。
    const deadline = Date.now() + 10000;
    while (!batchReached) {
      if (Date.now() > deadline) throw new Error('A did not reach batch');
      await new Promise((r) => setTimeout(r, 10));
    }
    // A が止まっている間に読んだ今の版で B が保存する。
    const versionNow = (
      raw.prepare(`SELECT version AS v FROM rich_menu_groups WHERE id = 'g1'`).get() as { v: number }
    ).v;
    const reqB = authed('/api/rich-menu-groups/g1', saveBody(versionNow, 'Bさんの名前', 'Bページ'));
    const resB = await appB.request(reqB.path, reqB.init);
    expect(resB.status).toBe(200);
    const bodyB = (await resB.json()) as { success: boolean; data: { version: number } };

    releaseBatch();
    const resA = await resAPromise;

    // 直し前は A が 200 で Aさんの名前・Aページが残る（B が消える）。
    expect(resA.status).toBe(409);
    expect(groupRow('g1').name).toBe('Bさんの名前');
    expect(pageNames('g1')).toEqual(['Bページ']);
    expect(groupRow('g1').version).toBe(bodyB.data.version);
  }, 20000);
});
