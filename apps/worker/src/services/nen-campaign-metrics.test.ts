import { beforeEach, describe, expect, it } from 'vitest';

import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import {
  NenCampaignMetricsError,
  getNenColumnMetrics,
  getNenDeliveryDetail,
  getNenFlowMetrics,
  getNenPetMetrics,
  listNenDeliveries,
  nenMetricsRange,
  retryNenDelivery,
} from './nen-campaign-metrics.js';

const NOW = new Date('2026-09-07T00:00:00.000Z');
const RANGE = nenMetricsRange(30, NOW);

function insertAccount(raw: SqliteD1['raw'], id: string, name: string): void {
  raw.prepare(
    `INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, created_at, updated_at)
     VALUES (?, ?, ?, 'token', 'secret', '2026-01-01', '2026-01-01')`,
  ).run(id, `channel-${id}`, name);
}

function insertCampaign(raw: SqliteD1['raw'], key: string, category: string, label: string): void {
  raw.prepare(
    `INSERT INTO nen_campaign_settings
      (campaign_key, label, category, delay_days, delivery_time, is_enabled,
       title, body_text, created_at, updated_at)
     VALUES (?, ?, ?, 0, '10:00', 1, ?, '本文', '2026-01-01', '2026-01-01')`,
  ).run(key, label, category, `${label}のお知らせ`);
}

function insertJob(
  raw: SqliteD1['raw'],
  input: {
    id: string;
    accountId: string;
    friendId: string;
    campaignKey?: string;
    sourceKey?: string;
    status?: string;
    attempts?: number;
    sentAt?: string | null;
    lastError?: string | null;
    payload?: Record<string, unknown>;
  },
): void {
  const campaignKey = input.campaignKey ?? 'arrival_check';
  const setting = raw.prepare(
    `SELECT campaign_key, label, category, delay_days, delivery_time, is_enabled,
            title, body_text, button_label, button_url, image_url
       FROM nen_campaign_settings WHERE campaign_key = ?`,
  ).get(campaignKey);
  raw.prepare(
    `INSERT INTO nen_delivery_jobs
      (id, campaign_key, friend_id, line_account_id, source_key, payload, campaign_snapshot,
       scheduled_at, status, attempts, last_error, sent_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '2026-09-01 10:00:00', ?, ?, ?, ?, '2026-09-01', '2026-09-01')`,
  ).run(
    input.id,
    campaignKey,
    input.friendId,
    input.accountId,
    input.sourceKey ?? `source:${input.id}`,
    JSON.stringify(input.payload ?? {}),
    JSON.stringify(setting),
    input.status ?? 'sent',
    input.attempts ?? 1,
    input.lastError ?? null,
    input.sentAt === undefined ? '2026-09-01 10:01:00' : input.sentAt,
  );
}

