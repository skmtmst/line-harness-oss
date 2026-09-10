import { describe, expect, it, vi } from 'vitest';
import { FEATURE_IDS } from '@line-crm/shared';
import { saveVersionedAccountSetting } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const { processScheduledBroadcasts } = await import('./broadcast.js');
const { processStepDeliveries } = await import('./step-delivery.js');
const { processDueReminders } = await import('./booking-reminders.js');
const { processAutomationRun } = await import('./automation-engine.js');
const { processNenDeliveries } = await import('./nen-engagement.js');
const { isCommonVarsEnabled } = await import('@line-crm/db');
const { accountFeatureIsEnabled } = await import('./feature-enforcement.js');

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

async function featureState(db: SqliteD1, table: string, id: string, column: string) {
  const row = await db.db.prepare(`SELECT ${column} FROM ${table} WHERE id = ?`).bind(id)
    .first<{ [key: string]: unknown }>();
  return row?.[column] ?? null;
}

describe('feature off job gates', () => {
  it('off中は予約配信をclaimせずscheduledのまま残す', async () => {
    const testDb = createTestD1();
    try {
      testDb.raw.exec(`
        INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id)
        VALUES ('b-1', '予約', 'text', '本文', 'all', 'scheduled', 'account-1');
      `);
      await disableFeature(testDb, 'account-1', 'broadcasts');
      await processScheduledBroadcasts(testDb.db, {} as never);
      expect(await featureState(testDb, 'broadcasts', 'b-1', 'status')).toBe('scheduled');
    } finally {
      testDb.raw.close();
    }
  });

  it('off中はシナリオ配信をclaimせずactiveのまま残す', async () => {
    const testDb = createTestD1();
    try {
      testDb.raw.exec(`
        INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
        VALUES ('s-1', '公開', 'manual', 1, 'account-1');
        INSERT INTO friend_scenarios (id, friend_id, scenario_id, status, next_delivery_at)
        VALUES ('fs-1', 'f-1', 's-1', 'active', '2020-01-01T00:00:00+09:00');
      `);
      await disableFeature(testDb, 'account-1', 'scenarios');
      await processStepDeliveries(testDb.db, {} as never);
      expect(await featureState(testDb, 'friend_scenarios', 'fs-1', 'status')).toBe('active');
    } finally {
      testDb.raw.close();
    }
  });

  it('off中は予約リマインドを送らずpendingのまま残す', async () => {
    const testDb = createTestD1();
    try {
      testDb.raw.exec(`
        INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
        VALUES ('account-1', 'ch-1', '店舗', 'tok', 'sec');
        INSERT INTO friends (id, line_user_id, line_account_id) VALUES ('f-1', 'U-1', 'account-1');
        INSERT INTO menus (id, line_account_id, name, duration_minutes, base_price) VALUES ('m-1', 'account-1', '相談', 60, 8000);
        INSERT INTO staff (id, line_account_id, name, display_name) VALUES ('st-1', 'account-1', '担当', '担当');
        INSERT INTO bookings (id, line_account_id, friend_id, menu_id, staff_id, status, starts_at, ends_at, block_ends_at, price_at_booking, requested_at)
        VALUES ('b-1', 'account-1', 'f-1', 'm-1', 'st-1', 'confirmed', '2099-01-01T10:00:00+09:00', '2099-01-01T11:00:00+09:00', '2099-01-01T11:00:00+09:00', 8000, '2026-09-01T00:00:00+09:00');
        INSERT INTO booking_reminders (id, booking_id, kind, status, scheduled_at, retry_count)
        VALUES ('r-1', 'b-1', 'day_before', 'pending', '2020-01-01T00:00:00+09:00', 0);
      `);
      await disableFeature(testDb, 'account-1', 'booking');
      const sender = vi.fn().mockResolvedValue(undefined);
      await processDueReminders(testDb.db, {
        now: new Date('2026-09-08T00:00:00+09:00'),
        sender,
        reminderHoursBefore: 24,
      });
      expect(sender).not.toHaveBeenCalled();
      expect(await featureState(testDb, 'booking_reminders', 'r-1', 'status')).toBe('pending');
    } finally {
      testDb.raw.close();
    }
  });

  it('off中は自動処理を取り込まずqueuedのまま残す', async () => {
    const testDb = createTestD1();
    try {
      testDb.raw.exec(`
        INSERT INTO automation_runs (id, line_account_id, automation_id, automation_version_id, source_event_id, idempotency_key, status)
        VALUES ('run-1', 'account-1', 'a-1', 'v-1', 'e-1', 'k-1', 'queued');
      `);
      await disableFeature(testDb, 'account-1', 'automations');
      const status = await processAutomationRun(testDb.db, 'run-1', {});
      expect(status).toBe('busy');
      expect(await featureState(testDb, 'automation_runs', 'run-1', 'status')).toBe('queued');
    } finally {
      testDb.raw.close();
    }
  });

  it('off中はNEN配信をclaimせずpendingのまま残す', async () => {
    const testDb = createTestD1();
    try {
      testDb.raw.exec(`
        INSERT INTO nen_delivery_jobs
          (id, campaign_key, friend_id, line_account_id, source_key, payload, scheduled_at, status, attempts, created_at, updated_at)
        VALUES ('j-1', 'c-1', 'f-1', 'account-1', 's-1', '{}', '2020-01-01T00:00:00+09:00', 'pending', 0,
          '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00');
      `);
      await disableFeature(testDb, 'account-1', 'nen_campaigns');
      const result = await processNenDeliveries(testDb.db, {
        now: new Date('2026-09-08T00:00:00+09:00'),
      } as never);
      expect(result.sent).toBe(0);
      expect(await featureState(testDb, 'nen_delivery_jobs', 'j-1', 'status')).toBe('pending');
    } finally {
      testDb.raw.close();
    }
  });

  it('db層の共通情報判定はworkerの強制と同じ答えになる', async () => {
    const testDb = createTestD1();
    try {
      // 何もなければ有効。
      expect(await isCommonVarsEnabled(testDb.db, 'account-1')).toBe(true);
      expect(await accountFeatureIsEnabled(testDb.db, 'account-1', 'common_vars')).toBe(true);
      // 一括設定で切る。
      await disableFeature(testDb, 'account-1', 'common_vars');
      expect(await isCommonVarsEnabled(testDb.db, 'account-1')).toBe(false);
      expect(await accountFeatureIsEnabled(testDb.db, 'account-1', 'common_vars')).toBe(false);
      // 別アカウントには影響しない。
      expect(await isCommonVarsEnabled(testDb.db, 'account-2')).toBe(true);
    } finally {
      testDb.raw.close();
    }
  });
});
