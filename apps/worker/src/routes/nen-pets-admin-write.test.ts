/*
 * #934 N-292/N-293: 管理画面のペット登録・編集口を実D1で固定する。
 *  1. POST /api/nen-campaigns/pets：種別・性別の選択肢と月日だけ（MM-DD）の誕生日を受け付ける
 *  2. PUT /api/nen-campaigns/pets/:id：同じ形で直せる。誕生日を変えると予約済みの誕生日配信を取消す
 *  3. 別アカウントの友だち・ペットは見えない（404/403）。staff は書けない（403）
 */
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

const { nenCampaigns } = await import('./nen-campaigns.js');

const ACCOUNT = 'account-nen';
let sql: Database.Database;
let db: D1Database;

function seed(raw: Database.Database): void {
  raw.exec(`
    INSERT INTO tenants (id, name) VALUES ('tenant-other', '別会社') ON CONFLICT DO NOTHING;
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES ('${ACCOUNT}', 'channel-nen', '然', 'token', 'secret', NULL),
           ('account-other', 'channel-o', '別', 'token', 'secret', 'tenant-other');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at) VALUES
      ('friend-a', 'U-a', '山田 太郎', '${ACCOUNT}', 1, '2026-09-01', '2026-09-01'),
      ('friend-x', 'U-x', '別店', 'account-other', 1, '2026-09-01', '2026-09-01');
    INSERT INTO nen_pet_profiles (id, friend_id, name, animal_type, gender, birthday, created_at, updated_at) VALUES
      ('pet-1', 'friend-a', 'モモ', 'dog', 'female', '2020-03-15', '2026-09-01', '2026-09-01'),
      ('pet-x', 'friend-x', 'ヨソ', 'dog', 'male', '2020-01-01', '2026-09-01', '2026-09-01');
    INSERT INTO nen_campaign_settings
      (campaign_key, label, category, is_enabled, title, body_text, created_at, updated_at)
    VALUES ('birthday_coupon', '誕生日クーポン', 'birthday', 1, 'おめでとう', '本文', '2026-01-01', '2026-01-01');
    INSERT INTO nen_delivery_jobs
      (id, campaign_key, friend_id, line_account_id, source_key, payload, scheduled_at, status, attempts, created_at, updated_at) VALUES
      ('job-pending', 'birthday_coupon', 'friend-a', '${ACCOUNT}', 'birthday:pet-1:2026', '{"pet":{}}', '2026-03-12 01:00:00', 'pending', 0, '2026-09-01', '2026-09-01'),
      ('job-sent', 'birthday_coupon', 'friend-a', '${ACCOUNT}', 'birthday:pet-1:2025', '{"pet":{}}', '2025-03-12 01:00:00', 'sent', 1, '2025-03-01', '2025-03-12');
  `);
}

function harness(role: 'owner' | 'admin' | 'staff' = 'owner', tenantId: string | null = null) {
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-a', name: '担当者', role, readOnly: false, permissionKeys: [], accountScope: 'all', tenantId });
    c.env = { DB: db };
    await next();
  });
  app.route('/', nenCampaigns);
  return app;
}

const json = (body: unknown, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  const created = createTestD1();
  sql = created.raw;
  db = created.db;
  seed(sql);
});

