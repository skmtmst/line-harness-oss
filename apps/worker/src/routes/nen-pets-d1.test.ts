/*
 * 管理画面 マイペット（★V6 37-3）／健康日記（★V6 37-4）の API を実D1で固定する。
 *  1. /api/nen/pets：一覧・KPI・今日の目安・体重の更新日（90日）・絞り込み・並び
 *  2. /api/nen/health：記録のあるペットだけ。8週の週平均体重・気になる変化・KPI・絞り込み
 *  3. /api/nen/health/:petId/summary：30日のまとめ。別アカウントのペットは 404
 *  4. 見えないアカウント（別テナント）は 403。accountId 無しは 400
 * 表示のどこにも「ポイント」を出さない。
 */
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

const { nenPets } = await import('./nen-pets.js');

const ACCOUNT = 'account-nen';
let sql: Database.Database;
let db: D1Database;

const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const stamp = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
const birthdayYearsAgo = (years: number) => {
  const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - years); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

function seed(raw: Database.Database): void {
  raw.exec(`
    INSERT INTO tenants (id, name) VALUES ('tenant-other', '別会社') ON CONFLICT DO NOTHING;
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES ('${ACCOUNT}', 'channel-nen', '然', 'token', 'secret', NULL),
           ('account-other', 'channel-o', '別', 'token', 'secret', 'tenant-other');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at) VALUES
      ('friend-a', 'U-a', '山田 太郎', '${ACCOUNT}', 1, '2026-09-01', '2026-09-01'),
      ('friend-b', 'U-b', '鈴木 一郎', '${ACCOUNT}', 1, '2026-09-01', '2026-09-01'),
      ('friend-c', 'U-c', '別店', 'account-other', 1, '2026-09-01', '2026-09-01');
    INSERT INTO nen_ec_member_snapshots (friend_id, customer_id, purchase_count, purchase_amount, point_balance, member_rank, synced_at)
    VALUES ('friend-a', '10231', 12, 412300, 2840, 'プラチナ', '2026-09-16');
    INSERT INTO nen_feeding_products (id, line_account_id, name, kcal_per_100g, is_default, sort_order, created_at, updated_at) VALUES
      ('prod-mince', '${ACCOUNT}', '鹿肉ミンチ', 120, 1, 0, '2026-09-01', '2026-09-01'),
      ('prod-jerky', '${ACCOUNT}', '鹿肉ジャーキー', 300, 0, 1, '2026-09-01', '2026-09-01');
    INSERT INTO nen_pet_profiles (id, friend_id, name, animal_type, gender, birthday, breed, weight_kg, concerns,
      neutered, activity_level, feeding_product_id, created_at, updated_at) VALUES
      ('pet-momo', 'friend-a', 'モモ', 'dog', 'female', '${birthdayYearsAgo(4)}', '柴犬', 10, '[]', 1, 'normal', NULL, '${stamp(400)}', '${stamp(2)}'),
      ('pet-hana', 'friend-b', 'ハナ', 'cat', 'female', '${birthdayYearsAgo(2)}', 'ミックス', 4, '[]', 0, 'low', 'prod-jerky', '${stamp(1)}', '${stamp(1)}'),
      ('pet-old', 'friend-b', 'タロウ', 'dog', 'male', NULL, 'トイプードル', NULL, '[]', NULL, 'normal', NULL, '${stamp(200)}', '${stamp(120)}'),
      ('pet-other', 'friend-c', 'ヨソ', 'dog', 'male', '2020-01-01', '', 5, '[]', 1, 'normal', NULL, '${stamp(1)}', '${stamp(1)}');
  `);
}

function seedHealth(raw: Database.Database): void {
  const insert = raw.prepare(`INSERT INTO nen_health_logs (id, pet_id, friend_id, logged_on, weight_kg, stool_status, appetite, skin_status, tear_stain_status, note, heart_rate_bpm, respiratory_rate_bpm, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'normal', 'normal', ?, ?, ?, ?)`);
  // モモ：8週で体重が 10.9 → 9.7（今週の平均。−11%）。便は正常。
  const momo: Array<[number, number | null, string, string, string]> = [
    [0, 9.6, 'normal', 'normal', '散歩のあとよく水を飲んだ'], [3, 9.8, 'normal', 'good', ''], [10, 10.0, 'soft', 'normal', ''],
    [24, 10.4, 'normal', 'good', ''], [45, 10.8, 'normal', 'good', ''], [52, 10.9, 'normal', 'good', ''],
  ];
  for (const [ago, w, stool, appetite, note] of momo) insert.run(`log-momo-${ago}`, 'pet-momo', 'friend-a', day(ago), w, stool, appetite, note, ago === 0 ? 120 : null, ago === 0 ? 26 : null, stamp(ago));
  // ハナ：下痢が 3 回続く。
  for (const ago of [0, 1, 2]) insert.run(`log-hana-${ago}`, 'pet-hana', 'friend-b', day(ago), 4.0, 'diarrhea', 'normal', '', null, null, stamp(ago));
  // タロウ：45 日前が最後（30日以上 記録なし）。
  insert.run('log-old-45', 'pet-old', 'friend-b', day(45), 6.0, 'normal', 'good', '', null, null, stamp(45));
  // 別アカウントのペット（見えてはいけない）。
  insert.run('log-other-0', 'pet-other', 'friend-c', day(0), 5.0, 'bloody', 'poor', '', null, null, stamp(0));
}

