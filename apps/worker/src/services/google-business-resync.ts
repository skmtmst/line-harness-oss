/**
 * 飲食店向け「Googleビジネス」第4段：定期再同期。
 *
 * - 口コミ・投稿は1時間ごと（cronは5分レーンだが、接続ごとの前回時刻で55分ゲート）。
 *   店舗数が増えたらこのゲート閾値を伸ばすだけで間隔を調整できる。
 * - パフォーマンス指標は1日1回（JST日付でゲート。6時間レーンの最初の該当tickが回す）。
 *   Google側の集計は3〜5日遅れで確定するため、毎回直近7日を上書きして追随する。
 * - 取り込みの書き込み経路は手動syncと同じ関数（upsertReviewsForEnv / applyGooglePostsSync）を
 *   使い、二重実装しない。
 * - 機能「restaurant_test」がオフのアカウントは gate で止める（google-sheets と同じ作法）。
 * - ログは種別名（error.kind / error.name）だけ。応答本文・トークンは出さない。
 */
import type { Env } from '../index.js';
import { dbFor } from './db-router.js';
import { GoogleBusinessError, listAllReviews, type FetchLike } from './google-business.js';
import { listLocalPosts } from './google-business-posts.js';
import { DAILY_METRICS, fetchDailyMetrics } from './google-business-performance.js';
import { createFeatureJobGate } from './feature-enforcement.js';
import {
  accessTokenForConnection,
  recordReviewSyncResult,
  setConnectionStatusForEnv,
  upsertReviewsForEnv,
  type ConnectionRow,
} from '../routes/restaurant-google.js';
import { applyGooglePostsSync } from '../routes/restaurant-google-posts.js';

const HOURLY_STALE_MS = 55 * 60 * 1000;
const METRICS_BACKFILL_DAYS = 180;
const METRICS_REFRESH_DAYS = 7;

