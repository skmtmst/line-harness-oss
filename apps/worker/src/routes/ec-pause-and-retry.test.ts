import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { ecIntegrations } from './ec-integrations.js';
import { ecCommerce } from './ec-commerce.js';
import { processDueEcRetries } from '../services/ec-retry.js';

/*
 * EC の「止める」を本当に効かせ、落ちた受信は上限つきで回す。
 *
 * 取り込み停止中は、受信の保存までは済ませたうえで通知・タグなどの
 * 副作用を一切起こさない。再開したら止めていた分を待ち行列へ戻し、
 * 定期回収が上限つきで回す。上限を超えた失敗は dead letter へ倒す。
 */

const SECRET = 'b'.repeat(32);
const NOW_JST = '2026-09-20T10:00:00.000';

vi.mock('@line-crm/line-sdk', () => {
  const pushMessage = vi.fn().mockResolvedValue({ ok: true });
  const pushMessageWithRequestId = vi.fn().mockResolvedValue({ ok: true, requestId: 'req-1' });
  const replyMessageWithRequestId = vi.fn().mockResolvedValue({ ok: true });
  return {
    LineClient: vi.fn().mockImplementation(() => ({ pushMessage, pushMessageWithRequestId, replyMessageWithRequestId })),
    __pushMessage: pushMessageWithRequestId,
  };
});
vi.mock('../services/event-bus.js', () => ({
  fireEvent: vi.fn().mockResolvedValue(undefined),
  logOutgoingMessage: vi.fn().mockResolvedValue('outgoing-log-1'),
}));
vi.mock('../services/operator-notification-dispatch.js', () => ({
  dispatchOperatorEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/nen-tag-sync.js', () => ({
  syncNenEcTags: vi.fn().mockResolvedValue(undefined),
  syncNenPetTags: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/nen-engagement.js', () => ({
  cancelPendingOrderFollowUps: vi.fn().mockResolvedValue(undefined),
  enqueuePostShippingFollowUps: vi.fn().mockResolvedValue(undefined),
}));

