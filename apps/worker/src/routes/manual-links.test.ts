import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

/**
 * マニュアルの正本表。設計 ★V6 34-4。台帳 #134。
 *
 * 守りたいのは 2 点。
 *   **確かめていない URL を「開けます」と言わない**
 *   **開けないと分かっているリンクを画面に返さない**（押しても何も出ない）
 */

const db = {
  listManualLinks: vi.fn(),
  getManualLink: vi.fn(),
  upsertManualLink: vi.fn(),
  recordCheck: vi.fn(),
  countBroken: vi.fn(),
};
vi.mock('@line-crm/db', () => db);

const { manualLinks } = await import('./manual-links.js');

const env = { DB: {} as D1Database };

function makeApp(role: 'owner' | 'admin' = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'u-1', name: 'テスト', role, readOnly: false });
    return next();
  });
  app.route('/', manualLinks);
  return app;
}

const ROW = {
  key: '2-1',
  key_kind: 'screen' as const,
  name: '受信箱',
  url: 'https://help.example.com/inbox',
  status: 'ok' as const,
  last_checked_at: '2026-08-28T04:00:00+09:00',
  last_error: null,
  updated_by: null,
  updated_at: '2026-08-28T04:00:00+09:00',
};

beforeEach(() => {
  vi.clearAllMocks();
  db.listManualLinks.mockResolvedValue([ROW]);
  db.getManualLink.mockResolvedValue(ROW);
  db.countBroken.mockResolvedValue(0);
});
afterEach(() => vi.unstubAllGlobals());

describe('画面から URL を引く', () => {
  it('確かめて開けるものだけ返す', async () => {
    const res = await makeApp().fetch(
      new Request('https://example.com/api/manual-links/lookup?screen=2-1'),
      env,
    );
    expect(await res.json()).toMatchObject({ data: { url: 'https://help.example.com/inbox', status: 'ok' } });
  });

  /* **押しても何も出ないボタンを画面に出さない。** */
  it.each([
    ['開けないと分かっている', 'broken'],
    ['まだ確かめていない', 'unset'],
  ])('%s ものは URL を返さない', async (_label, status) => {
    db.getManualLink.mockResolvedValue({ ...ROW, status });
    const res = await makeApp().fetch(
      new Request('https://example.com/api/manual-links/lookup?screen=2-1'),
      env,
    );
    expect(await res.json()).toMatchObject({ data: { url: null, status } });
  });

  it('表に無い画面でも落ちない', async () => {
    db.getManualLink.mockResolvedValue(null);
    const res = await makeApp().fetch(
      new Request('https://example.com/api/manual-links/lookup?screen=99-9'),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { url: null, status: 'unset' } });
  });
});

describe('正本表', () => {
  it('運営だけが見られる', async () => {
    const res = await makeApp('admin').fetch(new Request('https://example.com/api/manual-links'), env);
    expect(res.status).toBe(403);
  });

  it('開けないリンクの数を返す', async () => {
    db.countBroken.mockResolvedValue(2);
    const res = await makeApp().fetch(new Request('https://example.com/api/manual-links'), env);
    expect(await res.json()).toMatchObject({ data: { brokenCount: 2, total: 1 } });
  });
});

describe('直す', () => {
  it.each([
    ['形が違う', 'ほげ'],
    ['https でない', 'http://help.example.com/x'],
  ])('%s URL は断る', async (_label, url) => {
    const res = await makeApp().fetch(
      new Request('https://example.com/api/manual-links/2-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(db.upsertManualLink).not.toHaveBeenCalled();
  });

  it('正しい URL は保存する', async () => {
    const res = await makeApp().fetch(
      new Request('https://example.com/api/manual-links/2-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://help.example.com/new' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(db.upsertManualLink).toHaveBeenCalled();
  });
});

describe('いま全部を確かめる', () => {
  /* **確かめて初めて「開けます」と言う。** */
  it('2xx なら ok、それ以外は手がかりを残して broken', async () => {
    db.listManualLinks.mockResolvedValue([
      ROW,
      { ...ROW, key: '3-1', url: 'https://help.example.com/gone' },
    ]);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('', { status: 200 }))
        .mockResolvedValueOnce(new Response('', { status: 404 })),
    );
    const res = await makeApp().fetch(
      new Request('https://example.com/api/manual-links/check', { method: 'POST' }),
      env,
    );
    expect(await res.json()).toMatchObject({ data: { checked: 2, ok: 1, broken: 1 } });
    expect(db.recordCheck).toHaveBeenCalledWith(expect.anything(), '3-1', {
      ok: false,
      error: 'HTTP 404',
    });
  });

  /* **URL が決まっていないものを「開けない」に混ぜない。** やることが違う。 */
  it('URL が決まっていないものは確かめず、別に数える', async () => {
    db.listManualLinks.mockResolvedValue([{ ...ROW, url: null, status: 'unset' }]);
    vi.stubGlobal('fetch', vi.fn());
    const res = await makeApp().fetch(
      new Request('https://example.com/api/manual-links/check', { method: 'POST' }),
      env,
    );
    expect(await res.json()).toMatchObject({ data: { checked: 0, broken: 0, unset: 1 } });
    expect(db.recordCheck).not.toHaveBeenCalled();
  });

  it('通信が失敗しても止まらず、理由を残す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    const res = await makeApp().fetch(
      new Request('https://example.com/api/manual-links/check', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(200);
    expect(db.recordCheck).toHaveBeenCalledWith(expect.anything(), '2-1', {
      ok: false,
      error: 'timeout',
    });
  });
});