interface ResyncInput {
  now: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

type ResyncConnectionRow = ConnectionRow & {
  last_posts_synced_at: string | null;
  last_metrics_synced_at: string | null;
  store_line_account_id: string | null;
};

function jstDate(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function daysBefore(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isStale(lastSyncedAt: string | null, nowIso: string, staleMs: number): boolean {
  if (!lastSyncedAt) return true;
  const last = Date.parse(lastSyncedAt);
  if (!Number.isFinite(last)) return true;
  return Date.parse(nowIso) - last >= staleMs;
}

async function listActiveConnections(env: Env['Bindings']): Promise<ResyncConnectionRow[]> {
  const rows = await env.DB.prepare(
    `SELECT c.*, s.line_account_id AS store_line_account_id
       FROM rt_google_connections c
       JOIN rt_stores s ON s.id = c.store_id
      WHERE c.status = 'connected' AND c.location_name IS NOT NULL AND s.status = 'active'
      ORDER BY s.line_account_id`,
  ).all<ResyncConnectionRow>();
  return rows.results;
}

function errorKindOf(error: unknown): string {
  if (error instanceof GoogleBusinessError) return error.kind;
  return error instanceof Error ? error.name : 'unknown';
}

/** 口コミ・投稿の1時間ごとの再同期。5分レーンから呼ばれ、接続ごとの55分ゲートで間引く。 */
export async function processGoogleBusinessHourlyResync(
  env: Env['Bindings'],
  input: ResyncInput,
): Promise<{ reviewsSynced: number; postsSynced: number; skipped: number; failed: number }> {
  const fetchFn = input.fetch ?? fetch;
  const gate = createFeatureJobGate();
  const connections = await listActiveConnections(env);

  let reviewsSynced = 0;
  let postsSynced = 0;
  let skipped = 0;
  let failed = 0;

  for (const connection of connections) {
    const dueReviews = isStale(connection.last_synced_at, input.now, HOURLY_STALE_MS);
    const duePosts = isStale(connection.last_posts_synced_at, input.now, HOURLY_STALE_MS);
    if (!dueReviews && !duePosts) {
      skipped += 1;
      continue;
    }
    if (!(await gate.canRun(env.DB, connection.store_line_account_id, 'restaurant_test', 'google business resync'))) {
      skipped += 1;
      continue;
    }
    try {
      const accessToken = await accessTokenForConnection(env, connection);
      const options = { fetch: fetchFn, accessToken, sleep: input.sleep };
      if (dueReviews) {
        const result = await listAllReviews(options, connection.location_name!);
        await upsertReviewsForEnv(env, connection.store_id, result.reviews);
        await recordReviewSyncResult(env, connection.store_id, result);
        reviewsSynced += 1;
      }
      if (duePosts) {
        const googlePosts = await listLocalPosts(options, connection.location_name!);
        await applyGooglePostsSync(env, connection.store_id, googlePosts);
        await dbFor(env, connection.store_id)
          .prepare(`UPDATE rt_google_connections SET last_posts_synced_at = ?, updated_at = ? WHERE store_id = ?`)
          .bind(input.now, input.now, connection.store_id)
          .run();
        postsSynced += 1;
      }
    } catch (error) {
      failed += 1;
      if (error instanceof GoogleBusinessError && error.kind === 'no_permission') {
        await setConnectionStatusForEnv(env, connection.store_id, 'no_permission', 'no_permission');
      } else if (error instanceof GoogleBusinessError && error.kind !== 'auth_expired') {
        // auth_expired は accessTokenForConnection 内で expired へ落とし済み。
        await setConnectionStatusForEnv(env, connection.store_id, connection.status, error.kind);
      }
      console.error(JSON.stringify({ event: 'google_business_resync_failed', storeId: connection.store_id, error: errorKindOf(error) }));
    }
  }
  return { reviewsSynced, postsSynced, skipped, failed };
}

const METRIC_COLUMNS = [
  ['impressionsDesktopMaps', 'impressions_desktop_maps'],
  ['impressionsDesktopSearch', 'impressions_desktop_search'],
  ['impressionsMobileMaps', 'impressions_mobile_maps'],
  ['impressionsMobileSearch', 'impressions_mobile_search'],
  ['directionRequests', 'direction_requests'],
  ['callClicks', 'call_clicks'],
  ['websiteClicks', 'website_clicks'],
  ['menuClicks', 'menu_clicks'],
  ['bookings', 'bookings'],
  ['foodOrders', 'food_orders'],
] as const;

/** パフォーマンス指標の1日1回の取り込み。6時間レーンから呼ばれ、JST日付でゲートする。 */
export async function processGoogleBusinessDailyMetrics(
  env: Env['Bindings'],
  input: ResyncInput,
): Promise<{ synced: number; skipped: number; failed: number }> {
  const fetchFn = input.fetch ?? fetch;
  const gate = createFeatureJobGate();
  const today = jstDate(input.now);
  const connections = await listActiveConnections(env);

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const connection of connections) {
    if (connection.last_metrics_synced_at && jstDate(connection.last_metrics_synced_at) === today) {
      skipped += 1;
      continue;
    }
    if (!(await gate.canRun(env.DB, connection.store_line_account_id, 'restaurant_test', 'google business metrics'))) {
      skipped += 1;
      continue;
    }
    try {
      const accessToken = await accessTokenForConnection(env, connection);
      // 初回は過去180日（90日表示＋前期比較のぶん）、2回目以降は直近7日だけ取り直す。
      const backfillDays = connection.last_metrics_synced_at ? METRICS_REFRESH_DAYS : METRICS_BACKFILL_DAYS;
      const days = await fetchDailyMetrics(
        { fetch: fetchFn, accessToken, sleep: input.sleep },
        connection.location_name!,
        { startDate: daysBefore(today, backfillDays), endDate: today },
      );
      const db = dbFor(env, connection.store_id);
      const columns = METRIC_COLUMNS.map(([, column]) => column);
      const statements = Object.entries(days).map(([date, values]) =>
        db
          .prepare(
            `INSERT INTO rt_google_metrics_daily (store_id, date, ${columns.join(', ')}, fetched_at)
             VALUES (?, ?, ${columns.map(() => '?').join(', ')}, ?)
             ON CONFLICT(store_id, date) DO UPDATE SET
               ${columns.map((column) => `${column} = excluded.${column}`).join(', ')},
               fetched_at = excluded.fetched_at`,
          )
          .bind(connection.store_id, date, ...METRIC_COLUMNS.map(([key]) => values[key]), input.now),
      );
      for (let index = 0; index < statements.length; index += 50) {
        await db.batch(statements.slice(index, index + 50));
      }
      await db
        .prepare(`UPDATE rt_google_connections SET last_metrics_synced_at = ?, updated_at = ? WHERE store_id = ?`)
        .bind(input.now, input.now, connection.store_id)
        .run();
      synced += 1;
    } catch (error) {
      failed += 1;
      if (error instanceof GoogleBusinessError && error.kind === 'no_permission') {
        await setConnectionStatusForEnv(env, connection.store_id, 'no_permission', 'no_permission');
      }
      console.error(JSON.stringify({ event: 'google_business_metrics_failed', storeId: connection.store_id, error: errorKindOf(error) }));
    }
  }
  return { synced, skipped, failed };
}

// 画面側の集計で使う列名の対応（テスト・ルートから参照する）。
export { DAILY_METRICS };
