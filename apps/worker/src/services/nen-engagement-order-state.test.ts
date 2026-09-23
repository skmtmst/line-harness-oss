import { describe, expect, test } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import {
  cancelPendingOrderFollowUps,
  enqueuePostShippingFollowUps,
  processNenDeliveries,
} from './nen-engagement.js';

/*
 * IDEA-21: 購入後の案内は注文の現在状態に合わせる。
 * - 発送後に予約された案内は、注文が取り消し・返金になったら送らない
 *   （送信直前の再検証 + イベント受信時の前倒し停止の二段構え）。
 * - 注文が有効なまま、またはEC台帳に行が無い（取り消しを確認できない）
 *   ときは止めない。推定ではなく確定した注文状態だけで止める。
 */

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
    // NEN-07: 既定の review_request は「回答者を除く」ONだがフォーム未選択の
    // ため設定不足=jobを積まない。注文状態の検証とは無関係なので、アカウント別
    // 設定で除外を外した通常状態にしておく。
    raw.prepare(`INSERT INTO account_settings
      (id, line_account_id, key, value, created_at, updated_at)
      VALUES (?, 'acc-1', ?, ?, '2026-09-01', '2026-09-01')`)
      .run(`setting-${key}`, `nen.campaign.${key}`, JSON.stringify({
        campaign_key: key, label, category: 'follow_up', trigger_event: 'ec.order.shipped',
        delay_days: delay, delivery_time: '10:00', is_enabled: 1,
        title: label, body_text: '本文', button_label: null, button_url: null, image_url: null,
        dedup_window_days: 30, exclude_form_respondents: 0, after_actions: [],
        updated_at: '2026-09-01',
      }));
  }
}

const shipped = (eventId: string, orderNumber: string) => ({
  event_id: eventId,
  event_type: 'ec.order.shipped',
  occurred_at: '2026-08-01T09:00:00+09:00',
  line_user_id: 'U1',
  order: { number: orderNumber },
  shipping: { shipped_at: '2026-08-01T09:00:00+09:00' },
});

function insertOrder(raw: SqliteD1['raw'], orderNumber: string, status: 'current' | 'cancelled' | 'refunded') {
  raw.prepare(`INSERT INTO ec_orders
    (id, line_account_id, source_key, external_order_id, order_number,
     normalized_status, provider_status, ordered_at, last_event_id, created_at, updated_at)
    VALUES (?, 'acc-1', 'eccube', ?, ?, ?, 'shipped', '2026-08-01', 'evt-1', '2026-08-01', '2026-08-01')`)
    .run(`order-${orderNumber}`, orderNumber, orderNumber, status);
}

function jobRows(raw: SqliteD1['raw'], sourceKey?: string) {
  const sql = `SELECT campaign_key, source_key, status, last_error FROM nen_delivery_jobs
    ${sourceKey ? `WHERE source_key = '${sourceKey}'` : ''} ORDER BY campaign_key ASC`;
  return raw.prepare(sql).all() as unknown as Array<{
    campaign_key: string; source_key: string; status: string; last_error: string | null;
  }>;
}

function stubDispatch(calls: { count: number }) {
  return async () => {
    calls.count++;
    return new Response('{}', { status: 200 });
  };
}

const options = (calls: { count: number }) => ({
  proxyBaseUrl: 'https://proxy.invalid', defaultAccessToken: 'x', proxyDispatch: stubDispatch(calls) as never,
});

