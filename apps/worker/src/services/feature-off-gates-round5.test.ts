/*
 * #643 再差戻し(5回目)の実行試験。本物の SQLite に当てて確かめる。
 *
 * 1. 上限(LIMIT)を機能オフの行が埋め尽くしても、後ろに並ぶ動作中
 *    アカウントの行が処理されること(恒久的な待ちぼうけを作らない)。
 *    判定を LIMIT のあとに置くと、オフの行は状態が動かないので毎回
 *    同じ順で先頭に居座り、ON のテナントが永久に回らなくなる。
 * 2. 取り出しの前に走る「停滞回収」の UPDATE が、機能オフ中の
 *    アカウントの行に一切当たらないこと。OFF 中は status も
 *    付随する時刻列も動かさず、再オンでそのまま回収されること。
 */
import { describe, expect, it, vi } from 'vitest';
import { FEATURE_IDS } from '@line-crm/shared';
import {
  processPendingAnalyticsCrossRuns,
  processPendingAnalyticsUrlExposures,
  processPendingMileageEvents,
  recoverStuckDeliveries,
  saveVersionedAccountSetting,
} from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { processPendingCalendarDeleteOperations } from './booking-calendar-sync.js';
import { processStepDeliveries } from './step-delivery.js';

const BUNDLE_KEY = 'feature.settings_bundle_v1';

async function disableFeature(db: SqliteD1, accountId: string, feature: string) {
  const features = Object.fromEntries(FEATURE_IDS.map((key) => [key, true]));
  features[feature] = false;
  const result = await saveVersionedAccountSetting(db.db, {
    accountId,
    key: BUNDLE_KEY,
    expectedVersion: 0,
    data: { features },
  });
  expect(result.status).toBe('saved');
}

async function enableFeature(db: SqliteD1, accountId: string) {
  await db.db
    .prepare('DELETE FROM account_settings WHERE line_account_id = ? AND key = ?')
    .bind(accountId, BUNDLE_KEY)
    .run();
}

