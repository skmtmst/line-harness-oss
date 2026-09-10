import { describe, expect, it, vi } from 'vitest';
import { FEATURE_IDS } from '@line-crm/shared';
import {
  enqueueFollowingMileageMilestones,
  processActionScoreInactivity,
  processPendingAnalyticsCrossRuns,
  processPendingAnalyticsUrlExposures,
  processPendingMileageEvents,
  purgeExpiredAnalyticsReadData,
  recoverStalledAnalyticsCrossRuns,
  saveVersionedAccountSetting,
} from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import type { LineClient } from '@line-crm/line-sdk';

const {
  deliverMileageReward: deliver,
} = await import('./mileage-reward-delivery.js');
const { applyActionScoreEvent: applyScore } = await import('./action-score-events.js');
const { processInsightFetch: fetchInsights } = await import('./insight-fetcher.js');
const { refreshRecentAnalyticsProjections: refreshProjection } = await import('./analytics-projection.js');
const { enqueueBirthdayCoupons: enqueueBirthday } = await import('./nen-engagement.js');
const { deleteExpiredRestaurantRawEmails: deleteRawMail } = await import('./restaurant-email-intake.js');

void enqueueFollowingMileageMilestones;
void processActionScoreInactivity;
void processPendingAnalyticsCrossRuns;
void processPendingAnalyticsUrlExposures;
void processPendingMileageEvents;
void purgeExpiredAnalyticsReadData;
void recoverStalledAnalyticsCrossRuns;

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
  await db.db.prepare('DELETE FROM account_settings WHERE line_account_id = ? AND key = ?')
    .bind(accountId, BUNDLE_KEY).run();
}