function harness(role: 'owner' | 'admin' | 'staff' = 'owner', tenantId: string | null = null) {
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-a', name: '担当者', role, readOnly: false, permissionKeys: [], accountScope: 'all', tenantId });
    c.env = { DB: db };
    await next();
  });
  app.route('/', nenPets);
  return app;
}

async function get(path: string, role: 'owner' | 'admin' | 'staff' = 'owner', tenantId: string | null = null) {
  const res = await harness(role, tenantId).request(path);
  return { status: res.status, body: await res.json() as any };
}

beforeEach(() => {
  const created = createTestD1();
  sql = created.raw;
  db = created.db;
  seed(sql);
});

describe('GET /api/nen/pets（★V6 37-3 マイペット）', () => {
  it('一覧・KPI・今日の目安・体重の更新日を返し、別アカウントのペットは含めない', async () => {
    const { status, body } = await get(`/api/nen/pets?accountId=${ACCOUNT}`);
    expect(status).toBe(200);
    expect(body.data.total).toBe(3);
    expect(body.data.items.map((p: any) => p.name)).toEqual(['ハナ', 'モモ', 'タロウ']); // 更新の新しい順
    expect(body.data.kpis).toEqual({ total: 3, dogs: 2, cats: 1, newThisMonth: expect.any(Number), computable: 2, staleWeight: 1 });
    expect(body.data.products).toEqual([{ id: 'prod-mince', name: '鹿肉ミンチ' }, { id: 'prod-jerky', name: '鹿肉ジャーキー' }]);

    const momo = body.data.items.find((p: any) => p.name === 'モモ');
    // 10kg・4歳・避妊去勢済み・ふつう → 1.6 × RER 393 = 630kcal → 既定の主食 120kcal/100g で 525g
    expect(momo).toMatchObject({
      animalType: 'dog', breed: '柴犬', weightKg: 10, neutered: 'yes', activityLevel: 'normal', activityLabel: 'ふつう',
      productName: '鹿肉ミンチ', weightStale: false, ageLabel: expect.stringMatching(/^(3歳11か月|4歳0か月)$/),
      owner: { friendId: 'friend-a', name: '山田 太郎', pictureUrl: null, customerId: '10231' },
    });
    expect(momo.feeding).toMatchObject({ dailyKcal: 630, dailyGrams: 525, factorLabel: '成犬・避妊去勢済み' });

    const hana = body.data.items.find((p: any) => p.name === 'ハナ');
    expect(hana).toMatchObject({ animalType: 'cat', neutered: 'no', activityLevel: 'low', productName: '鹿肉ジャーキー' });
    expect(hana.feeding.dailyGrams).toBeGreaterThan(0);

    const taro = body.data.items.find((p: any) => p.name === 'タロウ');
    expect(taro).toMatchObject({ weightKg: null, neutered: 'unknown', feeding: null, weightStale: true, ageLabel: '—', productName: '鹿肉ミンチ' });
    expect(JSON.stringify(body)).not.toContain('ポイント');
  });

  it('絞り込み（種類・主食・体重の更新）と並び（名前・体重・年齢）と検索が効く', async () => {
    const dogs = await get(`/api/nen/pets?accountId=${ACCOUNT}&species=dog`);
    expect(dogs.body.data.items.map((p: any) => p.name)).toEqual(['モモ', 'タロウ']);

    const jerky = await get(`/api/nen/pets?accountId=${ACCOUNT}&product=prod-jerky`);
    expect(jerky.body.data.items.map((p: any) => p.name)).toEqual(['ハナ']);

    const stale = await get(`/api/nen/pets?accountId=${ACCOUNT}&weight=stale`);
    expect(stale.body.data.items.map((p: any) => p.name)).toEqual(['タロウ']);

    const byName = await get(`/api/nen/pets?accountId=${ACCOUNT}&sort=name`);
    expect(byName.body.data.items.map((p: any) => p.name)).toEqual(['タロウ', 'ハナ', 'モモ']);

    const byWeight = await get(`/api/nen/pets?accountId=${ACCOUNT}&sort=weight_desc`);
    expect(byWeight.body.data.items.map((p: any) => p.name)).toEqual(['モモ', 'ハナ', 'タロウ']);

    const byAge = await get(`/api/nen/pets?accountId=${ACCOUNT}&sort=age_desc`);
    expect(byAge.body.data.items.map((p: any) => p.name)).toEqual(['モモ', 'ハナ', 'タロウ']);

    const search = await get(`/api/nen/pets?accountId=${ACCOUNT}&q=鈴木`);
    expect(search.body.data.items.map((p: any) => p.name).sort()).toEqual(['タロウ', 'ハナ']);
    const byCustomer = await get(`/api/nen/pets?accountId=${ACCOUNT}&q=10231`);
    expect(byCustomer.body.data.items.map((p: any) => p.name)).toEqual(['モモ']);

    const paged = await get(`/api/nen/pets?accountId=${ACCOUNT}&pageSize=2&page=2`);
    expect(paged.body.data).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(paged.body.data.items.map((p: any) => p.name)).toEqual(['タロウ']);
    const all = await get(`/api/nen/pets?accountId=${ACCOUNT}&pageSize=all`);
    expect(all.body.data.pageSize).toBe(3000);
    expect(all.body.data.items).toHaveLength(3);
  });

  it('accountId 無しは 400、別テナントのアカウントは 403', async () => {
    expect((await get('/api/nen/pets')).status).toBe(400);
    expect((await get('/api/nen/pets?accountId=account-other')).status).toBe(403);
    expect((await get(`/api/nen/pets?accountId=${ACCOUNT}`, 'staff')).status).toBe(200);
  });
});

