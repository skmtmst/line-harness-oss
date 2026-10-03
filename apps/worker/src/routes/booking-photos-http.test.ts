import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { getMediaDeleteImpactSnapshot } from '@line-crm/db';
import type { Env } from '../index.js';
import { scanSingleMediaUsage } from '../services/media-usage-scan.js';

const access = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
}));
vi.mock('../services/account-access.js', () => access);

const { default: booking } = await import('./booking.js');

let sqlite: Database.Database;
let db: D1Database;

function asD1(target: Database.Database): D1Database {
  const d1 = {
    prepare(query: string) {
      const prepared = () => target.prepare(query);
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const result = prepared().run(...params);
              return { success: true, results: [], meta: { changes: result.changes } };
            },
            async first<T>() {
              return (prepared().get(...params) as T) ?? null;
            },
            async all<T>() {
              return { success: true, results: prepared().all(...params) as T[], meta: {} };
            },
          };
        },
      };
    },
    async batch(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
  return d1 as unknown as D1Database;
}

function makeApp() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-1', name: '管理者', role: 'owner', readOnly: false });
    return next();
  });
  app.route('/', booking);
  return { app, env: { DB: db } as Env['Bindings'] };
}

const SETTINGS_BODY = {
  timeZone: 'Asia/Tokyo',
  bookingWindowDays: 60,
  cutoffMinutesBefore: 1440,
  cancelDeadlineMinutesBefore: 1440,
  maxActiveBookingsPerFriend: 1,
  approvalMode: 'automatic',
  holdMinutes: 15,
  slotGranularityMinutes: 15,
} as const;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));
  sqlite.prepare(`INSERT INTO line_accounts
    (id,channel_id,name,channel_access_token,channel_secret)
    VALUES ('account-a','channel-a','A店','token-a','secret-a')`).run();
  sqlite.prepare(`INSERT INTO line_accounts
    (id,channel_id,name,channel_access_token,channel_secret)
    VALUES ('account-b','channel-b','B店','token-b','secret-b')`).run();
  // 登録メディア：A店の画像2枚・動画1枚、B店の画像1枚。
  sqlite.prepare(`INSERT INTO media
    (id,line_account_id,kind,filename,mime_type,size_bytes,r2_key,created_at)
    VALUES
    ('photo-a1','account-a','image','店内.png','image/png',100,'media/shop-a1.png','2026-09-01T10:00:00.000'),
    ('photo-a2','account-a','image','料理.png','image/png',100,'media/food-a2.png','2026-09-01T10:00:00.000'),
    ('movie-a','account-a','video','紹介.mp4','video/mp4',100,'media/intro-a.mp4','2026-09-01T10:00:00.000'),
    ('photo-b1','account-b','image','B店.png','image/png',100,'media/shop-b1.png','2026-09-01T10:00:00.000')`).run();
  db = asD1(sqlite);
  access.canAccessAllLineAccounts.mockClear();
});

function usages(mediaId: string): Array<{ ref_kind: string; ref_id: string }> {
  return sqlite.prepare(
    `SELECT ref_kind, ref_id FROM media_usages WHERE media_id = ? ORDER BY ref_kind, ref_id`,
  ).all(mediaId) as Array<{ ref_kind: string; ref_id: string }>;
}

