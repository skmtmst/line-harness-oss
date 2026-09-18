/*
 * 健康日記（★V6 37-2-B）「獣医師に見せる（直近30日のまとめ）」を実D1で固定する。
 *  1. 本人のペットの 30 日の記録を、管理画面の 30日のまとめ と同じ形で返す
 *  2. 他人のペット・無いペットは 404。本人確認できなければ 401
 */
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

const liffAuth = vi.hoisted(() => ({ verifyCallerLineIdentity: vi.fn(), verifyCallerLineUserId: vi.fn() }));
vi.mock('../services/liff-auth.js', () => liffAuth);
vi.mock('../services/line-proxy-send.js', () => ({ pushViaHarnessProxy: vi.fn() }));
vi.mock('../services/local-line-proxy.js', () => ({ dispatchLineProxyLocally: vi.fn() }));

const { nenMembers } = await import('./nen-members.js');

let sql: Database.Database;
let db: D1Database;
const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

beforeEach(() => {
  const created = createTestD1();
  sql = created.raw;
  db = created.db;
  sql.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES ('account-nen', 'channel-nen', '然', 'token', 'secret');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at) VALUES
      ('friend-a', 'U-a', '山田 太郎', 'account-nen', 1, '2026-09-01', '2026-09-01'),
      ('friend-b', 'U-b', '鈴木 一郎', 'account-nen', 1, '2026-09-01', '2026-09-01');
    INSERT INTO nen_pet_profiles (id, friend_id, name, animal_type, gender, birthday, breed, weight_kg, concerns, recommended_daily_grams, recommended_daily_min_grams, recommended_daily_max_grams, venison_daily_grams, food_cycle_days, created_at, updated_at)
    VALUES ('pet-momo', 'friend-a', 'モモ', 'dog', 'female', '2022-04-01', '柴犬', 10, '[]', 250, 200, 300, 25, 4, '2026-09-01', '2026-09-01');
  `);
  const insert = sql.prepare(`INSERT INTO nen_health_logs (id, pet_id, friend_id, logged_on, weight_kg, stool_status, appetite, skin_status, tear_stain_status, note, heart_rate_bpm, respiratory_rate_bpm, created_at) VALUES (?, 'pet-momo', 'friend-a', ?, ?, ?, ?, 'normal', 'normal', ?, ?, ?, ?)`);
  insert.run('l0', day(0), 9.6, 'normal', 'normal', '散歩のあとよく水を飲んだ', 120, 26, day(0));
  insert.run('l10', day(10), 10.0, 'soft', 'good', '', 116, null, day(10));
  insert.run('l40', day(40), 10.5, 'diarrhea', 'poor', '古い記録', null, null, day(40));
});

function liff(lineUserId: string | null) {
  liffAuth.verifyCallerLineIdentity.mockResolvedValue(lineUserId ? { lineUserId, lineAccountId: 'account-nen' } : null);
  const app = new Hono<any>();
  app.use('*', async (c, next) => { c.env = { DB: db }; await next(); });
  app.route('/', nenMembers);
  return app;
}

describe('GET /api/liff/nen/health-logs/summary', () => {
  it('本人のペットの 30 日のまとめを返す（古い記録は入れない）', async () => {
    const res = await liff('U-a').request('/api/liff/nen/health-logs/summary?petId=pet-momo', { headers: { Authorization: 'Bearer token' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.pet).toMatchObject({ id: 'pet-momo', name: 'モモ', animalType: 'dog', breed: '柴犬', weightKg: 10 });
    expect(body.data.owner).toEqual({ name: '山田 太郎' });
    expect(body.data.summary).toMatchObject({
      days: 30, records: 2, weight: { first: 10, last: 9.6, min: 9.6, max: 10 }, heartRateAvg: 118, respiratoryRateAvg: 26,
      stool: { normal: 1, soft: 1 }, appetite: { normal: 1, good: 1 }, notes: [{ loggedOn: day(0), note: '散歩のあとよく水を飲んだ' }],
    });
    expect(body.data.summary.logs).toHaveLength(2);
    expect(body.data.labels.stool.diarrhea).toBe('下痢');
    expect(JSON.stringify(body)).not.toContain('ポイント');
  });

  it('他人のペット・無いペットは 404。本人確認できなければ 401', async () => {
    expect((await liff('U-b').request('/api/liff/nen/health-logs/summary?petId=pet-momo', { headers: { Authorization: 'Bearer token' } })).status).toBe(404);
    expect((await liff('U-a').request('/api/liff/nen/health-logs/summary?petId=nope', { headers: { Authorization: 'Bearer token' } })).status).toBe(404);
    expect((await liff(null).request('/api/liff/nen/health-logs/summary?petId=pet-momo')).status).toBe(401);
  });
});
