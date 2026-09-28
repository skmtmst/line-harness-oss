import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { encryptCredential, setAccountSetting } from '@line-crm/db';
import { processGoogleBusinessDailyMetrics, processGoogleBusinessHourlyResync } from './google-business-resync.js';
import type { FetchLike } from './google-business.js';

type Env = import('../index.js').Env;

const TENANT = '00000000-0000-4000-8000-000000000001';
const LOCATION = 'accounts/111/locations/222';
const LOCATION2 = 'accounts/111/locations/333';
const ENC_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
/** 2026-09-29（火）03:05 JST。深夜の6時間tick相当。 */
const NOW = '2026-09-28T18:05:00.000Z';

let testDb: SqliteD1;
let env: Env['Bindings'];
let calls: Array<{ url: string; init?: RequestInit }>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;

const noSleep = async () => {};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function googleFetch(overrides: { failLocationId?: string } = {}): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    if (overrides.failLocationId && url.includes(`locations/${overrides.failLocationId}`)) {
      return jsonResponse({ error: { message: 'boom' } }, 500);
    }
    if (url.includes('/reviews')) {
      return jsonResponse({
        reviews: [
          {
            name: `${LOCATION}/reviews/r1`,
            reviewer: { displayName: '田中' },
            starRating: 'FIVE',
            comment: 'おいしかったです。',
            createTime: '2026-09-28T10:00:00Z',
            updateTime: '2026-09-28T10:00:00Z',
          },
        ],
        averageRating: 4.5,
        totalReviewCount: 1,
      });
    }
    if (url.includes('/localPosts')) {
      return jsonResponse({
        localPosts: [
          {
            name: `${LOCATION}/localPosts/g1`,
            topicType: 'STANDARD',
            summary: 'Google側で作られた投稿',
            state: 'LIVE',
            createTime: '2026-09-27T00:00:00Z',
            updateTime: '2026-09-27T00:00:00Z',
            searchUrl: 'https://g.page/g1',
          },
        ],
      });
    }
    if (url.includes('fetchMultiDailyMetricsTimeSeries')) {
      return jsonResponse({
        multiDailyMetricTimeSeries: [
          {
            dailyMetricTimeSeries: [
              {
                dailyMetric: 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
                timeSeries: { datedValues: [{ date: { year: 2026, month: 9, day: 25 }, value: '120' }] },
              },
              {
                dailyMetric: 'CALL_CLICKS',
                timeSeries: { datedValues: [{ date: { year: 2026, month: 9, day: 25 }, value: '4' }] },
              },
            ],
          },
        ],
      });
    }
    return jsonResponse({}, 404);
  };
}

