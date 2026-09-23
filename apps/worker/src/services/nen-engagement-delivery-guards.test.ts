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
    CREATE TABLE forms (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE form_accounts (
      form_id TEXT NOT NULL, line_account_id TEXT NOT NULL,
      PRIMARY KEY (form_id, line_account_id)
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
    // 口コミ依頼は既定で「回答者を除く」がONだがフォーム未選択なので設定不足。
    // 重複防止の検証対象は到着確認と次の商品に絞る。
    for (const key of ['arrival_check', 'review_request', 'cross_sell']) {
      const campaign = await getNenCampaign(db, key, 'account-1');
      await saveNenCampaignAccountSetting(db, 'account-1', {
        ...campaign!, exclude_form_respondents: 0,
      });
    }

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
    sqlite.prepare(`INSERT INTO forms (id, name) VALUES ('review-form', '口コミ')`).run();
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

describe('NEN-07 (#1078): つなぐ回答フォームが使えない稼働中配信', () => {
  async function linkFormToReview(formId: string | null) {
    const review = await getNenCampaign(db, 'review_request', 'account-1');
    await saveNenCampaignAccountSetting(db, 'account-1', {
      ...review!,
      after_actions: formId
        ? [{ kind: 'open_form', formId, formName: '口コミ', buttonLabel: '回答する' }]
        : [],
    });
  }

  test('フォームが消えた配信は送信jobを積まず、理由つきの対象外を履歴へ残す', async () => {
    await linkFormToReview('deleted-form');

    expect(await enqueuePostShippingFollowUps(
      db, shipped('shipment-1', '2026-09-01T09:00:00+09:00'), 'friend-1', 'account-1',
    )).toBe(2);

    const job = sqlite.prepare(
      `SELECT status, last_error FROM nen_delivery_jobs
        WHERE campaign_key = 'review_request' AND friend_id = 'friend-1'`,
    ).get() as { status: string; last_error: string } | undefined;
    expect(job).toEqual({ status: 'skipped', last_error: 'campaign_form_unavailable' });
  });

  test('公開されていないフォームでも同じく止める', async () => {
    sqlite.prepare(
      `INSERT INTO forms (id, name, is_active) VALUES ('stopped-form', '口コミ', 0)`,
    ).run();
    await linkFormToReview('stopped-form');

    expect(await enqueuePostShippingFollowUps(
      db, shipped('shipment-1', '2026-09-01T09:00:00+09:00'), 'friend-1', 'account-1',
    )).toBe(2);
    expect(sqlite.prepare(
      `SELECT status FROM nen_delivery_jobs WHERE campaign_key = 'review_request'`,
    ).get()).toEqual({ status: 'skipped' });
  });

  test('別アカウント専用のフォームでも同じく止める', async () => {
    sqlite.prepare(`INSERT INTO forms (id, name) VALUES ('other-form', '口コミ')`).run();
    sqlite.prepare(
      `INSERT INTO form_accounts (form_id, line_account_id) VALUES ('other-form', 'account-2')`,
    ).run();
    await linkFormToReview('other-form');

    expect(await enqueuePostShippingFollowUps(
      db, shipped('shipment-1', '2026-09-01T09:00:00+09:00'), 'friend-1', 'account-1',
    )).toBe(2);
    expect(sqlite.prepare(
      `SELECT status FROM nen_delivery_jobs WHERE campaign_key = 'review_request'`,
    ).get()).toEqual({ status: 'skipped' });
  });

  test('使えるフォームがつながっていれば従来どおり予約する', async () => {
    sqlite.prepare(`INSERT INTO forms (id, name) VALUES ('ok-form', '口コミ')`).run();
    sqlite.prepare(
      `INSERT INTO form_accounts (form_id, line_account_id) VALUES ('ok-form', 'account-1')`,
    ).run();
    await linkFormToReview('ok-form');

    expect(await enqueuePostShippingFollowUps(
      db, shipped('shipment-1', '2026-09-01T09:00:00+09:00'), 'friend-1', 'account-1',
    )).toBe(3);
    expect(sqlite.prepare(
      `SELECT status FROM nen_delivery_jobs WHERE campaign_key = 'review_request'`,
    ).get()).toEqual({ status: 'pending' });
  });

  test('「回答者を除く」だけがONでフォームがない配信も止める(監査の実例)', async () => {
    // 検証環境で見つかった形: 口コミ除外だけがONでフォームもURLも無い。
    // 選んだはずの除外が黙って効かない設定不足なので job を積まない。
    const review = await getNenCampaign(db, 'review_request', 'account-1');
    await saveNenCampaignAccountSetting(db, 'account-1', {
      ...review!, exclude_form_respondents: 1, after_actions: [],
    });

    expect(await enqueuePostShippingFollowUps(
      db, shipped('shipment-1', '2026-09-01T09:00:00+09:00'), 'friend-1', 'account-1',
    )).toBe(2);
    expect(sqlite.prepare(
      `SELECT status, last_error FROM nen_delivery_jobs
        WHERE campaign_key = 'review_request' AND friend_id = 'friend-1'`,
    ).get()).toEqual({ status: 'skipped', last_error: 'campaign_form_unavailable' });
  });

  test('保存JSONに壊れたopen_formが残る配信も止める', async () => {
    // 旧仕様で保存された「open_formなのにformId空」の残骸。parseでは消えるが
    // 「開くつもりだった」こと自体は検出できる必要がある。
    const review = await getNenCampaign(db, 'review_request', 'account-1');
    sqlite.prepare(
      `INSERT INTO account_settings (id, line_account_id, key, value, created_at, updated_at)
       VALUES ('s1', 'account-1', 'nen.campaign.review_request', ?, '2026-09-01', '2026-09-01')`,
    ).run(JSON.stringify({
      ...review!,
      after_actions: [{ kind: 'open_form', formId: '', formName: '', buttonLabel: '' }],
      updated_at: '2026-09-01',
    }));
    expect((await getNenCampaign(db, 'review_request', 'account-1'))?.form_action_dropped).toBe(1);

    expect(await enqueuePostShippingFollowUps(
      db, shipped('shipment-1', '2026-09-01T09:00:00+09:00'), 'friend-1', 'account-1',
    )).toBe(2);
    expect(sqlite.prepare(
      `SELECT status, last_error FROM nen_delivery_jobs
        WHERE campaign_key = 'review_request' AND friend_id = 'friend-1'`,
    ).get()).toEqual({ status: 'skipped', last_error: 'campaign_form_unavailable' });
  });

  test('既存の予約済みjobは設定不足でも勝手に変えない', async () => {
    sqlite.prepare(`INSERT INTO forms (id, name) VALUES ('ok-form', '口コミ')`).run();
    await linkFormToReview('ok-form');
    expect(await enqueuePostShippingFollowUps(
      db, shipped('shipment-1', '2026-09-01T09:00:00+09:00'), 'friend-1', 'account-1',
    )).toBe(3);

    // 予約後にフォームが消えても、積み済みのpendingは送る側の判断に残す。
    // 新しいイベントは重複防止の窓内なら記録自体を作らない(従来どおり)。
    sqlite.prepare(`DELETE FROM forms WHERE id = 'ok-form'`).run();
    expect(await enqueuePostShippingFollowUps(
      db, shipped('shipment-2', '2026-09-02T09:00:00+09:00'), 'friend-1', 'account-1',
    )).toBe(0);
    expect(sqlite.prepare(
      `SELECT status FROM nen_delivery_jobs
        WHERE campaign_key = 'review_request' AND source_key = 'shipment-1'`,
    ).get()).toEqual({ status: 'pending' });
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count FROM nen_delivery_jobs
        WHERE campaign_key = 'review_request' AND source_key = 'shipment-2'`,
    ).get()).toEqual({ count: 0 });
  });
});
