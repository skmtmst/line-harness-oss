import { Hono } from 'hono';
import { getLineAccountById, jstNow } from '@line-crm/db';
import { addDays, resolveShipDate, toJstMoment } from '@line-crm/shared';
import { LineClient } from '@line-crm/line-sdk';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { logOutgoingMessage } from '../services/event-bus.js';
import { EC_EVENT_TYPES, ecTextMessage, type EcEvent } from './ec-integrations.js';

const ecCommerce = new Hono<Env>();
const EVENT_TYPE_SET = new Set<string>(EC_EVENT_TYPES);
const STATUS_SET = new Set(['received', 'processing', 'processed', 'skipped', 'failed']);

const EVENT_LABELS: Record<string, string> = {
  'ec.order.confirmed': '注文完了',
  'ec.order.shipped': '発送完了',
  'ec.subscription.upcoming': '次回定期便',
  'ec.subscription.payment_failed': '定期便の決済失敗',
  'ec.subscription.cancelled': '定期便の解約',
  'ec.customer.profile_updated': 'ペット情報更新',
};

const FIXED_FIELDS: Record<string, string[]> = {
  'ec.order.confirmed': ['注文番号', '商品名・数量', '合計金額', 'お届け予定', '注文詳細URL'],
  'ec.order.shipped': ['注文番号', '商品名・数量', '配送会社', '送り状番号', '配送確認URL'],
  'ec.subscription.upcoming': ['次回確定日', '変更期限', '商品名・数量', '予定金額', '定期便管理URL'],
  'ec.subscription.payment_failed': ['決済失敗の案内', '支払い方法確認の案内', '定期便管理URL'],
  'ec.subscription.cancelled': ['解約受付の案内', '定期便番号'],
};

function testEvent(eventType: string): EcEvent {
  const base: EcEvent = {
    event_id: `test-${crypto.randomUUID()}`,
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    line_user_id: 'U00000000000000000000000000000000',
    order: {
      number: 'NEN-TEST-001',
      total: 2860,
      items: [{ name: '鹿肉ミンチ', quantity: 2 }],
      delivery_date: '2026年8月15日',
      delivery_time: '18:00〜20:00',
      detail_url: 'https://stg.nen-petfood.com/mypage',
    },
    shipping: {
      carrier: 'ヤマト運輸',
      tracking_number: '1234-5678-9012',
      tracking_url: 'https://stg.nen-petfood.com/mypage',
    },
    subscription: {
      id: 'NEN-SUB-TEST',
      next_order_date: '2026年9月1日',
      change_deadline: '2026年8月28日',
      manage_url: 'https://stg.nen-petfood.com/mypage',
    },
  };
  return base;
}

