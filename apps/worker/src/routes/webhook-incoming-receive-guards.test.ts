/*
 * 公開受信口の防衛（R423 e2e / R427 / R428 / R430）。
 *
 * R423 e2e: コピーURL（accountなし）・正しい署名・account未含有JSONで正常受領。
 * R427: 停止・保管が完了した契約先への新規受信からは外部POSTを起こさない。
 *   署名の後に止め、受領も残さず理由つき403にする。
 * R428: 申告が上限超えなら本文を読まず413。申告なしの超過も上限で止める。
 * R430: 受付期間外・未来の署名時刻は受領・後続処理なしで拒否する。
 *   時刻を送らない古い送信元は受理する。
 *
 * 実アプリ（app・全 middleware 込み）と実 SQLite を叩く。
 * event-bus は発行の有無だけ見るため代役にする（POST抑止の証明）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const fireEvent = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined));
vi.mock('../services/event-bus.js', () => ({ fireEvent }));

const { app } = await import('../index.js');

/** WEBHOOK_SECRET_MIN_LENGTH (32) 以上にする。短いと 503 で弾かれる。 */
const SECRET = 'receive-guard-secret-0123456789abcd';

async function sign(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function seed(db: SqliteD1): void {
  db.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  db.raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES ('account-1', 'ch-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1')
  `).run();
  db.raw.prepare(`
    INSERT INTO incoming_webhooks (id, name, source_type, secret, line_account_id, is_active)
    VALUES ('iwh-1', '外部連携1', 'custom', ?, 'account-1', 1)
  `).run(SECRET);
  db.raw.prepare(`UPDATE incoming_webhooks SET identity_match_json=?,action_refs_json=? WHERE id='iwh-1'`).run(
    JSON.stringify({ methods: [], onNotFound: 'do_nothing' }),
    JSON.stringify([]),
  );
}

const receiptCount = (db: SqliteD1): number =>
  (db.raw.prepare(`SELECT COUNT(*) AS n FROM incoming_webhook_receipts`).get() as { n: number }).n;

describe('公開受信口の防衛', () => {
  let db: SqliteD1;
  let env: never;

  beforeEach(() => {
    fireEvent.mockReset().mockResolvedValue(undefined);
    db = createTestD1();
    seed(db);
    env = { DB: db.db } as never;
  });

  async function receive(body: string, headers?: Record<string, string>) {
    const signature = await sign(SECRET, body);
    return app.request(
      '/api/webhooks/incoming/iwh-1/receive',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          ...headers,
        },
        body,
      },
      env,
    );
  }

  it('R423: コピーURLのまま正しい署名で正常受領する', async () => {
    const body = JSON.stringify({ order: 1 });
    const res = await receive(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { received: true } });
    expect(receiptCount(db)).toBe(1);
    expect(fireEvent).toHaveBeenCalledTimes(1);
  });

  it.each(['suspended', 'archived'])('R427: 契約先%sの新規受信は403で受領も後続も残さない', async (status) => {
    db.raw.prepare(`UPDATE tenants SET status=? WHERE id='tenant-1'`).run(status);
    const body = JSON.stringify({ order: 2 });
    const res = await receive(body);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, code: 'TENANT_SUSPENDED' });
    expect(receiptCount(db)).toBe(0);
    expect(fireEvent).not.toHaveBeenCalled();
  });

  it('R427: 稼働中の対照は従来どおり通る', async () => {
    const body = JSON.stringify({ order: 3 });
    const res = await receive(body);
    expect(res.status).toBe(200);
    expect(fireEvent).toHaveBeenCalledTimes(1);
  });

  it('R428: 申告の上限超えは本文を読まず413にする', async () => {
    const big = `{"lineAccountId":"account-1","pad":"${'x'.repeat(1024 * 1024)}"}`;
    const res = await receive(big);
    expect(res.status).toBe(413);
    expect(receiptCount(db)).toBe(0);
    expect(fireEvent).not.toHaveBeenCalled();
  });

  it('R428: 申告なしの上限超えも上限で止めて413にする', async () => {
    const big = `{"pad":"${'y'.repeat(300 * 1024)}"}`;
    const signature = await sign(SECRET, big);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    // 文字列経路＋ストリーム本文で申告なし（content-lengthなし）を再現する。
    const res = await app.request(
      '/api/webhooks/incoming/iwh-1/receive',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': signature },
        body: stream,
        duplex: 'half',
      } as RequestInit,
      env,
    );
    expect(res.status).toBe(413);
    expect(receiptCount(db)).toBe(0);
    expect(fireEvent).not.toHaveBeenCalled();
  });

  it('R430: 1年前の署名時刻の初回受信は拒否する', async () => {
    const body = JSON.stringify({ eventId: 'old-1', order: 4 });
    const yearAgo = Math.floor(Date.now() / 1000) - 365 * 24 * 3600;
    const res = await receive(body, { 'X-Webhook-Timestamp': String(yearAgo) });
    expect(res.status).toBe(401);
    expect(receiptCount(db)).toBe(0);
    expect(fireEvent).not.toHaveBeenCalled();
  });

  it('R430: 許容幅を超える未来時刻は拒否する', async () => {
    const body = JSON.stringify({ eventId: 'future-1', order: 5 });
    const res = await receive(body, { 'X-Webhook-Timestamp': '2099-01-01T00:00:00.000Z' });
    expect(res.status).toBe(401);
    expect(receiptCount(db)).toBe(0);
    expect(fireEvent).not.toHaveBeenCalled();
  });

  it('R430: 期間内の時刻と時刻なしは受理し、安全な再送は重複扱いにする', async () => {
    const nowHeader = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ eventId: 'fresh-1', order: 6 });
    const first = await receive(body, { 'X-Webhook-Timestamp': nowHeader });
    expect(first.status).toBe(200);
    const legacy = await receive(JSON.stringify({ eventId: 'legacy-1', order: 7 }));
    expect(legacy.status).toBe(200);
    const replay = await receive(body, { 'X-Webhook-Timestamp': nowHeader });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ success: true, data: { duplicate: true } });
    expect(receiptCount(db)).toBe(2);
    expect(fireEvent).toHaveBeenCalledTimes(2);
  });
});