function seedAccounts(db: SqliteD1) {
  db.raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-off', 'ch-off', 'OFF店', 'tok', 'sec'),
           ('account-on', 'ch-on', 'ON店', 'tok', 'sec');
  `);
}

/** オフのアカウントの行を上限より多く、ONの行をその後ろに置く。 */
const OVER_LIMIT = 5;

describe('LIMIT前のオフ判定: オフの行が上限を超えても後続ONが止まらない', () => {
  it('予約カレンダー削除の再試行', async () => {
    const testDb = createTestD1();
    try {
      seedAccounts(testDb);
      const rows: string[] = [];
      for (let i = 0; i < OVER_LIMIT; i++) {
        rows.push(`('bk-off-${i}', 'account-off', 'fr-1', 'st-1', 'mn-1',
          '2026-09-20T01:00:00.000Z', '2026-09-20T02:00:00.000Z', '2026-09-20T02:00:00.000Z',
          'cancelled', 1000, '2026-09-01T00:00:00.000Z', 'gcal-off-${i}')`);
      }
      rows.push(`('bk-on', 'account-on', 'fr-2', 'st-2', 'mn-2',
        '2026-09-20T01:00:00.000Z', '2026-09-20T02:00:00.000Z', '2026-09-20T02:00:00.000Z',
        'cancelled', 1000, '2026-09-01T00:00:00.000Z', 'gcal-on')`);
      const ops: string[] = [];
      for (let i = 0; i < OVER_LIMIT; i++) {
        // オフ側を先に(updated_at が古い順で先頭に来る)並べる。
        ops.push(`('op-off-${i}', 'bk-off-${i}', 'account-off', 'google_calendar', 'retry_wait', NULL,
          '{"direction":"delete"}', 'bk-off-${i}:google-calendar:delete',
          '2026-09-01T00:00:0${i}.000', '2026-09-01T00:00:0${i}.000')`);
      }
      ops.push(`('op-on', 'bk-on', 'account-on', 'google_calendar', 'retry_wait', NULL,
        '{"direction":"delete"}', 'bk-on:google-calendar:delete',
        '2026-09-02T00:00:00.000', '2026-09-02T00:00:00.000')`);
      testDb.raw.exec(`
        INSERT INTO bookings
          (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at, block_ends_at,
           status, price_at_booking, requested_at, external_event_id)
        VALUES ${rows.join(',\n')};
        INSERT INTO booking_operation_runs
          (id, booking_id, line_account_id, kind, status, opened_at, result_json,
           idempotency_key, created_at, updated_at)
        VALUES ${ops.join(',\n')};
      `);
      await disableFeature(testDb, 'account-off', 'booking');

      const remove = vi.fn(async (_bookingId: string, _lineAccountId: string) => {});
      // 上限をオフの行数と同じにする。判定が LIMIT のあとなら ON は 0 件になる。
      const result = await processPendingCalendarDeleteOperations(testDb.db, {
        now: new Date('2026-09-09T00:00:00.000Z'),
        limit: OVER_LIMIT,
        remove,
      });

      expect(remove.mock.calls.map(([bookingId]) => bookingId)).toEqual(['bk-on']);
      expect(result).toEqual({ processed: 1, succeeded: 1, retrying: 0, skipped: 0 });
      // オフ側は1行も動いていない。
      const offRows = testDb.raw
        .prepare(
          `SELECT status, opened_at FROM booking_operation_runs WHERE line_account_id = 'account-off'`,
        )
        .all() as Array<{ status: string; opened_at: string | null }>;
      expect(offRows).toHaveLength(OVER_LIMIT);
      expect(offRows.every((row) => row.status === 'retry_wait' && row.opened_at === null)).toBe(true);
      // 止めた事実は監査に残る。
      const audits = testDb.raw
        .prepare(
          `SELECT line_account_id FROM audit_events WHERE action = 'feature.execution.skipped'`,
        )
        .all() as Array<{ line_account_id: string }>;
      expect(audits).toEqual([{ line_account_id: 'account-off' }]);
    } finally {
      testDb.raw.close();
    }
  });

  it('分析クロス集計の取り出し(上限2件)', async () => {
    const testDb = createTestD1();
    try {
      seedAccounts(testDb);
      const crossRun = (id: string, accountId: string, createdAt: string) =>
        `('${id}', '${accountId}', '{}', 'pending', '2026-08-01', '2026-08-31',
          'Asia/Tokyo', '2026-09-01T00:00:00+09:00', '${createdAt}')`;
      const runs: string[] = [];
      for (let i = 0; i < OVER_LIMIT; i++) {
        runs.push(crossRun(`run-off-${i}`, 'account-off', `2026-09-01T00:00:0${i}+09:00`));
      }
      runs.push(crossRun('run-on', 'account-on', '2026-09-02T00:00:00+09:00'));
      testDb.raw.exec(`
        INSERT INTO analytics_cross_runs
          (id, line_account_id, query_json, state, period_from, period_to,
           time_zone, data_cutoff_at, created_at)
        VALUES ${runs.join(',\n')};
      `);
      await disableFeature(testDb, 'account-off', 'analytics');

      // 上限は既定の2件。オフの5件が先頭を占めても ON の1件へ届く。
      await processPendingAnalyticsCrossRuns(testDb.db);

      const offStates = testDb.raw
        .prepare(`SELECT state FROM analytics_cross_runs WHERE line_account_id = 'account-off'`)
        .all() as Array<{ state: string }>;
      expect(offStates.every((row) => row.state === 'pending')).toBe(true);
      const onState = testDb.raw
        .prepare(`SELECT state FROM analytics_cross_runs WHERE id = 'run-on'`)
        .get() as { state: string };
      // ON 側は取り出されて先へ進む(pending のままではない)。
      expect(onState.state).not.toBe('pending');
    } finally {
      testDb.raw.close();
    }
  });

  it('URL計測キューの取り出し', async () => {
    const testDb = createTestD1();
    try {
      seedAccounts(testDb);
      const queued: string[] = [];
      for (let i = 0; i < OVER_LIMIT; i++) {
        queued.push(`('msg-off-${i}', 'account-off', 'pending', 0,
          '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:0${i}.000Z', '2026-09-01T00:00:00.000Z')`);
      }
      queued.push(`('msg-on', 'account-on', 'pending', 0,
        '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`);
      testDb.raw.exec(`
        INSERT INTO analytics_url_exposure_queue
          (message_id, line_account_id, status, attempts, available_at, created_at, updated_at)
        VALUES ${queued.join(',\n')};
      `);
      await disableFeature(testDb, 'account-off', 'analytics');

      const result = await processPendingAnalyticsUrlExposures(testDb.db, {
        limit: OVER_LIMIT,
        now: '2026-09-09T00:00:00.000Z',
      });

      expect(result.claimed).toBe(1);
      const offRows = testDb.raw
        .prepare(
          `SELECT status, attempts FROM analytics_url_exposure_queue WHERE line_account_id = 'account-off'`,
        )
        .all() as Array<{ status: string; attempts: number }>;
      expect(offRows.every((row) => row.status === 'pending' && row.attempts === 0)).toBe(true);
    } finally {
      testDb.raw.close();
    }
  });

  it('シナリオ配信の取り出し', async () => {
    const testDb = createTestD1();
    try {
      seedAccounts(testDb);
      const enrollments: string[] = [];
      for (let i = 0; i < OVER_LIMIT; i++) {
        enrollments.push(`('fs-off-${i}', 'fr-off-${i}', 's-off', 'active', '2020-01-01T00:00:0${i}+09:00')`);
      }
      enrollments.push(`('fs-on', 'fr-on', 's-on', 'active', '2020-01-02T00:00:00+09:00')`);
      testDb.raw.exec(`
        INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
        VALUES ('s-off', 'オフ', 'manual', 1, 'account-off'),
               ('s-on', 'オン', 'manual', 1, 'account-on');
        INSERT INTO friend_scenarios (id, friend_id, scenario_id, status, next_delivery_at)
        VALUES ${enrollments.join(',\n')};
      `);
      await disableFeature(testDb, 'account-off', 'scenarios');

      const due = await testDb.db
        .prepare(
          `SELECT fs.id FROM friend_scenarios fs
             INNER JOIN scenarios s ON fs.scenario_id = s.id
            WHERE fs.status = 'active' AND s.is_active = 1
            ORDER BY fs.next_delivery_at ASC, fs.id ASC LIMIT ?`,
        )
        .bind(OVER_LIMIT)
        .all<{ id: string }>();
      // 素の取り出しでは上限がオフの行で埋まる(この試験の前提)。
      expect(due.results.map((row) => row.id)).not.toContain('fs-on');

      const { getFriendScenariosDueForDelivery } = await import('@line-crm/db');
      const gated = await getFriendScenariosDueForDelivery(
        testDb.db,
        '2026-09-09T00:00:00.000+09:00',
        OVER_LIMIT,
      );
      expect(gated.map((row) => row.id)).toEqual(['fs-on']);
    } finally {
      testDb.raw.close();
    }
  });
});