async function signature(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

let db: SqliteD1;
beforeEach(() => {
  vi.clearAllMocks();
  db = createTestD1();
  db.raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', '本店', 'access-token-a', 'secret-a');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at)
    VALUES ('friend-1', 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '山田さん', 'account-a', 1, '${NOW_JST}', '${NOW_JST}');
    INSERT INTO ec_notification_settings
      (event_type, is_enabled, title_override, intro_text, outro_text, category, created_at, updated_at)
    VALUES ('ec.order.confirmed', 1, 'ご注文ありがとうございます', '本文', '結び', 'order', '${NOW_JST}', '${NOW_JST}');
    INSERT INTO ec_connectors (id, line_account_id, provider, shop_domain, status, version, created_at, updated_at)
    VALUES ('connector-1', 'account-a', 'ec_cube', 'shop.example.com', 'connected', 1, '${NOW_JST}', '${NOW_JST}');
  `);
});
afterEach(() => { db.raw.close(); });

function integrationsApp() {
  const instance = new Hono<Env>();
  instance.route('/', ecIntegrations);
  return instance;
}

function commerceApp() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-1', name: 'owner-1', role: 'owner', readOnly: false });
    await next();
  });
  instance.route('/', ecCommerce);
  return instance;
}

function orderEvent(eventId: string) {
  return {
    event_id: eventId,
    event_type: 'ec.order.confirmed',
    occurred_at: '2026-09-20T01:00:00.000Z',
    customer_id: 'C-1',
    line_user_id: 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    order: { number: 'ORD-1', total: 3000, items: [{ name: 'フード', quantity: 1, price: 3000 }] },
  };
}

async function postEvent(eventId: string) {
  const body = JSON.stringify(orderEvent(eventId));
  const timestamp = String(Math.floor(Date.now() / 1000));
  return integrationsApp().request('/api/integrations/eccube/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Line-Account-Id': 'account-a',
      'X-Nen-Timestamp': timestamp,
      'X-Nen-Signature': await signature(`${timestamp}.account-a.${body}`),
    },
    body,
  }, { DB: db.db, ECCUBE_WEBHOOK_SECRET: SECRET });
}

describe('ECの停止と再試行 (P1-23)', () => {
  it('停止中は受信を保存するが副作用を起こさない', async () => {
    db.raw.prepare(`UPDATE ec_connectors SET status = 'paused' WHERE id = 'connector-1'`).run();
    const res = await postEvent('evt-paused-1');
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ success: true, status: 'paused' });

    const event = db.raw.prepare(`SELECT status, error_message FROM ec_events WHERE external_event_id = 'evt-paused-1'`).get() as {
      status: string; error_message: string | null;
    };
    expect(event.status).toBe('skipped');
    expect(event.error_message).toBe('connector_paused');
    const execution = db.raw.prepare(
      `SELECT status, error_code, attempt_count FROM ec_action_executions WHERE event_id = (SELECT id FROM ec_events WHERE external_event_id = 'evt-paused-1')`,
    ).get() as { status: string; error_code: string | null; attempt_count: number };
    expect(execution.status).toBe('skipped');
    expect(execution.error_code).toBe('connector_paused');
    // 副作用なし：LINE 送信もタグ付けも起きない。
    const { __pushMessage } = await import('@line-crm/line-sdk') as unknown as { __pushMessage: ReturnType<typeof vi.fn> };
    expect(__pushMessage).not.toHaveBeenCalled();
  });

  it('再開したら止めていた分を待ち行列へ戻す', async () => {
    db.raw.prepare(`UPDATE ec_connectors SET status = 'paused' WHERE id = 'connector-1'`).run();
    await postEvent('evt-resume-1');
    const res = await commerceApp().request('/api/ec-commerce/connector?lineAccountId=account-a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'ec_cube', shopDomain: 'shop.example.com', status: 'connected',
        eventTypes: [], identityRules: [], expectedVersion: 1,
      }),
    }, { DB: db.db });
    expect(res.status).toBe(200);
    const event = db.raw.prepare(`SELECT status FROM ec_events WHERE external_event_id = 'evt-resume-1'`).get() as {
      status: string;
    };
    expect(event.status).toBe('received');
    const execution = db.raw.prepare(
      `SELECT status, next_retry_at FROM ec_action_executions WHERE event_id = (SELECT id FROM ec_events WHERE external_event_id = 'evt-resume-1')`,
    ).get() as { status: string; next_retry_at: string | null };
    expect(execution.status).toBe('retryable_failed');
    expect(execution.next_retry_at).not.toBeNull();
  });

  it('送る前に落ちた受信は回収して送達まで戻す', async () => {
    // 受付だけ済んで処理が走っていない行（クラッシュ直後と同じ形）。
    const payload = JSON.stringify(orderEvent('evt-retry-1')).replace(/'/g, "''");
    db.raw.exec(`
      INSERT INTO ec_events (id, source, external_event_id, event_type, line_account_id, customer_id,
        line_user_id, payload, status, received_at, updated_at)
      VALUES ('row-retry-1', 'eccube', 'evt-retry-1', 'ec.order.confirmed', 'account-a', 'C-1',
        'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '${payload}', 'received', '${NOW_JST}', '${NOW_JST}');
      INSERT INTO ec_action_executions
        (id, event_id, line_account_id, action_type, rule_version, idempotency_key, status,
         attempt_count, max_attempts, version, created_at, updated_at)
      VALUES ('exec-retry-1', 'row-retry-1', 'account-a', 'customer_notification', 'v1',
        'key-retry-1', 'pending', 0, 3, 1, '${NOW_JST}', '${NOW_JST}');
    `);
    const { __pushMessage } = await import('@line-crm/line-sdk') as unknown as { __pushMessage: ReturnType<typeof vi.fn> };
    const result = await processDueEcRetries(db.db, { now: '2026-09-20T10:00:00.000Z' });
    expect(result.processed).toBe(1);
    expect(__pushMessage).toHaveBeenCalledTimes(1);
    const event = db.raw.prepare(`SELECT status FROM ec_events WHERE external_event_id = 'evt-retry-1'`).get() as {
      status: string;
    };
    expect(event.status).toBe('processed');
  });

  it('回収した受信のV6連携へ復号鍵を渡す', async () => {
    const payload = JSON.stringify(orderEvent('evt-retry-key-1')).replace(/'/g, "''");
    db.raw.exec(`
      INSERT INTO ec_events (id, source, external_event_id, event_type, line_account_id, customer_id,
        line_user_id, payload, status, received_at, updated_at)
      VALUES ('row-retry-key-1', 'eccube', 'evt-retry-key-1', 'ec.order.confirmed', 'account-a', 'C-1',
        'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '${payload}', 'received', '${NOW_JST}', '${NOW_JST}');
      INSERT INTO ec_action_executions
        (id, event_id, line_account_id, action_type, rule_version, idempotency_key, status,
         attempt_count, max_attempts, version, created_at, updated_at)
      VALUES ('exec-retry-key-1', 'row-retry-key-1', 'account-a', 'customer_notification', 'v1',
        'key-retry-key-1', 'pending', 0, 3, 1, '${NOW_JST}', '${NOW_JST}');
    `);
    const result = await processDueEcRetries(db.db, {
      now: '2026-09-20T10:00:00.000Z', credentialKey: 'retry-credential-key',
    });
    expect(result.processed).toBe(1);
    const { fireEvent } = await import('../services/event-bus.js');
    const fireEventMock = fireEvent as unknown as ReturnType<typeof vi.fn>;
    expect(fireEventMock).toHaveBeenCalledTimes(1);
    expect(fireEventMock.mock.calls[0][6]).toBe('retry-credential-key');
  });

  it('送ったあとの失敗を回しても二重に送らない', async () => {
    await postEvent('evt-retry-2');
    const { __pushMessage } = await import('@line-crm/line-sdk') as unknown as { __pushMessage: ReturnType<typeof vi.fn> };
    expect(__pushMessage).toHaveBeenCalledTimes(1);
    // 送達後に失敗扱いになった行を回しても、送り直さない。
    db.raw.exec(`
      UPDATE ec_events SET status = 'failed', error_message = 'line_is_down'
       WHERE external_event_id = 'evt-retry-2';
      UPDATE ec_action_executions
         SET status = 'retryable_failed', attempt_count = 1, next_retry_at = '2026-09-20T00:00:00.000Z'
       WHERE event_id = (SELECT id FROM ec_events WHERE external_event_id = 'evt-retry-2');
    `);
    const result = await processDueEcRetries(db.db, { now: '2026-09-20T10:00:00.000Z' });
    expect(result.processed).toBe(1);
    expect(__pushMessage).toHaveBeenCalledTimes(1);
  });

  it('上限に達した失敗は回さない（dead letter）', async () => {
    await postEvent('evt-dead-1');
    db.raw.exec(`
      UPDATE ec_events SET status = 'failed', error_message = 'line_is_down'
       WHERE external_event_id = 'evt-dead-1';
      UPDATE ec_action_executions
         SET status = 'permanent_failed', attempt_count = 3
       WHERE event_id = (SELECT id FROM ec_events WHERE external_event_id = 'evt-dead-1');
    `);
    const { __pushMessage } = await import('@line-crm/line-sdk') as unknown as { __pushMessage: ReturnType<typeof vi.fn> };
    const before = __pushMessage.mock.calls.length;
    const result = await processDueEcRetries(db.db, { now: '2026-09-20T10:00:00.000Z' });
    expect(result.processed).toBe(0);
    expect(__pushMessage).toHaveBeenCalledTimes(before);
  });
});