describe('NEN campaign metrics', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    insertAccount(testDb.raw, 'account-a', 'NEN本店');
    insertAccount(testDb.raw, 'account-b', '別店舗');
    insertCampaign(testDb.raw, 'arrival_check', 'follow_up', '到着確認');
    insertCampaign(testDb.raw, 'column', 'column', 'NENコラム');
    insertFriend(testDb.raw, 'friend-a', {
      line_account_id: 'account-a', display_name: '愛犬家A', line_user_id: 'Ua',
    });
    insertFriend(testDb.raw, 'friend-b', {
      line_account_id: 'account-b', display_name: '愛犬家B', line_user_id: 'Ub',
    });
  });

  it('実データだけでフロー・コラム・ペット集計を返し、未取得値をnullにする', async () => {
    insertJob(testDb.raw, { id: 'flow-a', accountId: 'account-a', friendId: 'friend-a' });
    insertJob(testDb.raw, { id: 'foreign-flow', accountId: 'account-b', friendId: 'friend-b' });
    testDb.raw.prepare(
      `INSERT INTO conversion_points (id, name, event_type, created_at, line_account_id)
       VALUES ('point-a', '購入', 'purchase', '2026-01-01', 'account-a')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO conversion_events (id, conversion_point_id, friend_id, created_at)
       VALUES ('conversion-a', 'point-a', 'friend-a', '2026-09-02 10:00:00')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO nen_columns
        (id, slug, title, excerpt, article_url, delivery_status, line_account_id, created_at, updated_at)
       VALUES ('column-a', 'health', '健康コラム', '', 'https://example.com/health', 'sent',
               'account-a', '2026-09-01', '2026-09-01')`,
    ).run();
    insertJob(testDb.raw, {
      id: 'column-job', accountId: 'account-a', friendId: 'friend-a', campaignKey: 'column',
      sourceKey: 'column:column-a',
    });
    testDb.raw.prepare(
      `INSERT INTO tracked_links
        (id, name, original_url, is_active, created_at, updated_at, line_account_id)
       VALUES ('link-a', '健康コラム', 'https://example.com/health', 1,
               '2026-09-01', '2026-09-01', 'account-a')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO link_clicks (id, tracked_link_id, friend_id, clicked_at)
       VALUES ('click-a', 'link-a', 'friend-a', '2026-09-02 09:00:00')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO nen_pet_profiles
        (id, friend_id, name, animal_type, gender, birthday, breed, created_at, updated_at)
       VALUES ('pet-a', 'friend-a', 'こむぎ', 'dog', 'female', '2020-09-10', '柴犬',
               '2026-01-01', '2026-09-01')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO nen_coupon_issues
        (id, pet_id, friend_id, issue_year, coupon_code, benefit_label, expires_at, issued_at, used_at)
       VALUES ('coupon-a', 'pet-a', 'friend-a', 2026, 'SECRET-COUPON', '500円引き',
               '2026-09-30', '2026-09-01', '2026-09-02')`,
    ).run();

    const [flows, columns, pets] = await Promise.all([
      getNenFlowMetrics(testDb.db, 'account-a', RANGE),
      getNenColumnMetrics(testDb.db, 'account-a', RANGE),
      getNenPetMetrics(testDb.db, 'account-a', RANGE),
    ]);

    const arrival = flows.flows.find((flow) => flow.campaignKey === 'arrival_check');
    expect(arrival).toMatchObject({ planned: 1, sent: 1, associatedConversions: 1 });
    expect(arrival?.openRate).toMatchObject({ value: null, state: 'unavailable' });
    expect(flows.summary.sent).toBe(2);
    expect(columns.columns[0]).toMatchObject({
      id: 'column-a', targeted: 1, sent: 1, unread: 0,
      articleOpened: { value: 1, rate: 1, state: 'available' },
      completionRate: { value: null, state: 'unavailable' },
    });
    expect(pets.summary).toMatchObject({
      pets: 1, birthdayRegistered: 1, friends: 1, friendsWithoutPet: 0,
      coupons: { issued: 1, used: 1, usageRate: 1 },
    });
    expect(pets.pets[0]).toMatchObject({
      id: 'pet-a', breed: '柴犬', ownerDeliveryHistory: { count: 2 },
    });
  });

  it('データが無いときは空状態を返し、推測の数値を作らない', async () => {
    const [columns, pets, deliveries] = await Promise.all([
      getNenColumnMetrics(testDb.db, 'account-a', RANGE),
      getNenPetMetrics(testDb.db, 'account-a', RANGE),
      listNenDeliveries(testDb.db, {
        lineAccountId: 'account-a', range: RANGE, cursor: 0, limit: 50,
      }),
    ]);

    expect(columns).toMatchObject({ summary: { total: 0, unread: null }, columns: [] });
    expect(pets.summary.birthdayOpenRate).toMatchObject({ value: null, state: 'unavailable' });
    expect(deliveries).toMatchObject({ deliveries: [], pagination: { total: 0, nextCursor: null } });
  });

  it('配信履歴をアカウントで分離し、raw payloadを詳細へ出さない', async () => {
    insertJob(testDb.raw, {
      id: 'job-a', accountId: 'account-a', friendId: 'friend-a', status: 'failed', attempts: 5,
      sentAt: null, lastError: 'upstream secret: token-123', payload: { couponCode: 'SECRET-COUPON' },
    });
    insertJob(testDb.raw, {
      id: 'job-b', accountId: 'account-b', friendId: 'friend-b', status: 'failed', attempts: 5,
      sentAt: null,
    });

    const list = await listNenDeliveries(testDb.db, {
      lineAccountId: 'account-a', range: RANGE, cursor: 0, limit: 50,
    });
    expect(list.deliveries).toHaveLength(1);
    expect(list.deliveries[0]).toMatchObject({
      id: 'job-a', lineAccountName: 'NEN本店', unmetReason: '最大回数まで送信に失敗しました',
    });
    expect(JSON.stringify(list)).not.toContain('token-123');
    const detail = await getNenDeliveryDetail(testDb.db, 'job-a', 'account-a');
    expect(JSON.stringify(detail)).not.toContain('SECRET-COUPON');
    await expect(getNenDeliveryDetail(testDb.db, 'job-b', 'account-a')).rejects.toMatchObject({
      code: 'not_found', status: 404,
    });
  });

  it('恒久失敗だけを版指定で再送し、同じ版の二重操作を409にする', async () => {
    insertJob(testDb.raw, {
      id: 'job-a', accountId: 'account-a', friendId: 'friend-a', status: 'failed', attempts: 5,
      sentAt: null,
    });
    const result = await retryNenDelivery(testDb.db, {
      id: 'job-a', lineAccountId: 'account-a', expectedVersion: 1,
      reason: 'お客様確認後に再送', staffId: 'staff-a',
    });
    expect(result).toMatchObject({ status: 'pending', attempts: 0, retryGeneration: 1, version: 2 });
    expect(testDb.raw.prepare(
      `SELECT status, attempts, version, retry_generation, last_retry_reason,
              last_retry_requested_by
         FROM nen_delivery_jobs WHERE id = 'job-a'`,
    ).get()).toEqual({
      status: 'pending', attempts: 0, version: 2, retry_generation: 1,
      last_retry_reason: 'お客様確認後に再送', last_retry_requested_by: 'staff-a',
    });
    testDb.raw.prepare(
      `UPDATE nen_delivery_jobs SET status = 'failed', attempts = 5 WHERE id = 'job-a'`,
    ).run();
    await expect(retryNenDelivery(testDb.db, {
      id: 'job-a', lineAccountId: 'account-a', expectedVersion: 1,
      reason: '重複操作', staffId: 'staff-b',
    })).rejects.toMatchObject({ code: 'version_conflict', status: 409 });
  });

  it('DB障害を成功や空状態へ変換しない', async () => {
    const broken = {
      prepare: () => ({ all: async () => { throw new Error('db unavailable'); } }),
    } as unknown as D1Database;
    await expect(getNenFlowMetrics(broken, 'account-a', RANGE)).rejects.toThrow('db unavailable');
  });

  it('入力不正は安定したエラー情報を返す', () => {
    expect(RANGE).toMatchObject({
      fromSql: '2026-08-08T00:00:00.000Z', toSql: '2026-09-07T00:00:00.000Z',
    });
    expect(() => nenMetricsRange(366, NOW)).toThrowError(NenCampaignMetricsError);
    try {
      nenMetricsRange(366, NOW);
    } catch (error) {
      expect(error).toMatchObject({ code: 'days_invalid', status: 400, field: 'days' });
    }
  });
});
