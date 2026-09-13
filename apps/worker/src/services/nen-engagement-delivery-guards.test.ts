import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  enqueuePostShippingFollowUps,
  getNenCampaign,
  saveNenCampaignAccountSetting,
} from './nen-engagement.js';

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      const bound = (params: unknown[]): D1PreparedStatement => ({
        bind: (...next: unknown[]) => bound(next),
        all: async <T>() => ({ success: true, results: statement.all(...params) as T[], meta: {} }),
        first: async <T>() => (statement.get(...params) as T | undefined) ?? null,
        run: async <T>() => {
          const result = statement.run(...params);
          return { success: true, results: [], meta: { changes: result.changes } } as T;
        },
        raw: async () => [],
      } as unknown as D1PreparedStatement);
      return bound([]);
    },
  } as unknown as D1Database;
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE nen_campaign_settings (
      campaign_key TEXT PRIMARY KEY, label TEXT NOT NULL, category TEXT NOT NULL,
      trigger_event TEXT, delay_days INTEGER NOT NULL, delivery_time TEXT NOT NULL,
      is_enabled INTEGER NOT NULL, title TEXT NOT NULL, body_text TEXT NOT NULL,
      button_label TEXT, button_url TEXT, image_url TEXT, updated_at TEXT
    );
    CREATE TABLE account_settings (
      id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL, key TEXT NOT NULL,
      value TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (line_account_id, key)
    );
    CREATE TABLE nen_delivery_jobs (
      id TEXT PRIMARY KEY, campaign_key TEXT NOT NULL, friend_id TEXT NOT NULL,
      line_account_id TEXT, source_key TEXT NOT NULL, payload TEXT NOT NULL,
      campaign_snapshot TEXT, scheduled_at TEXT NOT NULL, status TEXT NOT NULL,
      attempts INTEGER NOT NULL, last_error TEXT, sent_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (campaign_key, friend_id, source_key)
    );
    CREATE TABLE form_submissions (
      id TEXT PRIMARY KEY, form_id TEXT NOT NULL, friend_id TEXT, data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO nen_campaign_settings
      (campaign_key, label, category, trigger_event, delay_days, delivery_time,
       is_enabled, title, body_text, updated_at)
    VALUES
      ('arrival_check', '到着確認', 'follow_up', 'ec.order.shipped', 5, '10:00', 1, '到着確認', '本文', '2026-09-01'),
      ('review_request', '口コミ依頼', 'follow_up', 'ec.order.shipped', 10, '10:00', 1, '口コミ依頼', '本文', '2026-09-01'),
      ('cross_sell', '次の商品', 'follow_up', 'ec.order.shipped', 14, '10:00', 1, '次の商品', '本文', '2026-09-01');
  `);
  db = asD1(sqlite);
});

afterEach(() => sqlite.close());

function shipped(eventId: string, occurredAt: string) {
  return {
    event_id: eventId,
    event_type: 'ec.order.shipped',
    occurred_at: occurredAt,
    line_user_id: 'U1',
    shipping: { shipped_at: occurredAt },
  };
}

describe('N-291 NEN配信の実動する除外条件', () => {
  test('既存設定にも30日間の重複防止を適用し、別注文から二重予約しない', async () => {
    expect((await getNenCampaign(db, 'arrival_check', 'account-1'))?.dedup_window_days).toBe(30);

    expect(await enqueuePostShippingFollowUps(
      db, shipped('shipment-1', '2026-09-01T09:00:00+09:00'), 'friend-1', 'account-1',
    )).toBe(3);
    expect(await enqueuePostShippingFollowUps(
      db, shipped('shipment-2', '2026-09-02T09:00:00+09:00'), 'friend-1', 'account-1',
    )).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM nen_delivery_jobs').get()).toEqual({ count: 3 });
  });

  test('重複防止を外して保存した配信は、別注文をそれぞれ予約する', async () => {
    for (const key of ['arrival_check', 'review_request', 'cross_sell']) {
      const campaign = await getNenCampaign(db, key, 'account-1');
      await saveNenCampaignAccountSetting(db, 'account-1', {
        ...campaign!, dedup_window_days: 0, exclude_form_respondents: 0,
      });
    }

    expect(await enqueuePostShippingFollowUps(
      db, shipped('shipment-1', '2026-09-01T09:00:00+09:00'), 'friend-1', 'account-1',
    )).toBe(3);
    expect(await enqueuePostShippingFollowUps(
      db, shipped('shipment-2', '2026-09-02T09:00:00+09:00'), 'friend-1', 'account-1',
    )).toBe(3);
  });

  test('つないだ口コミフォームへ回答済みなら口コミ依頼だけ予約しない', async () => {
    const review = await getNenCampaign(db, 'review_request', 'account-1');
    await saveNenCampaignAccountSetting(db, 'account-1', {
      ...review!,
      exclude_form_respondents: 1,
      after_actions: [{
        kind: 'open_form', formId: 'review-form', formName: '口コミ', buttonLabel: '回答する',
      }],
    });
    sqlite.prepare(
      `INSERT INTO form_submissions (id, form_id, friend_id, data, created_at)
       VALUES ('response-1', 'review-form', 'friend-1', '{}', '2026-08-20')`,
    ).run();

    expect(await enqueuePostShippingFollowUps(
      db, shipped('shipment-1', '2026-09-01T09:00:00+09:00'), 'friend-1', 'account-1',
    )).toBe(2);
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count FROM nen_delivery_jobs WHERE campaign_key = 'review_request'`,
    ).get()).toEqual({ count: 0 });
  });
});