describe('IDEA-21 注文の取り消し・返金と発送後の案内', () => {
  test('注文が取り消されると送信直前の再検証で全フォローアップを送らない', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    await enqueuePostShippingFollowUps(db, shipped('evt-ship-1', 'NEN-100') as never, 'friend-1', 'acc-1');
    insertOrder(raw, 'NEN-100', 'cancelled');
    const calls = { count: 0 };
    const result = await processNenDeliveries(db, options(calls));
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 3 });
    expect(calls.count).toBe(0);
    expect(jobRows(raw).map((row) => `${row.status}:${row.last_error}`)).toEqual([
      'skipped:order_cancelled', 'skipped:order_cancelled', 'skipped:order_cancelled',
    ]);
  });

  test('注文が返金になると order_refunded で送らない', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    await enqueuePostShippingFollowUps(db, shipped('evt-ship-1', 'NEN-101') as never, 'friend-1', 'acc-1');
    insertOrder(raw, 'NEN-101', 'refunded');
    const calls = { count: 0 };
    const result = await processNenDeliveries(db, options(calls));
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 3 });
    expect(calls.count).toBe(0);
    expect(jobRows(raw).every((row) => row.last_error === 'order_refunded')).toBe(true);
  });

  test('注文が有効なままなら従来どおり送る', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    await enqueuePostShippingFollowUps(db, shipped('evt-ship-1', 'NEN-102') as never, 'friend-1', 'acc-1');
    insertOrder(raw, 'NEN-102', 'current');
    const calls = { count: 0 };
    const result = await processNenDeliveries(db, options(calls));
    expect(result.sent).toBe(3);
    expect(calls.count).toBe(3);
  });

  test('EC台帳に行が無い注文は取り消しを確認できないので止めない', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    await enqueuePostShippingFollowUps(db, shipped('evt-ship-1', 'NEN-103') as never, 'friend-1', 'acc-1');
    const calls = { count: 0 };
    const result = await processNenDeliveries(db, options(calls));
    expect(result.sent).toBe(3);
    expect(calls.count).toBe(3);
  });

  test('cancelPendingOrderFollowUps はその注文の pending だけを倒す', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    await enqueuePostShippingFollowUps(db, shipped('evt-ship-1', 'NEN-200') as never, 'friend-1', 'acc-1');
    await enqueuePostShippingFollowUps(db, shipped('evt-ship-2', 'NEN-201') as never, 'friend-1', 'acc-1');
    const stopped = await cancelPendingOrderFollowUps(db, {
      lineAccountId: 'acc-1', orderNumber: 'NEN-200', reason: 'order_cancelled',
    });
    expect(stopped).toBe(3);
    expect(jobRows(raw, 'evt-ship-1').every(
      (row) => row.status === 'skipped' && row.last_error === 'order_cancelled',
    )).toBe(true);
    expect(jobRows(raw, 'evt-ship-2').every((row) => row.status === 'pending')).toBe(true);
  });

  test('cancelPendingOrderFollowUps は別アカウントや他状態の行を触らない', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('acc-2', 'ch-2', '支店', 'tok2', 'sec2')`).run();
    raw.prepare(`INSERT INTO friends (id, line_user_id, line_account_id, is_following)
      VALUES ('friend-2', 'U2', 'acc-2', 1)`).run();
    // NEN-07: acc-2 の既定 review_request も除外ON・フォーム未選択=設定不足に
    // なるので、別アカウントを触らないことの検証対象は除外を外した通常状態にする。
    raw.prepare(`INSERT INTO account_settings
      (id, line_account_id, key, value, created_at, updated_at)
      VALUES ('setting-acc2-review', 'acc-2', 'nen.campaign.review_request', ?, '2026-09-01', '2026-09-01')`)
      .run(JSON.stringify({
        campaign_key: 'review_request', label: '口コミ依頼', category: 'follow_up',
        trigger_event: 'ec.order.shipped', delay_days: 10, delivery_time: '10:00',
        is_enabled: 1, title: '口コミ依頼', body_text: '本文',
        button_label: null, button_url: null, image_url: null,
        dedup_window_days: 30, exclude_form_respondents: 0, after_actions: [],
        updated_at: '2026-09-01',
      }));
    await enqueuePostShippingFollowUps(db, shipped('evt-ship-1', 'NEN-300') as never, 'friend-1', 'acc-1');
    await enqueuePostShippingFollowUps(db, shipped('evt-ship-2', 'NEN-300') as never, 'friend-2', 'acc-2');
    // acc-1 側の1件を sent にしておく（送り済みは巻き戻さない）。
    raw.prepare(`UPDATE nen_delivery_jobs SET status = 'sent' WHERE source_key = 'evt-ship-1' AND campaign_key = 'arrival_check'`).run();
    const stopped = await cancelPendingOrderFollowUps(db, {
      lineAccountId: 'acc-1', orderNumber: 'NEN-300', reason: 'order_refunded',
    });
    expect(stopped).toBe(2);
    const acc1 = jobRows(raw, 'evt-ship-1');
    expect(acc1.filter((row) => row.status === 'skipped').length).toBe(2);
    expect(acc1.find((row) => row.campaign_key === 'arrival_check')?.status).toBe('sent');
    // 同じ注文番号でも別アカウントの予約は触らない。
    expect(jobRows(raw, 'evt-ship-2').every((row) => row.status === 'pending')).toBe(true);
  });
});
