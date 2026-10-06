import { beforeEach, describe, expect, test } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import {
  GOOGLE_CONTENT_PURGE_AFTER_DAYS,
  GOOGLE_CONTENT_RETENTION_LIMIT_DAYS,
  deleteGoogleContentForStore,
  purgeExpiredGoogleContent,
  totalRetentionActions,
} from './google-business-retention.js';

/*
 * Googleから受け取った内容の保存期限（暦日30日）。
 *
 * ここはSQLそのものが仕様（どの表のどの時刻列で切るか、行を消すのか列だけ消すのか）
 * なので、手書きのモックではなく本物のSQLiteに当てる。
 * 「消える」だけでなく「消してはいけないものが残る」ことまで確かめる。
 */

const DAY = 24 * 60 * 60 * 1000;

/** 今回の実行時刻。保存期限の判定はここを基準にする。 */
const NOW = '2026-06-01T00:00:00.000Z';

/** NOW から相対の時刻。UTC列（datetime('now')系）に入れる。 */
function utc(offsetDays: number): string {
  return new Date(Date.parse(NOW) + offsetDays * DAY).toISOString();
}

/**
 * NOW から相対の時刻をJST表記で返す。
 *
 * rt_google_posts と rt_google_metrics_daily の時刻列だけ `+9 hours` で書かれており、
 * 同じ瞬間でもUTC列より9時間先の文字列になる。この9時間ずれを含めても
 * 30日を超えないことを確かめるために、テストでも実際の書き方を再現する。
 */
function jst(offsetDays: number): string {
  return new Date(Date.parse(NOW) + offsetDays * DAY + 9 * 60 * 60 * 1000)
    .toISOString()
    .replace('Z', '');
}