describe('事前の停滞回収はアカウント単位で止める', () => {
  it('シナリオ配信: オフ中は delivering のまま、再オンで回収する', async () => {
    const testDb = createTestD1();
    try {
      seedAccounts(testDb);
      testDb.raw.exec(`
        INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
        VALUES ('s-off', 'オフ', 'manual', 1, 'account-off'),
               ('s-on', 'オン', 'manual', 1, 'account-on');
        INSERT INTO friend_scenarios (id, friend_id, scenario_id, status, next_delivery_at, updated_at)
        VALUES ('fs-off', 'fr-off', 's-off', 'delivering', '2020-01-01T00:00:00+09:00', '2020-01-01T00:00:00+09:00'),
               ('fs-on', 'fr-on', 's-on', 'delivering', '2020-01-01T00:00:00+09:00', '2020-01-01T00:00:00+09:00');
      `);
      await disableFeature(testDb, 'account-off', 'scenarios');

      const recovered = await recoverStuckDeliveries(testDb.db);
      expect(recovered).toBe(1);
      const state = (id: string) => testDb.raw
        .prepare('SELECT status, updated_at FROM friend_scenarios WHERE id = ?')
        .get(id) as { status: string; updated_at: string };
      // オフ側は status も updated_at も動かない。
      expect(state('fs-off')).toEqual({
        status: 'delivering',
        updated_at: '2020-01-01T00:00:00+09:00',
      });
      expect(state('fs-on').status).toBe('active');

      // 再オンでそのまま回収される。
      await enableFeature(testDb, 'account-off');
      expect(await recoverStuckDeliveries(testDb.db)).toBe(1);
      expect(state('fs-off').status).toBe('active');
    } finally {
      testDb.raw.close();
    }
  });

  it('シナリオ配信の入口でもオフのアカウントの停滞行は動かない', async () => {
    const testDb = createTestD1();
    try {
      seedAccounts(testDb);
      testDb.raw.exec(`
        INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
        VALUES ('s-off', 'オフ', 'manual', 1, 'account-off');
        INSERT INTO friend_scenarios (id, friend_id, scenario_id, status, next_delivery_at, updated_at)
        VALUES ('fs-off', 'fr-off', 's-off', 'delivering', '2020-01-01T00:00:00+09:00', '2020-01-01T00:00:00+09:00');
      `);
      await disableFeature(testDb, 'account-off', 'scenarios');

      await processStepDeliveries(testDb.db, {} as never);

      expect(
        testDb.raw
          .prepare('SELECT status, updated_at FROM friend_scenarios WHERE id = ?')
          .get('fs-off'),
      ).toEqual({ status: 'delivering', updated_at: '2020-01-01T00:00:00+09:00' });
    } finally {
      testDb.raw.close();
    }
  });

  it('マイル付与キュー: オフ中は processing のまま、再オンで回収する', async () => {
    const testDb = createTestD1();
    try {
      seedAccounts(testDb);
      testDb.raw.exec(`
        INSERT INTO friends (id, line_user_id, display_name, is_following, line_account_id,
          created_at, updated_at)
        VALUES ('fr-off', 'U-off', 'F', 1, 'account-off', '2026-01-01', '2026-01-01'),
               ('fr-on', 'U-on', 'F', 1, 'account-on', '2026-01-01', '2026-01-01');
        INSERT INTO mileage_programs (id, code, name, status, created_at, updated_at)
        VALUES ('prog', 'default', 'P', 'active', '2026-01-01', '2026-01-01');
        INSERT INTO engagement_events
          (id, program_id, idempotency_key, event_type, source, source_event_id,
           actor_friend_id, occurred_at, created_at)
        VALUES ('ev-off', 'prog', 'k-off', 'purchase_completed', 'test', 'src-off',
                'fr-off', '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00'),
               ('ev-on', 'prog', 'k-on', 'purchase_completed', 'test', 'src-on',
                'fr-on', '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00');
        INSERT INTO mileage_event_queue
          (engagement_event_id, status, attempts, processing_started_at, available_at, created_at, updated_at)
        VALUES ('ev-off', 'processing', 1, '2026-09-01T00:00:00+09:00',
                '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00'),
               ('ev-on', 'processing', 1, '2026-09-01T00:00:00+09:00',
                '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00');
      `);
      await disableFeature(testDb, 'account-off', 'mileage');

      const queue = (id: string) => testDb.raw
        .prepare(
          'SELECT status, processing_started_at, updated_at FROM mileage_event_queue WHERE engagement_event_id = ?',
        )
        .get(id) as { status: string; processing_started_at: string | null; updated_at: string };

      await processPendingMileageEvents(testDb.db, { now: '2026-09-08T00:00:00+09:00' });

      // オフ側は回収の UPDATE に当たらない。
      expect(queue('ev-off')).toEqual({
        status: 'processing',
        processing_started_at: '2026-09-01T00:00:00+09:00',
        updated_at: '2026-09-01T00:00:00+09:00',
      });
      // ON 側は回収されて先へ進む。
      expect(queue('ev-on').status).not.toBe('processing');

      // 再オンで同じ行がそのまま回収される。
      await enableFeature(testDb, 'account-off');
      await processPendingMileageEvents(testDb.db, { now: '2026-09-08T00:01:00+09:00' });
      expect(queue('ev-off').status).not.toBe('processing');
    } finally {
      testDb.raw.close();
    }
  });

  it('URL計測キュー: オフ中は processing のまま、再オンで回収する', async () => {
    const testDb = createTestD1();
    try {
      seedAccounts(testDb);
      testDb.raw.exec(`
        INSERT INTO analytics_url_exposure_queue
          (message_id, line_account_id, status, attempts, processing_started_at,
           available_at, created_at, updated_at)
        VALUES ('msg-off', 'account-off', 'processing', 1, '2026-09-01T00:00:00.000Z',
                '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
               ('msg-on', 'account-on', 'processing', 1, '2026-09-01T00:00:00.000Z',
                '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
      `);
      await disableFeature(testDb, 'account-off', 'analytics');

      const row = (id: string) => testDb.raw
        .prepare(
          'SELECT status, processing_started_at, updated_at FROM analytics_url_exposure_queue WHERE message_id = ?',
        )
        .get(id) as { status: string; processing_started_at: string | null; updated_at: string };

      await processPendingAnalyticsUrlExposures(testDb.db, { now: '2026-09-08T00:00:00.000Z' });

      expect(row('msg-off')).toEqual({
        status: 'processing',
        processing_started_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
      });
      expect(row('msg-on').status).not.toBe('processing');

      await enableFeature(testDb, 'account-off');
      await processPendingAnalyticsUrlExposures(testDb.db, { now: '2026-09-08T00:01:00.000Z' });
      expect(row('msg-off').status).not.toBe('processing');
    } finally {
      testDb.raw.close();
    }
  });
});