describe('GET /api/nen/health（★V6 37-4 健康日記）', () => {
  beforeEach(() => seedHealth(sql));

  it('記録のあるペットだけを、気になる変化の順に返す。KPI と 8週の体重も付く', async () => {
    const { status, body } = await get(`/api/nen/health?accountId=${ACCOUNT}`);
    expect(status).toBe(200);
    expect(body.data.total).toBe(3);
    expect(body.data.items.map((r: any) => r.pet.name)).toEqual(['ハナ', 'モモ', 'タロウ']); // 気になる変化 → 最終記録が近い順
    expect(body.data.kpis).toEqual({ recordsThisWeek: 5, petsWithRecords: 3, petsTotal: 3, concerning: 2, silent30: 1 });

    const momo = body.data.items.find((r: any) => r.pet.name === 'モモ');
    expect(momo).toMatchObject({
      owner: { friendId: 'friend-a', name: '山田 太郎', customerId: '10231' },
      lastLoggedLabel: '今日', daysSinceLast: 0, count30d: 4, totalRecords: 6, latestWeightKg: 9.6,
      latestStool: '正常', latestAppetite: '普通', concerning: true,
    });
    expect(momo.weightSeries).toHaveLength(8);
    expect(momo.weightSeries[7]).toBe(9.7); // 今週の平均（7日以内の 9.6 と 9.8）
    expect(momo.weightChangePercent).toBe(-11);
    expect(momo.changes).toEqual([{ key: 'weight_drop', label: '体重 −11%（8週）', tone: 'warn' }]);

    const hana = body.data.items.find((r: any) => r.pet.name === 'ハナ');
    expect(hana.changes.map((c: any) => c.key)).toEqual(['stool_abnormal']);
    expect(hana.latestStool).toBe('下痢');

    const taro = body.data.items.find((r: any) => r.pet.name === 'タロウ');
    expect(taro.changes).toEqual([{ key: 'silent', label: '30日以上 記録なし', tone: 'faint' }]);
    expect(taro.concerning).toBe(false);
    expect(taro.lastLoggedLabel).toBe(day(45).slice(5).replace('-', '/'));
    expect(JSON.stringify(body)).not.toContain('ヨソ');
  });

  it('絞り込み（変化・最終記録）と並び（記録の多い順）が効く', async () => {
    const concern = await get(`/api/nen/health?accountId=${ACCOUNT}&change=concern`);
    expect(concern.body.data.items.map((r: any) => r.pet.name)).toEqual(['ハナ', 'モモ']);
    const silent = await get(`/api/nen/health?accountId=${ACCOUNT}&change=silent`);
    expect(silent.body.data.items.map((r: any) => r.pet.name)).toEqual(['タロウ']);
    const over30 = await get(`/api/nen/health?accountId=${ACCOUNT}&last=over30`);
    expect(over30.body.data.items.map((r: any) => r.pet.name)).toEqual(['タロウ']);
    const week = await get(`/api/nen/health?accountId=${ACCOUNT}&last=7`);
    expect(week.body.data.items.map((r: any) => r.pet.name).sort()).toEqual(['ハナ', 'モモ']);
    const records = await get(`/api/nen/health?accountId=${ACCOUNT}&sort=records_desc`);
    expect(records.body.data.items.map((r: any) => r.pet.name)).toEqual(['モモ', 'ハナ', 'タロウ']);
    const q = await get(`/api/nen/health?accountId=${ACCOUNT}&q=山田`);
    expect(q.body.data.items.map((r: any) => r.pet.name)).toEqual(['モモ']);
  });

  it('30日のまとめ：記録・体重・平均心拍/呼吸・便/食いつきの内訳・メモ。別アカウントは 404', async () => {
    const { status, body } = await get(`/api/nen/health/pet-momo/summary?accountId=${ACCOUNT}`);
    expect(status).toBe(200);
    expect(body.data.pet).toMatchObject({ id: 'pet-momo', name: 'モモ', animalType: 'dog', breed: '柴犬', weightKg: 10 });
    expect(body.data.owner).toEqual({ friendId: 'friend-a', name: '山田 太郎' });
    expect(body.data.summary).toMatchObject({
      days: 30, records: 4,
      weight: { first: 10.4, last: 9.6, min: 9.6, max: 10.4 },
      heartRateAvg: 120, respiratoryRateAvg: 26,
      stool: { normal: 3, soft: 1 }, appetite: { normal: 2, good: 2 },
      notes: [{ loggedOn: day(0), note: '散歩のあとよく水を飲んだ' }],
    });
    expect(body.data.summary.logs).toHaveLength(4);
    expect(body.data.summary.logs[0].loggedOn).toBe(day(0));
    expect(body.data.labels.stool.diarrhea).toBe('下痢');

    expect((await get(`/api/nen/health/pet-other/summary?accountId=${ACCOUNT}`)).status).toBe(404);
    expect((await get('/api/nen/health/pet-other/summary?accountId=account-other')).status).toBe(403);
  });

  // DEEP-24: 「その他」の動物を犬へ変換しない。登録→一覧→健康まとめで種類を保持し、
  // 犬・猫専用の給与計算には進めない。
  it('種別が「その他」のペットは一覧・健康日記・まとめで other のまま返し、給与目安を計算しない', async () => {
    sql.exec(`
      INSERT INTO nen_pet_profiles (id, friend_id, name, animal_type, gender, birthday, breed, weight_kg, concerns,
        neutered, activity_level, feeding_product_id, created_at, updated_at) VALUES
        ('pet-usa', 'friend-b', 'ウー', 'other', 'female', '2024-01-10', 'うさぎ', 2, '[]', 1, 'normal', 'prod-mince', '${stamp(1)}', '${stamp(1)}')
    `);
    sql.prepare(`INSERT INTO nen_health_logs (id, pet_id, friend_id, logged_on, weight_kg, stool_status, appetite, skin_status, tear_stain_status, note, heart_rate_bpm, respiratory_rate_bpm, created_at)
      VALUES ('log-usa-0', 'pet-usa', 'friend-b', ?, 2.0, 'normal', 'good', 'normal', 'normal', '', NULL, NULL, ?)`)
      .run(day(0), stamp(0));

    const pets = await get(`/api/nen/pets?accountId=${ACCOUNT}`);
    const usa = pets.body.data.items.find((p: any) => p.name === 'ウー');
    expect(usa.animalType).toBe('other');
    // 体重・主食がそろっていても、犬猫専用の式は回さない（犬の数値を出さない）。
    expect(usa.feeding).toBeNull();

    const health = await get(`/api/nen/health?accountId=${ACCOUNT}`);
    const row = health.body.data.items.find((r: any) => r.pet.name === 'ウー');
    expect(row.pet.animalType).toBe('other');

    const summary = await get(`/api/nen/health/pet-usa/summary?accountId=${ACCOUNT}`);
    expect(summary.status).toBe(200);
    expect(summary.body.data.pet.animalType).toBe('other');
  });
});
