import { describe, expect, test } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import {
  enqueuePostShippingFollowUps,
  getNenCampaign,
  hasEarlierWindowDelivery,
  processNenDeliveries,
  saveNenCampaignAccountSetting,
} from './nen-engagement.js';

// #749 案2: 送信直前の窓の見直し。積む側の抑止は変えず、claim 後に最新の
// アカウント別設定を正として代表1件だけ送る。実 SQLite＋実コードで見る。

function seed(raw: SqliteD1['raw']) {
  raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('acc-1', 'ch-1', '本店', 'tok', 'sec')`).run();
  raw.prepare(`INSERT INTO friends (id, line_user_id, line_account_id, is_following)
    VALUES ('friend-1', 'U1', 'acc-1', 1)`).run();
  const rows: Array<[string, string, number]> = [
    ['arrival_check', '到着確認', 5],
    ['review_request', '口コミ依頼', 10],
    ['cross_sell', '次の商品', 14],
  ];
  for (const [key, label, delay] of rows) {
    raw.prepare(`INSERT INTO nen_campaign_settings
      (campaign_key, label, category, trigger_event, delay_days, delivery_time,
       is_enabled, title, body_text, created_at, updated_at)
      VALUES (?, ?, 'follow_up', 'ec.order.shipped', ?, '10:00', 1, ?, '本文', '2026-09-01', '2026-09-01')`)
      .run(key, label, delay, label);
  }
}

const shipped = (eventId: string, occurredAt: string) => ({
  event_id: eventId, event_type: 'ec.order.shipped', occurred_at: occurredAt,
  line_user_id: 'U1', shipping: { shipped_at: occurredAt },
});

async function setDedup(db: D1Database, days: number) {
  for (const key of ['arrival_check', 'review_request', 'cross_sell']) {
    const current = await getNenCampaign(db, key, 'acc-1');
    await saveNenCampaignAccountSetting(db, 'acc-1', {
      ...current!, dedup_window_days: days, exclude_form_respondents: 0,
    });
  }
}

function stubDispatch(calls: { count: number }) {
  return async () => {
    calls.count++;
    return new Response('{}', { status: 200 });
  };
}

function reviewRows(raw: SqliteD1['raw'], status: string) {
  return raw.prepare(
    `SELECT id, source_key, status, last_error FROM nen_delivery_jobs
      WHERE campaign_key = 'review_request' AND status = ? ORDER BY scheduled_at ASC, id ASC`,
  ).all(status) as unknown as Array<{ id: string; source_key: string; status: string; last_error: string | null }>;
}

describe('#749 送信直前の窓の見直し', () => {
  test('予約後に0→30へ変えると代表1件だけ送り後続は新理由でskip', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    await setDedup(db, 0);
    await enqueuePostShippingFollowUps(db, shipped('order-1', '2026-08-01T09:00:00+09:00') as never, 'friend-1', 'acc-1');
    await enqueuePostShippingFollowUps(db, shipped('order-2', '2026-08-04T09:00:00+09:00') as never, 'friend-1', 'acc-1');
    await setDedup(db, 30);
    const calls = { count: 0 };
    const result = await processNenDeliveries(db, {
      proxyBaseUrl: 'https://proxy.invalid', defaultAccessToken: 'x', proxyDispatch: stubDispatch(calls) as never, now: new Date('2026-09-25T12:00:00+09:00'),
    });
    expect(result).toEqual({ sent: 3, failed: 0, skipped: 3, deferred: 0 });
    expect(calls.count).toBe(3);
    expect(reviewRows(raw, 'sent').map((row) => row.source_key)).toEqual(['order-1']);
    const skipped = reviewRows(raw, 'skipped');
    expect(skipped.map((row) => row.source_key)).toEqual(['order-2']);
    expect(skipped.map((row) => row.last_error)).toEqual(['frequency_suppressed']);
  });

  test('30→0へ変えると既存予約を不当に止めない', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    await setDedup(db, 30);
    await enqueuePostShippingFollowUps(db, shipped('order-1', '2026-08-01T09:00:00+09:00') as never, 'friend-1', 'acc-1');
    await setDedup(db, 0);
    const calls = { count: 0 };
    const result = await processNenDeliveries(db, {
      proxyBaseUrl: 'https://proxy.invalid', defaultAccessToken: 'x', proxyDispatch: stubDispatch(calls) as never, now: new Date('2026-09-25T12:00:00+09:00'),
    });
    expect(result).toEqual({ sent: 3, failed: 0, skipped: 0, deferred: 0 });
    expect(calls.count).toBe(3);
  });

  test('同時tickで2件ともpendingでも代表1件だけ送る', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    await setDedup(db, 30);
    const snapshot = JSON.stringify({
      campaign_key: 'review_request', label: '口コミ依頼', category: 'follow_up',
      trigger_event: 'ec.order.shipped', delay_days: 10, delivery_time: '10:00', is_enabled: 1,
      title: '口コミ依頼', body_text: '本文', button_label: null, button_url: null, image_url: null,
      dedup_window_days: 30, exclude_form_respondents: 0, after_actions: [],
      updated_at: '2026-09-01',
    });
    for (const [id, src, scheduled] of [
      ['job-early', 'order-1', '2020-01-01 00:00:00'],
      ['job-late', 'order-2', '2020-01-05 00:00:00'],
    ] as Array<[string, string, string]>) {
      raw.prepare(`INSERT INTO nen_delivery_jobs
        (id, campaign_key, friend_id, line_account_id, source_key, payload, campaign_snapshot,
         scheduled_at, status, attempts, retry_generation, version, created_at, updated_at)
        VALUES (?, 'review_request', 'friend-1', 'acc-1', ?, '{}', ?, ?,
         'pending', 0, 0, 1, '2020-01-01', '2020-01-01')`).run(id, src, snapshot, scheduled);
    }
    const calls = { count: 0 };
    const result = await processNenDeliveries(db, {
      proxyBaseUrl: 'https://proxy.invalid', defaultAccessToken: 'x', proxyDispatch: stubDispatch(calls) as never, now: new Date('2026-09-25T12:00:00+09:00'),
    });
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 1, deferred: 0 });
    expect(calls.count).toBe(1);
    expect(reviewRows(raw, 'sent').map((row) => row.id)).toEqual(['job-early']);
    expect(reviewRows(raw, 'skipped').map((row) => row.last_error)).toEqual(['frequency_suppressed']);
  });

  test('両方claim済みでも判定は相補的（両方send/両方skipにならない）', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    const snapshot = JSON.stringify({
      campaign_key: 'review_request', label: '口コミ依頼', category: 'follow_up',
      trigger_event: 'ec.order.shipped', delay_days: 10, delivery_time: '10:00', is_enabled: 1,
      title: '口コミ依頼', body_text: '本文', button_label: null, button_url: null, image_url: null,
      dedup_window_days: 30, exclude_form_respondents: 0, after_actions: [],
      updated_at: '2026-09-01',
    });
    for (const [id, src, scheduled] of [
      ['job-early', 'order-1', '2020-01-01 00:00:00'],
      ['job-late', 'order-2', '2020-01-05 00:00:00'],
    ] as Array<[string, string, string]>) {
      raw.prepare(`INSERT INTO nen_delivery_jobs
        (id, campaign_key, friend_id, line_account_id, source_key, payload, campaign_snapshot,
         scheduled_at, status, attempts, retry_generation, version, created_at, updated_at)
        VALUES (?, 'review_request', 'friend-1', 'acc-1', ?, '{}', ?, ?,
         'pending', 0, 0, 1, '2020-01-01', '2020-01-01')`).run(id, src, snapshot, scheduled);
    }
    // 2つの tick が1件ずつ取分した形。代表の判定は (scheduled_at, id) で決まる。
    raw.prepare(`UPDATE nen_delivery_jobs SET status = 'processing'`).run();
    const decideEarly = await hasEarlierWindowDelivery(db, {
      campaignKey: 'review_request', friendId: 'friend-1', jobId: 'job-early',
      scheduledAt: '2020-01-01 00:00:00', windowDays: 30,
    });
    const decideLate = await hasEarlierWindowDelivery(db, {
      campaignKey: 'review_request', friendId: 'friend-1', jobId: 'job-late',
      scheduledAt: '2020-01-05 00:00:00', windowDays: 30,
    });
    expect([decideEarly, decideLate].sort()).toEqual([false, true]);
  });

  test('自分自身を見て自己skipしない', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    await setDedup(db, 30);
    await enqueuePostShippingFollowUps(db, shipped('order-1', '2026-08-01T09:00:00+09:00') as never, 'friend-1', 'acc-1');
    const calls = { count: 0 };
    const result = await processNenDeliveries(db, {
      proxyBaseUrl: 'https://proxy.invalid', defaultAccessToken: 'x', proxyDispatch: stubDispatch(calls) as never, now: new Date('2026-09-25T12:00:00+09:00'),
    });
    expect(result).toEqual({ sent: 3, failed: 0, skipped: 0, deferred: 0 });
    expect(calls.count).toBe(3);
  });

  test('窓0・窓外・確定済み以外は代表判定に使わない', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    raw.prepare(`INSERT INTO nen_delivery_jobs
      (id, campaign_key, friend_id, line_account_id, source_key, payload, campaign_snapshot,
       scheduled_at, status, attempts, retry_generation, version, created_at, updated_at)
      VALUES ('job-skipped', 'review_request', 'friend-1', 'acc-1', 'order-0', '{}', NULL,
       '2020-01-01 00:00:00', 'skipped', 0, 0, 1, '2020-01-01', '2020-01-01')`).run();
    const base = {
      campaignKey: 'review_request', friendId: 'friend-1', jobId: 'job-new',
      scheduledAt: '2020-01-02 00:00:00',
    };
    await expect(hasEarlierWindowDelivery(db, { ...base, windowDays: 0 })).resolves.toBe(false);
    await expect(hasEarlierWindowDelivery(db, { ...base, windowDays: 30 })).resolves.toBe(false);
    await expect(hasEarlierWindowDelivery(db, {
      ...base, scheduledAt: '2020-03-15 00:00:00', windowDays: 30,
    })).resolves.toBe(false);
  });
});