describe('予約の写真（メニュー・スタッフ・お店に1枚ずつ）', () => {
  test('メニュー作成で写真を付けて台帳に残し、一覧に写真が出る', async () => {
    const { app, env } = makeApp();
    const created = await app.request('/api/booking/admin/menus?account_id=account-a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'カット', duration_minutes: 60, base_price: 5000, photo_media_id: 'photo-a1' }),
    }, env);
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };

    expect(sqlite.prepare(`SELECT photo_media_id FROM menus WHERE id = ?`).get(id))
      .toEqual({ photo_media_id: 'photo-a1' });
    expect(usages('photo-a1')).toEqual([{ ref_kind: 'booking_menu', ref_id: id }]);

    const listed = await app.request('/api/booking/admin/menus?account_id=account-a', {}, env);
    const menus = (await listed.json() as { menus: Array<Record<string, unknown>> }).menus;
    expect(menus.find((row) => row.id === id)).toMatchObject({
      photo_media_id: 'photo-a1',
      photo_url: 'http://localhost/media/photo-a1/content',
    });
  });

  test('メニュー更新で写真を付け替え・外し、送らなければ保つ', async () => {
    const { app, env } = makeApp();
    const created = await app.request('/api/booking/admin/menus?account_id=account-a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'カット', duration_minutes: 60, base_price: 5000, photo_media_id: 'photo-a1' }),
    }, env);
    const { id } = await created.json() as { id: string };

    // 付け替え：古い台帳は消え、新しい台帳が残る。
    const swapped = await app.request(`/api/booking/admin/menus/${id}?account_id=account-a`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'カット', duration_minutes: 60, base_price: 5000, expectedVersion: 1, photo_media_id: 'photo-a2',
      }),
    }, env);
    expect(swapped.status).toBe(200);
    expect(usages('photo-a1')).toEqual([]);
    expect(usages('photo-a2')).toEqual([{ ref_kind: 'booking_menu', ref_id: id }]);

    // 外す：台帳も消える。
    const cleared = await app.request(`/api/booking/admin/menus/${id}?account_id=account-a`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'カット', duration_minutes: 60, base_price: 5000, expectedVersion: 2, photo_media_id: null,
      }),
    }, env);
    expect(cleared.status).toBe(200);
    expect(usages('photo-a2')).toEqual([]);
    expect(sqlite.prepare(`SELECT photo_media_id FROM menus WHERE id = ?`).get(id))
      .toEqual({ photo_media_id: null });
  });

  test('写真を送らないメニュー更新は今の写真と台帳を保つ', async () => {
    const { app, env } = makeApp();
    const created = await app.request('/api/booking/admin/menus?account_id=account-a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'カット', duration_minutes: 60, base_price: 5000, photo_media_id: 'photo-a1' }),
    }, env);
    const { id } = await created.json() as { id: string };

    const renamed = await app.request(`/api/booking/admin/menus/${id}?account_id=account-a`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'カット増し', duration_minutes: 60, base_price: 5000, expectedVersion: 1 }),
    }, env);
    expect(renamed.status).toBe(200);
    expect(usages('photo-a1')).toEqual([{ ref_kind: 'booking_menu', ref_id: id }]);
  });

  test.each([
    ['無い写真', 'photo-missing', '選択した写真が見つかりません'],
    ['別アカウントの写真', 'photo-b1', '選択した写真が見つかりません'],
    ['画像でない登録メディア', 'movie-a', '写真には画像の登録メディアを選んでください'],
    ['形違い', 123, '写真は登録メディアから選んでください'],
  ])('メニュー作成で%sは400にして保存しない', async (_label, photo, error) => {
    const { app, env } = makeApp();
    const before = sqlite.prepare(`SELECT COUNT(*) AS count FROM menus`).get() as { count: number };
    const res = await app.request('/api/booking/admin/menus?account_id=account-a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'カット', duration_minutes: 60, base_price: 5000, photo_media_id: photo }),
    }, env);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM menus`).get()).toEqual(before);
  });

  test('スタッフの写真は作成・更新・取り下げで台帳が付く・移る・消える', async () => {
    const { app, env } = makeApp();
    const created = await app.request('/api/booking/admin/staff?account_id=account-a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '担当', display_name: '表示', photo_media_id: 'photo-a1' }),
    }, env);
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    expect(usages('photo-a1')).toEqual([{ ref_kind: 'booking_staff', ref_id: id }]);

    const listed = await app.request('/api/booking/admin/staff?account_id=account-a', {}, env);
    const rows = (await listed.json() as { staff: Array<Record<string, unknown>> }).staff;
    expect(rows.find((row) => row.id === id)).toMatchObject({
      photo_media_id: 'photo-a1',
      photo_url: 'http://localhost/media/photo-a1/content',
    });

    const swapped = await app.request(`/api/booking/admin/staff/${id}?account_id=account-a`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_media_id: 'photo-a2' }),
    }, env);
    expect(swapped.status).toBe(200);
    expect(usages('photo-a1')).toEqual([]);
    expect(usages('photo-a2')).toEqual([{ ref_kind: 'booking_staff', ref_id: id }]);

    const removed = await app.request(`/api/booking/admin/staff/${id}?account_id=account-a`, {
      method: 'DELETE',
    }, env);
    expect(removed.status).toBe(200);
    expect(usages('photo-a2')).toEqual([]);
  });

  test('別アカウントの写真はスタッフに付けられない', async () => {
    const { app, env } = makeApp();
    const res = await app.request('/api/booking/admin/staff?account_id=account-a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '担当', display_name: '表示', photo_media_id: 'photo-b1' }),
    }, env);
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      code: 'booking_staff_validation_failed', field: 'photo_media_id',
    });
  });

  test('お店の写真を設定・取得でき、台帳に残る', async () => {
    const { app, env } = makeApp();
    const created = await app.request('/api/booking/admin/settings?account_id=account-a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...SETTINGS_BODY, expectedVersion: 0, store_photo_media_id: 'photo-a1' }),
    }, env);
    expect(created.status).toBe(201);
    const createdBody = await created.json() as {
      success: boolean; data: { id: string; storePhotoMediaId: string; store_photo_url: string };
    };
    expect(createdBody.data).toMatchObject({
      storePhotoMediaId: 'photo-a1',
      store_photo_url: 'http://localhost/media/photo-a1/content',
    });
    expect(usages('photo-a1')).toEqual([{ ref_kind: 'booking_settings', ref_id: createdBody.data.id }]);

    const read = await app.request('/api/booking/admin/settings?account_id=account-a', {}, env);
    await expect(read.json()).resolves.toMatchObject({
      success: true,
      data: {
        storePhotoMediaId: 'photo-a1',
        store_photo_url: 'http://localhost/media/photo-a1/content',
      },
    });

    // 写真を送らない保存では今の写真を保つ。
    const kept = await app.request('/api/booking/admin/settings?account_id=account-a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...SETTINGS_BODY, expectedVersion: 1, bookingWindowDays: 90 }),
    }, env);
    expect(kept.status).toBe(200);
    await expect(kept.json()).resolves.toMatchObject({
      success: true, data: { storePhotoMediaId: 'photo-a1' },
    });
    expect(usages('photo-a1')).toEqual([{ ref_kind: 'booking_settings', ref_id: createdBody.data.id }]);
  });

  test('お店の写真3枠は同じ写真を使い回せて、全部外すと台帳から消える', async () => {
    const { app, env } = makeApp();
    const created = await app.request('/api/booking/admin/settings?account_id=account-a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...SETTINGS_BODY,
        expectedVersion: 0,
        store_photo_media_id: 'photo-a1',
        store_photo_interior_media_id: 'photo-a1',
        store_photo_waiting_media_id: 'photo-a2',
      }),
    }, env);
    expect(created.status).toBe(201);
    const { id } = (await created.json() as { data: { id: string } }).data;
    // 同じ写真を2枠で使っても台帳は1行（主キーが写真・種類・相手）。
    expect(usages('photo-a1')).toEqual([{ ref_kind: 'booking_settings', ref_id: id }]);
    expect(usages('photo-a2')).toEqual([{ ref_kind: 'booking_settings', ref_id: id }]);

    // 外観だけ外しても、店内で使っているので台帳は残る。
    const clearedOne = await app.request('/api/booking/admin/settings?account_id=account-a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...SETTINGS_BODY, expectedVersion: 1, store_photo_media_id: null }),
    }, env);
    expect(clearedOne.status).toBe(200);
    expect(usages('photo-a1')).toEqual([{ ref_kind: 'booking_settings', ref_id: id }]);

    // 残りも外すと台帳から消える。
    const clearedAll = await app.request('/api/booking/admin/settings?account_id=account-a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...SETTINGS_BODY,
        expectedVersion: 2,
        store_photo_interior_media_id: null,
        store_photo_waiting_media_id: null,
      }),
    }, env);
    expect(clearedAll.status).toBe(200);
    expect(usages('photo-a1')).toEqual([]);
    expect(usages('photo-a2')).toEqual([]);
  });

  test('使っている写真は削除の影響に予約の使用先が出る', async () => {
    const { app, env } = makeApp();
    const created = await app.request('/api/booking/admin/menus?account_id=account-a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'カット', duration_minutes: 60, base_price: 5000, photo_media_id: 'photo-a1' }),
    }, env);
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };

    const snapshot = await getMediaDeleteImpactSnapshot(db, 'photo-a1', 'account-a', '2026-10-03T10:00:00.000+09:00');
    expect(snapshot?.impact.canDelete).toBe(false);
    expect(snapshot?.impact.references).toMatchObject([{ kind: 'booking_menu', name: 'カット', state: 'available' }]);
    expect(usages('photo-a1')).toEqual([{ ref_kind: 'booking_menu', ref_id: id }]);
  });

  test('長いR2キーの写真も走査で見つかり、削除が止まる（#1308の決まり）', async () => {
    // #1308: LIKE '%長いキー%' はD1で「pattern too complex」になるため、
    // 使っている所の照合はワイルドカードなし（instr・IDの完全一致）で行う。
    // 写真の列はIDそのものなので、長いキーでも落ちずに拾える。
    const longKey = `media/${'k'.repeat(80)}.png`;
    expect(longKey.length).toBeGreaterThan(80);
    sqlite.prepare(`INSERT INTO media
      (id,line_account_id,kind,filename,mime_type,size_bytes,r2_key,created_at)
      VALUES ('photo-long','account-a','image','長い.png','image/png',100,?,'2026-09-01T10:00:00.000')`)
      .run(longKey);
    const { app, env } = makeApp();
    const created = await app.request('/api/booking/admin/menus?account_id=account-a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'カット', duration_minutes: 60, base_price: 5000, photo_media_id: 'photo-long' }),
    }, env);
    expect(created.status).toBe(201);

    const result = await scanSingleMediaUsage(
      db, '2026-10-03T10:00:00.000+09:00', { id: 'photo-long', r2_key: longKey },
    );
    expect(result.matched).toBe(1);
    expect(usages('photo-long')).toHaveLength(1);
    const snapshot = await getMediaDeleteImpactSnapshot(db, 'photo-long', 'account-a', '2026-10-03T10:00:00.000+09:00');
    expect(snapshot?.impact.canDelete).toBe(false);
    expect(snapshot?.impact.references).toMatchObject([{ kind: 'booking_menu', name: 'カット' }]);
  });

  test('走査は直接書いた写真を見つけて台帳へ戻す', async () => {
    sqlite.prepare(`INSERT INTO menus
      (id,line_account_id,name,duration_minutes,base_price,photo_media_id)
      VALUES ('menu-direct','account-a','直書き','30',1000,'photo-a2')`).run();
    expect(usages('photo-a2')).toEqual([]);

    const result = await scanSingleMediaUsage(
      db, '2026-10-03T10:00:00.000+09:00', { id: 'photo-a2', r2_key: 'media/food-a2.png' },
    );
    expect(result.matched).toBe(1);
    expect(usages('photo-a2')).toEqual([{ ref_kind: 'booking_menu', ref_id: 'menu-direct' }]);
  });
});