describe('NEN ペット登録（POST /api/nen-campaigns/pets）', () => {
  it('種別・性別の選択肢と月日だけの誕生日を受け付ける', async () => {
    const res = await harness().request(`/api/nen-campaigns/pets?lineAccountId=${ACCOUNT}`, json({
      friendId: 'friend-a', name: 'タマ', animalType: 'other', gender: 'unknown', birthday: '07-01',
    }));
    expect(res.status).toBe(201);
    const row = sql.prepare(`SELECT animal_type, gender, birthday FROM nen_pet_profiles WHERE name = 'タマ'`).get() as {  animal_type: string; gender: string; birthday: string  } | undefined;
    expect(row).toEqual({ animal_type: 'other', gender: 'unknown', birthday: '07-01' });
  });

  it('存在しない日付や形の違う誕生日は弾く', async () => {
    for (const birthday of ['2020-13-01', '15-03', '2020/03/15']) {
      const res = await harness().request(`/api/nen-campaigns/pets?lineAccountId=${ACCOUNT}`, json({
        friendId: 'friend-a', name: 'タマ', birthday,
      }));
      expect(res.status).toBe(400);
    }
  });

  it('別アカウントの友だちへは登録できない（404）', async () => {
    const res = await harness().request(`/api/nen-campaigns/pets?lineAccountId=${ACCOUNT}`, json({
      friendId: 'friend-x', name: 'タマ',
    }));
    expect(res.status).toBe(404);
  });

  it('見えないアカウントは 403、staff は書けない（403）', async () => {
    const denied = await harness().request('/api/nen-campaigns/pets?lineAccountId=account-other', json({ friendId: 'friend-x', name: 'タマ' }));
    expect(denied.status).toBe(403);
    const staff = await harness('staff').request(`/api/nen-campaigns/pets?lineAccountId=${ACCOUNT}`, json({ friendId: 'friend-a', name: 'タマ' }));
    expect(staff.status).toBe(403);
  });
});

describe('NEN ペット編集（PUT /api/nen-campaigns/pets/:id）', () => {
  it('誤登録を消さずに直せる。月日だけの誕生日も保存できる', async () => {
    const res = await harness().request(`/api/nen-campaigns/pets/pet-1?lineAccountId=${ACCOUNT}`, json({
      name: 'モモ', animalType: 'cat', gender: 'female', birthday: '03-15', breed: 'ミックス', weightKg: 4.5,
    }, 'PUT'));
    expect(res.status).toBe(200);
    const row = sql.prepare(`SELECT animal_type, birthday, breed, weight_kg FROM nen_pet_profiles WHERE id = 'pet-1'`).get() as {  animal_type: string; birthday: string; breed: string; weight_kg: number  } | undefined;
    expect(row).toEqual({ animal_type: 'cat', birthday: '03-15', breed: 'ミックス', weight_kg: 4.5 });
  });

  it('誕生日を変えると予約済みの誕生日配信だけ取消し、送った記録は残す', async () => {
    const res = await harness().request(`/api/nen-campaigns/pets/pet-1?lineAccountId=${ACCOUNT}`, json({
      name: 'モモ', animalType: 'dog', gender: 'female', birthday: '05-20',
    }, 'PUT'));
    expect(res.status).toBe(200);
    const pending = sql.prepare(`SELECT status FROM nen_delivery_jobs WHERE id = 'job-pending'`).get() as {  status: string  } | undefined;
    const sent = sql.prepare(`SELECT status FROM nen_delivery_jobs WHERE id = 'job-sent'`).get() as {  status: string  } | undefined;
    expect(pending?.status).toBe('cancelled');
    expect(sent?.status).toBe('sent');
  });

  it('誕生日を変えない更新は予約をそのまま残す', async () => {
    const res = await harness().request(`/api/nen-campaigns/pets/pet-1?lineAccountId=${ACCOUNT}`, json({
      name: 'モモ改', animalType: 'dog', gender: 'female', birthday: '2020-03-15',
    }, 'PUT'));
    expect(res.status).toBe(200);
    const pending = sql.prepare(`SELECT status FROM nen_delivery_jobs WHERE id = 'job-pending'`).get() as {  status: string  } | undefined;
    expect(pending?.status).toBe('pending');
  });

  it('別アカウントのペットは 404、staff は書けない（403）', async () => {
    const res = await harness().request(`/api/nen-campaigns/pets/pet-x?lineAccountId=${ACCOUNT}`, json({
      name: 'ヨソ改',
    }, 'PUT'));
    expect(res.status).toBe(404);
    const staff = await harness('staff').request(`/api/nen-campaigns/pets/pet-1?lineAccountId=${ACCOUNT}`, json({ name: 'モモ' }, 'PUT'));
    expect(staff.status).toBe(403);
  });
});