ecCommerce.get('/api/ec-commerce/overview', async (c) => {
  const summary = await c.env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) AS processed,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
       SUM(CASE WHEN datetime(received_at) >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS last_24h,
       MAX(received_at) AS last_received_at
     FROM ec_events`,
  ).first<{
    total: number; processed: number; failed: number; skipped: number;
    last_24h: number; last_received_at: string | null;
  }>();
  const types = await c.env.DB.prepare(
    `SELECT event_type, COUNT(*) AS count FROM ec_events GROUP BY event_type ORDER BY count DESC`,
  ).all<{ event_type: string; count: number }>();

  return c.json({
    success: true,
    data: {
      total: summary?.total ?? 0,
      processed: summary?.processed ?? 0,
      failed: summary?.failed ?? 0,
      skipped: summary?.skipped ?? 0,
      last24h: summary?.last_24h ?? 0,
      lastReceivedAt: summary?.last_received_at ?? null,
      byType: types.results.map((row) => ({
        eventType: row.event_type,
        label: EVENT_LABELS[row.event_type] || row.event_type,
        count: row.count,
      })),
    },
  });
});

ecCommerce.get('/api/ec-commerce/events', requireRole('owner', 'admin', 'staff'), async (c) => {
  const requestedLimit = Number(c.req.query('limit') || '30');
  const requestedOffset = Number(c.req.query('offset') || '0');
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 30;
  const offset = Number.isInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0;
  const eventType = c.req.query('eventType') || '';
  const status = c.req.query('status') || '';
  if (eventType && !EVENT_TYPE_SET.has(eventType)) return c.json({ success: false, error: 'Invalid eventType' }, 400);
  if (status && !STATUS_SET.has(status)) return c.json({ success: false, error: 'Invalid status' }, 400);

  const clauses: string[] = [];
  const bindings: Array<string | number> = [];
  if (eventType) { clauses.push('e.event_type = ?'); bindings.push(eventType); }
  if (status) { clauses.push('e.status = ?'); bindings.push(status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const query = c.env.DB.prepare(
    `SELECT e.id, e.external_event_id, e.event_type, e.customer_id, e.friend_id,
            e.status, e.error_message, e.received_at, e.processed_at,
            json_extract(e.payload, '$.order.number') AS order_number,
            f.display_name AS friend_name
       FROM ec_events e
       LEFT JOIN friends f ON f.id = e.friend_id
       ${where}
      ORDER BY e.received_at DESC
      LIMIT ? OFFSET ?`,
  ).bind(...bindings, limit, offset);
  const [rows, countRow] = await Promise.all([
    query.all<{
      id: string; external_event_id: string; event_type: string; customer_id: string | null;
      friend_id: string | null; status: string; error_message: string | null;
      received_at: string; processed_at: string | null; order_number: string | null;
      friend_name: string | null;
    }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM ec_events e ${where}`).bind(...bindings).first<{ count: number }>(),
  ]);

  return c.json({
    success: true,
    data: rows.results.map((row) => ({
      id: row.id,
      externalEventId: row.external_event_id,
      eventType: row.event_type,
      eventLabel: EVENT_LABELS[row.event_type] || row.event_type,
      customerId: row.customer_id,
      friendId: row.friend_id,
      friendName: row.friend_name,
      orderNumber: row.order_number,
      status: row.status,
      errorMessage: row.error_message,
      receivedAt: row.received_at,
      processedAt: row.processed_at,
    })),
    pagination: { total: countRow?.count ?? 0, limit, offset },
  });
});