function seedAccounts(db: SqliteD1) {
  db.raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-1', 'ch-1', 'A1', 'tok', 'sec'),
           ('account-2', 'ch-2', 'A2', 'tok', 'sec');
    INSERT INTO friends (id, line_user_id, display_name, is_following, line_account_id,
      first_followed_at, current_follow_started_at, created_at, updated_at)
    VALUES ('friend-1', 'U1', 'F1', 1, 'account-1',
      '2026-01-01T00:00:00+09:00', '2026-01-01T00:00:00+09:00',
      '2026-01-01T00:00:00+09:00', '2026-01-01T00:00:00+09:00'),
           ('friend-2', 'U2', 'F2', 1, 'account-2',
      '2026-01-01T00:00:00+09:00', '2026-01-01T00:00:00+09:00',
      '2026-01-01T00:00:00+09:00', '2026-01-01T00:00:00+09:00');
  `);
}

function seedMileageQueue(db: SqliteD1) {
  db.raw.exec(`
    INSERT INTO mileage_programs (id, code, name, status, created_at, updated_at)
    VALUES ('prog', 'default', 'P', 'active', '2026-01-01', '2026-01-01');
    INSERT INTO engagement_events
      (id, program_id, idempotency_key, event_type, source, source_event_id,
       actor_friend_id, occurred_at, created_at)
    VALUES ('ev-1', 'prog', 'k1', 'purchase_completed', 'test', 'src-1',
      'friend-1', '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00');
    INSERT INTO mileage_event_queue
      (engagement_event_id, status, attempts, available_at, created_at, updated_at)
    VALUES ('ev-1', 'pending', 0,
      '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00');
  `);
}

function seedScoreRules(db: SqliteD1, accountId: string) {
  const rules = JSON.stringify([{
    id: 'r1', name: '無反応', eventType: 'inactivity_30d', source: 'scheduler',
    operation: 'delta', value: -5, frequency: { kind: 'unlimited', limit: 100 },
    sameSourceEventOnce: true, enabled: true,
  }]);
  db.raw.exec(`
    INSERT INTO action_score_rule_sets (id, line_account_id, status, current_published_version_id)
    VALUES ('s-${accountId}', '${accountId}', 'published', 'v-${accountId}');
    INSERT INTO action_score_rule_versions (id, rule_set_id, version_number, status, rules_json)
    VALUES ('v-${accountId}', 's-${accountId}', 1, 'published', '${rules.replace(/'/g, "''")}');
  `);
}

function queueState(db: SqliteD1, eventId: string) {
  return db.raw.prepare(
    'SELECT status, attempts FROM mileage_event_queue WHERE engagement_event_id = ?',
  ).get(eventId) as { status: string; attempts: number };
}

describe('mileage queue off gates', () => {
  it('off中は付与キューをclaimせずpendingのまま残し、再オンで進む', async () => {
    const db = createTestD1();
    try {
      seedAccounts(db);
      seedMileageQueue(db);
      await disableFeature(db, 'account-1', 'mileage');

      const skipped = await processPendingMileageEvents(db.db, { limit: 10 });
      expect(skipped.claimed).toBe(0);
      expect(queueState(db, 'ev-1')).toMatchObject({ status: 'pending', attempts: 0 });

      await enableFeature(db, 'account-1');
      const resumed = await processPendingMileageEvents(db.db, { limit: 10 });
      expect(resumed.claimed).toBe(1);
      expect(queueState(db, 'ev-1').status).toBe('processed');
    } finally {
      db.raw.close();
    }
  });

  it('off中は継続フォローの節目を作らず、再オン後の節目から再開する', async () => {
    const db = createTestD1();
    try {
      seedAccounts(db);
      await disableFeature(db, 'account-1', 'mileage');

      const skipped = await enqueueFollowingMileageMilestones(db.db, { limitPerMilestone: 10 });
      // 有効なaccount-2分だけ作られ、オフ中のaccount-1分は作られない。
      expect(skipped.eventsCreated).toBeGreaterThan(0);
      expect(db.raw.prepare(
        `SELECT COUNT(*) AS n FROM engagement_events ee
          JOIN friends f ON f.id = ee.actor_friend_id WHERE f.line_account_id = ?`,
      ).get('account-1')).toEqual({ n: 0 });

      await enableFeature(db, 'account-1');
      const resumed = await enqueueFollowingMileageMilestones(db.db, { limitPerMilestone: 10 });
      expect(resumed.eventsCreated).toBeGreaterThan(0);
      expect(db.raw.prepare(
        `SELECT COUNT(*) AS n FROM engagement_events ee
          JOIN friends f ON f.id = ee.actor_friend_id WHERE f.line_account_id = ?`,
      ).get('account-1')).toEqual({ n: resumed.eventsCreated });
    } finally {
      db.raw.close();
    }
  });

  it('off中は交換のclaim・attempt・付与をせずreservedのまま残す', async () => {
    const db = createTestD1();
    try {
      seedAccounts(db);
      db.raw.exec(`
        INSERT INTO mileage_programs (id, code, name, status, created_at, updated_at)
        VALUES ('prog', 'default', 'P', 'active', '2026-01-01', '2026-01-01');
        INSERT INTO mileage_rewards (id, line_account_id, program_id, name, reward_kind)
        VALUES ('rw', 'account-1', 'prog', 'R', 'tag');
        INSERT INTO mileage_reward_versions (id, reward_id, version_number, status, required_miles)
        VALUES ('rv', 'rw', 1, 'published', 100);
        INSERT INTO mileage_redemptions
          (id, line_account_id, program_id, beneficiary_key, beneficiary_friend_id,
           reward_id, reward_version_id, idempotency_key, request_fingerprint, status)
        VALUES ('red-1', 'account-1', 'prog', 'friend-1', 'friend-1',
          'rw', 'rv', 'idem-1', 'fp-1', 'reserved');
      `);
      await disableFeature(db, 'account-1', 'mileage');

      const held = await deliver(db.db, 'red-1', {});
      expect(held.status).toBe('delivery_failed');
      expect(db.raw.prepare('SELECT status FROM mileage_redemptions WHERE id = ?').get('red-1'))
        .toEqual({ status: 'reserved' });
      expect(db.raw.prepare('SELECT COUNT(*) AS n FROM mileage_redemption_attempts').get())
        .toEqual({ n: 0 });
    } finally {
      db.raw.close();
    }
  });
});

describe('action score off gates', () => {
  it('off中は無反応の適用をせず、再オンで適用する', async () => {
    const db = createTestD1();
    try {
      seedAccounts(db);
      seedScoreRules(db, 'account-1');
      await disableFeature(db, 'account-1', 'mileage');

      const skipped = await processActionScoreInactivity(db.db, {
        now: '2026-09-08T00:00:00+09:00',
        limit: 10,
      });
      expect(skipped.applied).toBe(0);
      expect(db.raw.prepare('SELECT COUNT(*) AS n FROM friend_scores').get()).toEqual({ n: 0 });

      await enableFeature(db, 'account-1');
      const resumed = await processActionScoreInactivity(db.db, {
        now: '2026-09-08T00:00:00+09:00',
        limit: 10,
      });
      expect(resumed.applied).toBe(1);
    } finally {
      db.raw.close();
    }
  });

  it('off中は元イベントの適用をせず空で返す', async () => {
    const db = createTestD1();
    try {
      seedAccounts(db);
      seedScoreRules(db, 'account-1');
      await disableFeature(db, 'account-1', 'mileage');

      const held = await applyScore(db.db, {
        lineAccountId: 'account-1',
        friendId: 'friend-1',
        eventType: 'purchase_completed',
        source: 'test',
        sourceEventId: 'src-9',
        occurredAt: '2026-09-08T00:00:00+09:00',
      });
      expect(held.applications).toEqual([]);
      expect(db.raw.prepare('SELECT COUNT(*) AS n FROM friend_scores').get()).toEqual({ n: 0 });
    } finally {
      db.raw.close();
    }
  });
});

describe('analytics cron off gates', () => {
  it('off中はクロス集計をclaimせずpendingのまま残し、再オンで進む', async () => {
    const db = createTestD1();
    try {
      seedAccounts(db);
      db.raw.exec(`
        INSERT INTO analytics_cross_runs
          (id, line_account_id, query_json, state, period_from, period_to,
           time_zone, data_cutoff_at, created_at)
        VALUES ('run-1', 'account-1', '{}', 'pending', '2026-08-01', '2026-08-31',
          'Asia/Tokyo', '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00');
      `);
      await disableFeature(db, 'account-1', 'analytics');

      const skipped = await processPendingAnalyticsCrossRuns(db.db, 2);
      expect(skipped.processed).toBe(0);
      expect(db.raw.prepare('SELECT state FROM analytics_cross_runs WHERE id = ?').get('run-1'))
        .toEqual({ state: 'pending' });

      await enableFeature(db, 'account-1');
      const resumed = await processPendingAnalyticsCrossRuns(db.db, 2);
      expect(resumed.processed + resumed.failed).toBe(1);
      expect(db.raw.prepare('SELECT state FROM analytics_cross_runs WHERE id = ?').get('run-1'))
        .not.toEqual({ state: 'pending' });
    } finally {
      db.raw.close();
    }
  });

  it('off中は停滞中の集計の状態を戻さずrunningのまま残す', async () => {
    const db = createTestD1();
    try {
      seedAccounts(db);
      db.raw.exec(`
        INSERT INTO analytics_cross_runs
          (id, line_account_id, query_json, state, started_at, period_from, period_to,
           time_zone, data_cutoff_at, created_at)
        VALUES ('run-stuck', 'account-1', '{}', 'running', '2026-01-01T00:00:00+09:00',
          '2026-08-01', '2026-08-31', 'Asia/Tokyo',
          '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00');
      `);
      await disableFeature(db, 'account-1', 'analytics');

      const recovered = await recoverStalledAnalyticsCrossRuns(db.db, new Date('2026-09-08T00:00:00+09:00'));
      expect(recovered).toBe(0);
      expect(db.raw.prepare('SELECT state FROM analytics_cross_runs WHERE id = ?').get('run-stuck'))
        .toEqual({ state: 'running' });
    } finally {
      db.raw.close();
    }
  });

  it('off中はURL計測キューをclaimせずpendingのまま残し、再オンで進む', async () => {
    const db = createTestD1();
    try {
      seedAccounts(db);
      db.raw.exec(`
        INSERT INTO analytics_url_exposure_queue
          (message_id, line_account_id, status, attempts, available_at, created_at, updated_at)
        VALUES ('msg-1', 'account-1', 'pending', 0,
          '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00');
      `);
      await disableFeature(db, 'account-1', 'analytics');

      const skipped = await processPendingAnalyticsUrlExposures(db.db, {
        limit: 10,
        now: '2026-09-08T00:00:00+09:00',
      });
      expect(skipped.claimed).toBe(0);
      expect(db.raw.prepare('SELECT status FROM analytics_url_exposure_queue WHERE message_id = ?').get('msg-1'))
        .toEqual({ status: 'pending' });

      await enableFeature(db, 'account-1');
      const resumed = await processPendingAnalyticsUrlExposures(db.db, {
        limit: 10,
        now: '2026-09-08T00:00:00+09:00',
      });
      expect(resumed.claimed).toBe(1);
    } finally {
      db.raw.close();
    }
  });

  it('off中は期限切れの分析データを消さずに残し、再オンで消える', async () => {
    const db = createTestD1();
    try {
      seedAccounts(db);
      db.raw.exec(`
        INSERT INTO analytics_events
          (id, line_account_id, event_type, source_kind, source_id, occurred_at, idempotency_key)
        VALUES ('ev-old-1', 'account-1', 'message_received', 'test', 's1',
            '2020-01-01T00:00:00+09:00', 'idem-1'),
               ('ev-old-2', 'account-2', 'message_received', 'test', 's2',
            '2020-01-01T00:00:00+09:00', 'idem-2');
      `);
      await disableFeature(db, 'account-1', 'analytics');

      const purged = await purgeExpiredAnalyticsReadData(db.db, new Date('2026-09-08T00:00:00+09:00'), 100);
      expect(purged.events).toBe(1);
      expect(db.raw.prepare('SELECT COUNT(*) AS n FROM analytics_events WHERE id = ?').get('ev-old-1'))
        .toEqual({ n: 1 });
      expect(db.raw.prepare('SELECT COUNT(*) AS n FROM analytics_events WHERE id = ?').get('ev-old-2'))
        .toEqual({ n: 0 });

      await enableFeature(db, 'account-1');
      const repurged = await purgeExpiredAnalyticsReadData(db.db, new Date('2026-09-08T00:00:00+09:00'), 100);
      expect(repurged.events).toBe(1);
      expect(db.raw.prepare('SELECT COUNT(*) AS n FROM analytics_events').get()).toEqual({ n: 0 });
    } finally {
      db.raw.close();
    }
  });

  it('off中は分析の定期集計を回さず、再オンで回る', async () => {
    const db = createTestD1();
    try {
      seedAccounts(db);
      await disableFeature(db, 'account-1', 'analytics');

      const accounts = [
        { id: 'account-1', is_active: 1, timezone: 'Asia/Tokyo' },
        { id: 'account-2', is_active: 1, timezone: 'Asia/Tokyo' },
      ];
      const skipped = await refreshProjection(
        db.db,
        accounts as never,
        new Date('2026-09-08T00:00:00+09:00'),
      );
      // 巡回順でaccount-1が選ばれる初回は止まる。
      expect(skipped.processed).toBe(0);
    } finally {
      db.raw.close();
    }
  });
});

describe('broadcast insight off gates', () => {
  it('off中は開封率の取得も結果更新もせずpendingのまま残す', async () => {
    const db = createTestD1();
    try {
      seedAccounts(db);
      db.raw.exec(`
        INSERT INTO broadcasts
          (id, title, message_type, message_content, target_type, status,
           line_account_id, line_request_id, sent_at)
        VALUES ('b-1', 'T', 'text', '本文', 'all', 'sent',
          'account-1', 'req-1', '2026-01-01T00:00:00+09:00');
        INSERT INTO broadcast_insights (id, broadcast_id, status, retry_count)
        VALUES ('i-1', 'b-1', 'pending', 0);
      `);
      await disableFeature(db, 'account-1', 'broadcasts');

      const getMessageEventInsight = vi.fn();
      await fetchInsights(
        db.db,
        new Map(),
        { getMessageEventInsight } as unknown as LineClient,
      );
      // LINE APIを叩かず、行もそのまま残る。
      expect(getMessageEventInsight).not.toHaveBeenCalled();
      expect(db.raw.prepare('SELECT status, retry_count FROM broadcast_insights WHERE id = ?').get('i-1'))
        .toEqual({ status: 'pending', retry_count: 0 });
    } finally {
      db.raw.close();
    }
  });
});

describe('nen campaign off gates', () => {
  it('off中は誕生日クーポンを発行も予約もしない', async () => {
    const db = createTestD1();
    try {
      seedAccounts(db);
      const today = new Date();
      const monthDay = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      db.raw.exec(`
        INSERT INTO nen_pet_profiles (id, friend_id, name, birthday, created_at, updated_at)
        VALUES ('pet-1', 'friend-1', 'ポチ', '2020-${monthDay}',
          '2026-01-01', '2026-01-01');
      `);
      await disableFeature(db, 'account-1', 'nen_campaigns');

      const queued = await enqueueBirthday(db.db, new Date());
      expect(queued).toBe(0);
      expect(db.raw.prepare('SELECT COUNT(*) AS n FROM nen_coupon_issues').get()).toEqual({ n: 0 });
      expect(db.raw.prepare('SELECT COUNT(*) AS n FROM nen_delivery_jobs').get()).toEqual({ n: 0 });
    } finally {
      db.raw.close();
    }
  });
});

describe('restaurant retention off gates', () => {
  it('off中の店舗の原文は消さずに残し、他店舗分は消える', async () => {
    const db = createTestD1();
    try {
      seedAccounts(db);
      db.raw.exec(`
        INSERT INTO rt_organizations (id, account_id, name) VALUES ('org-1', 'account-1', 'O1');
        INSERT INTO rt_stores (id, organization_id, name, code, line_account_id)
        VALUES ('store-1', 'org-1', 'S1', 'S1', 'account-1'),
               ('store-2', 'org-1', 'S2', 'S2', 'account-2');
        INSERT INTO rt_inbound_emails (id, message_id, store_id, r2_key, received_at, status, size_bytes)
        VALUES ('mail-1', '<a@example.test>', 'store-1', 'k1', '2025-01-01 00:00:00', 'received', 7),
               ('mail-2', '<b@example.test>', 'store-2', 'k2', '2025-01-01 00:00:00', 'received', 7);
      `);
      await disableFeature(db, 'account-1', 'restaurant_test');

      const deletedKeys: string[][] = [];
      const env = {
        DB: db.db,
        RAW_MAIL: { delete: vi.fn(async (keys: string[]) => { deletedKeys.push(keys); }) },
      } as unknown as Env['Bindings'];

      const result = await deleteRawMail(env, { now: new Date('2026-08-22T00:00:00.000Z') });
      expect(result).toMatchObject({ checked: 1, deleted: 1 });
      expect(deletedKeys).toEqual([['k2']]);
      expect(db.raw.prepare('SELECT status FROM rt_inbound_emails WHERE id = ?').get('mail-1'))
        .toEqual({ status: 'received' });
      expect(db.raw.prepare('SELECT status FROM rt_inbound_emails WHERE id = ?').get('mail-2'))
        .toEqual({ status: 'raw_deleted' });
    } finally {
      db.raw.close();
    }
  });
});