describe('Googleビジネスの保存期限', () => {
  let sqlite: SqliteD1;

  beforeEach(() => {
    sqlite = createTestD1();
  });

  function env() {
    return { DB: sqlite.db };
  }

  function seedReview(id: string, storeId: string, updatedAt: string): void {
    sqlite.raw
      .prepare(
        `INSERT INTO rt_google_reviews
           (id, store_id, review_name, reviewer_display_name, star_rating, comment, create_time, updated_at)
         VALUES (?, ?, ?, '山田', 5, '美味しかった', ?, ?)`,
      )
      .run(id, storeId, `locations/l1/reviews/${id}`, updatedAt, updatedAt);
  }

  function seedProfile(storeId: string, fetchedAt: string): void {
    sqlite.raw
      .prepare(
        `INSERT INTO rt_google_profiles (store_id, location_name, profile_json, fingerprint, fetched_at, updated_at)
         VALUES (?, 'locations/l1', '{"title":"店"}', 'fp', ?, ?)`,
      )
      .run(storeId, fetchedAt, fetchedAt);
  }

  function seedPost(
    id: string,
    storeId: string,
    origin: 'admin' | 'google',
    updatedAt: string,
    google: { state?: string | null; searchUrl?: string | null } = {},
  ): void {
    sqlite.raw
      .prepare(
        `INSERT INTO rt_google_posts
           (id, store_id, kind, origin, summary, status, google_post_name, google_state, search_url,
            google_create_time, google_update_time, created_at, updated_at)
         VALUES (?, ?, 'standard', ?, '本日のおすすめ', 'published', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        storeId,
        origin,
        `locations/l1/localPosts/${id}`,
        google.state ?? 'LIVE',
        google.searchUrl ?? 'https://example.test/post',
        updatedAt,
        updatedAt,
        updatedAt,
        updatedAt,
      );
  }

  function seedMetrics(storeId: string, date: string, fetchedAt: string): void {
    sqlite.raw
      .prepare('INSERT INTO rt_google_metrics_daily (store_id, date, call_clicks, fetched_at) VALUES (?, ?, 3, ?)')
      .run(storeId, date, fetchedAt);
  }

  function seedCandidate(id: string, storeId: string, createdAt: string): void {
    sqlite.raw
      .prepare(
        `INSERT INTO rt_google_location_candidates (id, store_id, location_name, location_title, created_at)
         VALUES (?, ?, ?, '候補の店', ?)`,
      )
      .run(id, storeId, `locations/${id}`, createdAt);
  }

  function seedOauthState(
    state: string,
    storeId: string,
    options: { expiresAt: string; usedAt?: string | null },
  ): void {
    sqlite.raw
      .prepare(
        `INSERT INTO rt_google_oauth_states
           (state, store_id, staff_id, mode, code_verifier_enc, expires_at, used_at, created_at)
         VALUES (?, ?, 'staff-1', 'connect', 'v1.iv.cipher', ?, ?, ?)`,
      )
      .run(state, storeId, options.expiresAt, options.usedAt ?? null, utc(-1));
  }

  function seedWriteLog(id: string, storeId: string, createdAt: string, beforeText: string | null): void {
    sqlite.raw
      .prepare(
        `INSERT INTO rt_google_write_log (id, store_id, kind, target_name, before_text, after_text, result, created_at)
         VALUES (?, ?, 'review_reply', 'locations/l1/reviews/r1', ?, 'ご来店ありがとうございます', 'accepted', ?)`,
      )
      .run(id, storeId, beforeText, createdAt);
  }

  function seedChange(id: string, storeId: string, updatedAt: string, beforeJson: string | null): void {
    sqlite.raw
      .prepare(
        `INSERT INTO rt_google_changes
           (id, store_id, kind, source, summary, target_json, before_json, after_json, status, created_at, updated_at)
         VALUES (?, ?, 'special_hours', 'calendar', '12/31を休業にする', '{"date":"2026-12-31"}', ?, '{"closed":true}',
                 'applied', ?, ?)`,
      )
      .run(id, storeId, beforeJson, updatedAt, updatedAt);
  }

  function count(sql: string, ...binds: unknown[]): number {
    const row = sqlite.raw.prepare(sql).get(...(binds as never[])) as { n: number };
    return row.n;
  }

  test('掃除を始める日数は、公開文書に書く上限より短い', () => {
    // tickの遅れ(最大6時間)と時刻列のJST/UTCずれ(最大9時間)を足しても上限を超えないこと。
    expect(GOOGLE_CONTENT_PURGE_AFTER_DAYS).toBeLessThan(GOOGLE_CONTENT_RETENTION_LIMIT_DAYS);
    const slack = (GOOGLE_CONTENT_RETENTION_LIMIT_DAYS - GOOGLE_CONTENT_PURGE_AFTER_DAYS) * 24;
    expect(slack).toBeGreaterThanOrEqual(6 + 9);
  });

  test('期限を過ぎたGoogle受信内容は消え、期限内のものは残る', async () => {
    seedReview('old-review', 's1', utc(-29));
    seedReview('new-review', 's1', utc(-27));
    seedProfile('s1', utc(-29));
    seedProfile('s2', utc(-27));
    seedPost('old-imported', 's1', 'google', jst(-29));
    seedPost('new-imported', 's1', 'google', jst(-27));
    seedMetrics('s1', '2026-05-01', jst(-29));
    seedMetrics('s1', '2026-05-30', jst(-27));
    seedCandidate('old-cand', 's1', utc(-29));
    seedCandidate('new-cand', 's1', utc(-27));

    const result = await purgeExpiredGoogleContent(env(), { now: NOW });

    expect(result.reviews).toBe(1);
    expect(result.profiles).toBe(1);
    expect(result.importedPosts).toBe(1);
    expect(result.metrics).toBe(1);
    expect(result.locationCandidates).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_reviews WHERE id = 'new-review'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_reviews WHERE id = 'old-review'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_profiles WHERE store_id = 's2'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_posts WHERE id = 'new-imported'")).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM rt_google_metrics_daily')).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_location_candidates WHERE id = 'new-cand'")).toBe(1);
  });

  test('自分たちの操作記録は行を残し、Google由来のスナップショット列だけ消す', async () => {
    seedWriteLog('log-old', 's1', utc(-29), '前の返信文');
    seedWriteLog('log-new', 's1', utc(-27), '新しい返信文');
    seedChange('chg-old', 's1', utc(-29), '{"before":"10:00-22:00"}');
    seedChange('chg-new', 's1', utc(-27), '{"before":"11:00-22:00"}');

    const result = await purgeExpiredGoogleContent(env(), { now: NOW });

    expect(result.redactedWriteLogs).toBe(1);
    expect(result.redactedChanges).toBe(1);
    // 行は消えない（誰がいつ何を送ったかの記録は残す）。
    expect(count('SELECT COUNT(*) AS n FROM rt_google_write_log')).toBe(2);
    expect(count('SELECT COUNT(*) AS n FROM rt_google_changes')).toBe(2);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_write_log WHERE id = 'log-old' AND before_text IS NULL")).toBe(1);
    expect(
      count("SELECT COUNT(*) AS n FROM rt_google_write_log WHERE id = 'log-new' AND before_text IS NOT NULL"),
    ).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_changes WHERE id = 'chg-old' AND before_json IS NULL")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_changes WHERE id = 'chg-new' AND before_json IS NOT NULL")).toBe(
      1,
    );
    // 送信した内容そのもの（after）は自分たちが作った文なので消さない。
    expect(count("SELECT COUNT(*) AS n FROM rt_google_write_log WHERE after_text IS NOT NULL")).toBe(2);
  });

  test('自分たちが作った投稿は行を残し、Googleが返した状態の写しだけ消す', async () => {
    seedPost('mine-old', 's1', 'admin', jst(-29));
    seedPost('mine-new', 's1', 'admin', jst(-27));

    const result = await purgeExpiredGoogleContent(env(), { now: NOW });

    expect(result.redactedPostState).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM rt_google_posts')).toBe(2);
    expect(
      count(
        `SELECT COUNT(*) AS n FROM rt_google_posts
          WHERE id = 'mine-old' AND google_state IS NULL AND search_url IS NULL
            AND google_create_time IS NULL AND google_update_time IS NULL`,
      ),
    ).toBe(1);
    // どの投稿を送ったかは自分たちの記録なので残す。
    expect(count("SELECT COUNT(*) AS n FROM rt_google_posts WHERE id = 'mine-old' AND google_post_name IS NOT NULL")).toBe(
      1,
    );
    expect(count("SELECT COUNT(*) AS n FROM rt_google_posts WHERE id = 'mine-new' AND google_state IS NOT NULL")).toBe(
      1,
    );
  });

  test('認可の途中状態は、使い終わったか期限が切れた時点で消す（30日は待たない）', async () => {
    seedOauthState('used', 's1', { expiresAt: utc(1), usedAt: utc(0) });
    seedOauthState('expired', 's1', { expiresAt: utc(-0.001) });
    seedOauthState('alive', 's1', { expiresAt: utc(0.01) });

    const result = await purgeExpiredGoogleContent(env(), { now: NOW });

    expect(result.oauthStates).toBe(2);
    expect(count('SELECT COUNT(*) AS n FROM rt_google_oauth_states')).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_oauth_states WHERE state = 'alive'")).toBe(1);
  });

  test('消すものが無ければ件数は0で、ログを出す条件にならない', async () => {
    seedReview('fresh', 's1', utc(-1));

    const result = await purgeExpiredGoogleContent(env(), { now: NOW });

    expect(totalRetentionActions(result)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM rt_google_reviews')).toBe(1);
  });

  test('連携を解除した店舗のGoogle受信内容は、期限を待たずその場で消える', async () => {
    seedReview('r-s1', 's1', utc(-1));
    seedReview('r-s2', 's2', utc(-1));
    seedProfile('s1', utc(-1));
    seedProfile('s2', utc(-1));
    seedPost('imported-s1', 's1', 'google', jst(-1));
    seedPost('mine-s1', 's1', 'admin', jst(-1));
    seedPost('imported-s2', 's2', 'google', jst(-1));
    seedMetrics('s1', '2026-05-30', jst(-1));
    seedMetrics('s2', '2026-05-30', jst(-1));
    seedCandidate('cand-s1', 's1', utc(-1));
    seedCandidate('cand-s2', 's2', utc(-1));
    seedOauthState('state-s1', 's1', { expiresAt: utc(1) });
    seedOauthState('state-s2', 's2', { expiresAt: utc(1) });
    seedChange('chg-s1', 's1', utc(-1), '{"before":"10:00-22:00"}');
    seedWriteLog('log-s1', 's1', utc(-1), '前の返信文');
    seedWriteLog('log-s2', 's2', utc(-1), '前の返信文');

    await deleteGoogleContentForStore(sqlite.db, 's1');

    // 解除した店舗のGoogle受信内容は残らない。
    expect(count("SELECT COUNT(*) AS n FROM rt_google_reviews WHERE store_id = 's1'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_profiles WHERE store_id = 's1'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_posts WHERE store_id = 's1' AND origin = 'google'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_metrics_daily WHERE store_id = 's1'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_location_candidates WHERE store_id = 's1'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_oauth_states WHERE store_id = 's1'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_changes WHERE store_id = 's1'")).toBe(0);
    // 自分たちの送信記録は残し、Google由来の写しだけ消す。
    expect(count("SELECT COUNT(*) AS n FROM rt_google_write_log WHERE store_id = 's1'")).toBe(1);
    expect(
      count("SELECT COUNT(*) AS n FROM rt_google_write_log WHERE store_id = 's1' AND before_text IS NULL"),
    ).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_posts WHERE id = 'mine-s1'")).toBe(1);
    expect(
      count(
        `SELECT COUNT(*) AS n FROM rt_google_posts
          WHERE id = 'mine-s1' AND google_state IS NULL AND search_url IS NULL
            AND google_create_time IS NULL AND google_update_time IS NULL AND google_post_name IS NOT NULL`,
      ),
    ).toBe(1);

    // 別店舗のものには触らない。
    expect(count("SELECT COUNT(*) AS n FROM rt_google_reviews WHERE store_id = 's2'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_profiles WHERE store_id = 's2'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_posts WHERE store_id = 's2'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_metrics_daily WHERE store_id = 's2'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_location_candidates WHERE store_id = 's2'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM rt_google_oauth_states WHERE store_id = 's2'")).toBe(1);
    expect(
      count("SELECT COUNT(*) AS n FROM rt_google_write_log WHERE store_id = 's2' AND before_text IS NOT NULL"),
    ).toBe(1);
  });
});