function seedStore(storeId: string, accountId: string, code: string): void {
  testDb.raw
    .prepare('INSERT INTO rt_stores (id, organization_id, name, code, area, capacity, line_account_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(storeId, 'org-1', `こもれび食堂 ${code}`, code, '東京', 20, accountId);
}

async function seedConnection(id: string, storeId: string, accountId: string, locationName: string): Promise<void> {
  testDb.raw
    .prepare(
      `INSERT INTO rt_google_connections
        (id, store_id, line_account_id, google_account_email, location_name, location_title, refresh_token_enc, access_token_enc, access_token_expires_at, status, connected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?)`,
    )
    .run(id, storeId, accountId, 'owner@example.test', locationName, 'こもれび食堂', await encryptCredential('refresh-secret', ENC_KEY), await encryptCredential('access-secret', ENC_KEY), '2099-01-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
}

function connectionRow(storeId: string): Record<string, unknown> {
  return testDb.raw.prepare('SELECT * FROM rt_google_connections WHERE store_id = ?').get(storeId) as Record<string, unknown>;
}

beforeEach(async () => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  testDb = createTestD1();
  calls = [];
  env = {
    DB: testDb.db,
    LINE_CREDENTIAL_ENCRYPTION_KEY: ENC_KEY,
    GOOGLE_BUSINESS_OAUTH_CLIENT_ID: 'client-id',
    GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET: 'client-secret',
  } as Env['Bindings'];
  for (const [id, name] of [['account-1', '統括'], ['account-2', '渋谷店'], ['account-3', '恵比寿店']]) {
    testDb.raw
      .prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id) VALUES (?, ?, ?, ?, ?, 1, ?)`)
      .run(id, `ch-${id}`, name, 'token', 'secret', TENANT);
  }
  testDb.raw.prepare('INSERT INTO rt_organizations (id, account_id, tenant_id, name) VALUES (?, ?, ?, ?)').run('org-1', 'account-1', TENANT, '飲食店LAB');
  seedStore('store-shibuya', 'account-2', 'SHIBUYA');
  await seedConnection('conn-1', 'store-shibuya', 'account-2', LOCATION);
});

afterEach(() => {
  errorSpy.mockRestore();
  infoSpy.mockRestore();
});

describe('processGoogleBusinessHourlyResync', () => {
  it('前回同期が古い接続の口コミと投稿を取り込み、時刻を記録する', async () => {
    const result = await processGoogleBusinessHourlyResync(env, { now: NOW, fetch: googleFetch(), sleep: noSleep });
    expect(result).toMatchObject({ reviewsSynced: 1, postsSynced: 1, failed: 0 });

    const review = testDb.raw.prepare('SELECT * FROM rt_google_reviews WHERE store_id = ?').get('store-shibuya') as Record<string, unknown>;
    expect(review.review_name).toBe(`${LOCATION}/reviews/r1`);
    expect(review.reply_status).toBe('unreplied');

    const post = testDb.raw.prepare('SELECT * FROM rt_google_posts WHERE store_id = ?').get('store-shibuya') as Record<string, unknown>;
    expect(post.origin).toBe('google');
    expect(post.status).toBe('published');

    const connection = connectionRow('store-shibuya');
    expect(connection.last_synced_at).toBeTruthy();
    expect(connection.last_posts_synced_at).toBe(NOW);
    expect(connection.average_rating).toBe(4.5);
  });

  it('55分以内に同期済みならGoogleを呼ばない', async () => {
    const recent = '2026-09-28T17:40:00.000Z';
    testDb.raw
      .prepare('UPDATE rt_google_connections SET last_synced_at = ?, last_posts_synced_at = ? WHERE store_id = ?')
      .run(recent, recent, 'store-shibuya');
    const result = await processGoogleBusinessHourlyResync(env, { now: NOW, fetch: googleFetch(), sleep: noSleep });
    expect(result).toMatchObject({ reviewsSynced: 0, postsSynced: 0, skipped: 1, failed: 0 });
    expect(calls).toHaveLength(0);
  });

  it('機能 restaurant_test がオフのアカウントは同期しない', async () => {
    await setAccountSetting(testDb.db, 'account-2', 'feature.restaurant_test', 'false');
    const result = await processGoogleBusinessHourlyResync(env, { now: NOW, fetch: googleFetch(), sleep: noSleep });
    expect(result).toMatchObject({ reviewsSynced: 0, postsSynced: 0, skipped: 1, failed: 0 });
    expect(calls).toHaveLength(0);
  });

  it('1店舗の失敗が他店舗の同期を止めない', async () => {
    seedStore('store-ebisu', 'account-3', 'EBISU');
    await seedConnection('conn-2', 'store-ebisu', 'account-3', LOCATION2);
    // LOCATION2（333）は常に500。並び順で先に失敗しても渋谷店は同期される。
    const result = await processGoogleBusinessHourlyResync(env, { now: NOW, fetch: googleFetch({ failLocationId: '333' }), sleep: noSleep });
    expect(result.failed).toBe(1);
    expect(result.reviewsSynced).toBe(1);
    const review = testDb.raw.prepare('SELECT COUNT(*) AS n FROM rt_google_reviews WHERE store_id = ?').get('store-shibuya') as { n: number };
    expect(review.n).toBe(1);
  });
});

describe('processGoogleBusinessDailyMetrics', () => {
  it('初回は過去180日を取り、指標をDBへ入れて時刻を記録する', async () => {
    const result = await processGoogleBusinessDailyMetrics(env, { now: NOW, fetch: googleFetch(), sleep: noSleep });
    expect(result).toMatchObject({ synced: 1, failed: 0 });

    const call = calls.find((c) => c.url.includes('fetchMultiDailyMetricsTimeSeries'));
    expect(call).toBeDefined();
    const url = new URL(call!.url);
    // NOW は JST で 2026-09-29。180日前 = 2026-04-02。
    expect(url.searchParams.get('daily_range.start_date.year')).toBe('2026');
    expect(url.searchParams.get('daily_range.start_date.month')).toBe('4');
    expect(url.searchParams.get('daily_range.start_date.day')).toBe('2');
    expect(url.searchParams.get('daily_range.end_date.month')).toBe('9');
    expect(url.searchParams.get('daily_range.end_date.day')).toBe('29');

    const row = testDb.raw.prepare('SELECT * FROM rt_google_metrics_daily WHERE store_id = ? AND date = ?').get('store-shibuya', '2026-09-25') as Record<string, unknown>;
    expect(row.impressions_mobile_search).toBe(120);
    expect(row.call_clicks).toBe(4);
    // 応答に無い指標は null（0件と区別）
    expect(row.menu_clicks).toBeNull();
    expect(connectionRow('store-shibuya').last_metrics_synced_at).toBe(NOW);
  });

  it('同じJST日の2回目はスキップし、翌日は直近7日だけ取り直す', async () => {
    await processGoogleBusinessDailyMetrics(env, { now: NOW, fetch: googleFetch(), sleep: noSleep });
    calls = [];
    const sameDay = await processGoogleBusinessDailyMetrics(env, { now: '2026-09-28T21:00:00.000Z', fetch: googleFetch(), sleep: noSleep });
    expect(sameDay).toMatchObject({ synced: 0, skipped: 1 });
    expect(calls).toHaveLength(0);

    const nextDay = await processGoogleBusinessDailyMetrics(env, { now: '2026-09-29T18:05:00.000Z', fetch: googleFetch(), sleep: noSleep });
    expect(nextDay).toMatchObject({ synced: 1 });
    const url = new URL(calls.find((c) => c.url.includes('fetchMultiDailyMetricsTimeSeries'))!.url);
    // 翌日（JST 2026-09-30）の7日前 = 2026-09-23
    expect(url.searchParams.get('daily_range.start_date.month')).toBe('9');
    expect(url.searchParams.get('daily_range.start_date.day')).toBe('23');
  });

  it('再取得は同じ日付の行を上書きする（遅れて確定する値に追随）', async () => {
    await processGoogleBusinessDailyMetrics(env, { now: NOW, fetch: googleFetch(), sleep: noSleep });
    const updatedFetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        multiDailyMetricTimeSeries: [
          {
            dailyMetricTimeSeries: [
              { dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ date: { year: 2026, month: 9, day: 25 }, value: '9' }] } },
            ],
          },
        ],
      });
    };
    await processGoogleBusinessDailyMetrics(env, { now: '2026-09-29T18:05:00.000Z', fetch: updatedFetch, sleep: noSleep });
    const rows = testDb.raw.prepare('SELECT * FROM rt_google_metrics_daily WHERE store_id = ? AND date = ?').all('store-shibuya', '2026-09-25') as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].call_clicks).toBe(9);
  });
});