ecCommerce.get('/api/ec-commerce/settings', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT event_type, is_enabled, title_override, intro_text, outro_text, updated_at
       FROM ec_notification_settings ORDER BY rowid`,
  ).all<{
    event_type: string; is_enabled: number; title_override: string | null;
    intro_text: string | null; outro_text: string | null; updated_at: string;
  }>();
  return c.json({
    success: true,
    data: rows.results.map((row) => {
      const fixedMessage = ecTextMessage(testEvent(row.event_type), { title: '__FIXED__' });
      const fixedPreview = fixedMessage.type === 'text'
        ? fixedMessage.text.replace(/^__FIXED__\n\n?/, '')
        : '';
      return {
        eventType: row.event_type,
        label: EVENT_LABELS[row.event_type] || row.event_type,
        isEnabled: row.is_enabled === 1,
        title: row.title_override,
        introText: row.intro_text || '',
        outroText: row.outro_text || '',
        fixedFields: FIXED_FIELDS[row.event_type] || [],
        fixedPreview,
        updatedAt: row.updated_at,
      };
    }),
  });
});

ecCommerce.put('/api/ec-commerce/settings/:eventType', requireRole('owner', 'admin'), async (c) => {
  const eventType = c.req.param('eventType');
  if (!EVENT_TYPE_SET.has(eventType)) return c.json({ success: false, error: 'Invalid eventType' }, 400);
  const body = await c.req.json<{
    isEnabled?: unknown; title?: unknown; introText?: unknown; outroText?: unknown;
  }>().catch(() => null);
  if (!body || typeof body.isEnabled !== 'boolean' || typeof body.title !== 'string'
      || typeof body.introText !== 'string' || typeof body.outroText !== 'string') {
    return c.json({ success: false, error: 'isEnabled, title, introText and outroText are required' }, 400);
  }
  const title = body.title.trim();
  if (!title || title.length > 80) return c.json({ success: false, error: 'Title must be 1-80 characters' }, 400);
  const introText = body.introText.trim();
  const outroText = body.outroText.trim();
  if (introText.length > 800 || outroText.length > 800) {
    return c.json({ success: false, error: 'Editable copy must be 800 characters or fewer' }, 400);
  }
  const now = jstNow();
  await c.env.DB.prepare(
    `INSERT INTO ec_notification_settings
       (event_type, is_enabled, title_override, intro_text, outro_text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_type) DO UPDATE SET is_enabled = excluded.is_enabled,
       title_override = excluded.title_override, intro_text = excluded.intro_text,
       outro_text = excluded.outro_text, updated_at = excluded.updated_at`,
  ).bind(eventType, body.isEnabled ? 1 : 0, title, introText, outroText, now, now).run();
  return c.json({ success: true });
});

ecCommerce.post('/api/ec-commerce/test-send', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{
    eventType?: unknown; accountId?: unknown; title?: unknown; introText?: unknown; outroText?: unknown;
  }>().catch(() => null);
  if (!body || typeof body.eventType !== 'string' || !EVENT_TYPE_SET.has(body.eventType)) {
    return c.json({ success: false, error: 'Invalid eventType' }, 400);
  }
  if (typeof body.accountId !== 'string' || !body.accountId) {
    return c.json({ success: false, error: 'accountId is required' }, 400);
  }
  if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 80
      || typeof body.introText !== 'string' || body.introText.trim().length > 800
      || typeof body.outroText !== 'string' || body.outroText.trim().length > 800) {
    return c.json({ success: false, error: 'Invalid notification copy' }, 400);
  }
  const account = await getLineAccountById(c.env.DB, body.accountId);
  if (!account?.channel_access_token) return c.json({ success: false, error: 'LINE account is not configured' }, 400);

  const recipientSetting = await c.env.DB.prepare(
    `SELECT value FROM account_settings WHERE line_account_id = ? AND key = 'test_recipients'`,
  ).bind(body.accountId).first<{ value: string }>();
  let friendIds: string[] = [];
  try {
    const parsed = recipientSetting ? JSON.parse(recipientSetting.value) : [];
    if (Array.isArray(parsed)) friendIds = parsed.filter((value): value is string => typeof value === 'string').slice(0, 20);
  } catch {
    friendIds = [];
  }
  if (!friendIds.length) return c.json({ success: false, error: 'Test recipients are not configured' }, 400);

  const placeholders = friendIds.map(() => '?').join(',');
  const friends = await c.env.DB.prepare(
    `SELECT id, line_user_id FROM friends WHERE line_account_id = ? AND is_following = 1 AND id IN (${placeholders})`,
  ).bind(body.accountId, ...friendIds).all<{ id: string; line_user_id: string }>();
  if (!friends.results.length) return c.json({ success: false, error: 'No active test recipients' }, 400);

  const message = ecTextMessage(testEvent(body.eventType), {
    title: body.title.trim(),
    introText: body.introText.trim(),
    outroText: body.outroText.trim(),
    test: true,
  });
  const client = new LineClient(account.channel_access_token);
  let sent = 0;
  for (const friend of friends.results) {
    await client.pushMessage(friend.line_user_id, [message]);
    await logOutgoingMessage(c.env.DB, {
      friendId: friend.id,
      messageType: message.type,
      content: message.type === 'text' ? message.text : JSON.stringify(message),
      deliveryType: 'push',
      source: 'ec_test',
      lineAccountId: account.id,
    });
    sent += 1;
  }
  return c.json({ success: true, data: { sent } });
});

// ---------------------------------------------------------------------------
// 出荷予定
//
// ec_events.payload には商品・数量・定期便の発送予定日が入っているのに、
// これまで取り出していたのは注文番号だけだった。ダッシュボードで
// 「いつ何を出すのか」を見せるために、payload から必要な値を取り出す。
//
// 出荷予定日そのものは payload に無い（通常注文が持つのはお届け希望日）。
// 業務ルールに沿った算出は @line-crm/shared の shipping-schedule に閉じてあり、
// ここでは呼ぶだけ。将来ロジックを差し替えるときも、この箇所は変わらない。
// 算出結果はDBに保存せず、都度計算する。

/** 出荷予定として扱うイベント。発送済み・解約などは対象外。 */
const SHIPMENT_EVENT_TYPES = ['ec.order.confirmed', 'ec.subscription.upcoming'] as const;

type ShipmentRow = {
  id: string;
  event_type: string;
  friend_id: string | null;
  friend_name: string | null;
  received_at: string;
  order_number: string | null;
  occurred_at: string | null;
  scheduled_shipping_date: string | null;
  order_items: string | null;
  subscription_items: string | null;
};

/** payload の items 配列（JSON文字列）を「商品名 × 数量」の一行にする。 */
function summarizeItems(raw: string | null): { text: string; count: number } {
  if (!raw) return { text: '', count: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { text: '', count: 0 };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { text: '', count: 0 };
  const items = parsed
    .filter((item): item is { name?: unknown; quantity?: unknown } => typeof item === 'object' && item !== null)
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name.slice(0, 80) : '',
      quantity: typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : null,
    }))
    .filter((item) => item.name);
  if (items.length === 0) return { text: '', count: 0 };
  const head = items.slice(0, 2).map((item) => (item.quantity === null ? item.name : `${item.name} × ${item.quantity}`));
  const text = items.length > head.length ? `${head.join('、')} ほか${items.length - head.length}点` : head.join('、');
  return { text, count: items.length };
}

ecCommerce.get('/api/ec-commerce/shipments', requireRole('owner', 'admin', 'staff'), async (c) => {
  const requestedLimit = Number(c.req.query('limit') || '20');
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 20;

  // 出荷予定日は計算値なのでSQLでは並べ替えられない。直近のイベントを多めに
  // 取り出してから、算出した日付で並べ替えて limit で切る。
  const scanLimit = Math.min(limit * 5, 200);
  const placeholders = SHIPMENT_EVENT_TYPES.map(() => '?').join(', ');
  const rows = await c.env.DB.prepare(
    `SELECT e.id, e.event_type, e.friend_id, e.received_at,
            f.display_name AS friend_name,
            json_extract(e.payload, '$.order.number') AS order_number,
            json_extract(e.payload, '$.occurred_at') AS occurred_at,
            json_extract(e.payload, '$.subscription.scheduled_shipping_date') AS scheduled_shipping_date,
            json_extract(e.payload, '$.order.items') AS order_items,
            json_extract(e.payload, '$.subscription.items') AS subscription_items
       FROM ec_events e
       LEFT JOIN friends f ON f.id = e.friend_id
      WHERE e.event_type IN (${placeholders})
        AND e.status != 'failed'
      ORDER BY e.received_at DESC
      LIMIT ?`,
  )
    .bind(...SHIPMENT_EVENT_TYPES, scanLimit)
    .all<ShipmentRow>();

  const todayJst = toJstMoment(new Date().toISOString())?.date ?? '';
  const tomorrowJst = todayJst ? addDays(todayJst, 1) : '';

  const shipments = rows.results
    .map((row) => {
      const { date, source } = resolveShipDate({
        scheduledShippingDate: row.scheduled_shipping_date,
        // occurred_at が欠けている払い出しもありうるので、受信時刻で代替する。
        orderedAt: row.occurred_at || row.received_at,
      });
      // 型定義上は定期便の商品は subscription.items。実データで order が
      // 入っている可能性があるため、型どおりを優先しつつ order へ落とす。
      const items = summarizeItems(row.subscription_items) ;
      const fallback = items.count > 0 ? items : summarizeItems(row.order_items);
      return {
        id: row.id,
        eventType: row.event_type,
        eventLabel: EVENT_LABELS[row.event_type] || row.event_type,
        orderNumber: row.order_number,
        friendId: row.friend_id,
        friendName: row.friend_name,
        items: fallback.text,
        itemCount: fallback.count,
        shipDate: date,
        shipDateSource: source,
        // 今日・明日とそれ以降で分けるための印。日付の比較は文字列で足りる。
        bucket: date && todayJst && date <= tomorrowJst ? ('soon' as const) : ('later' as const),
      };
    })
    .filter((row) => row.shipDate !== null)
    .sort((a, b) => (a.shipDate ?? '').localeCompare(b.shipDate ?? ''));

  const soon = shipments.filter((row) => row.bucket === 'soon');
  const later = shipments.filter((row) => row.bucket === 'later');

  return c.json({
    success: true,
    data: {
      today: todayJst,
      tomorrow: tomorrowJst,
      soon: soon.slice(0, limit),
      later: later.slice(0, limit),
      soonCount: soon.length,
      laterCount: later.length,
      // 走査した件数を返す。上限に張り付いていたら取りこぼしがありうる。
      scanned: rows.results.length,
      scanLimit,
    },
  });
});

export { ecCommerce };
