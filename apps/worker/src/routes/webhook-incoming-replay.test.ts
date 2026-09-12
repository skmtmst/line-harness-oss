/*
 * N-365 (#746): 受信Webhookの同じ署名の使い回しを弾く。
 *
 * 直した欠陥（棚卸し #264 の実測）:
 *   同じ本文・同じ署名をそのまま3回送ると [200,200,200] で通り、
 *   受信記録が3行積まれ、fireEvent が3回走っていた。
 *   本文を変えると 401 になるので完全性は守られていて、欠けていたのは新鮮さだけ。
 *
 * ここで止めたい崩れ方:
 *   1. 2回目が通ってしまう（= 盗った署名を何度でも再生できる）
 *   2. 弾きすぎて、別の本文（別の署名）の正規の受信まで落ちる
 *   3. 形の壊れた本文で予約を使い切り、送り直しが 400 ではなく「重複」になる
 *   4. 署名が違うものを通してしまう（既存の守りを壊す）
 *   5. 鍵に webhook_id が入っておらず、別の受信口の受信が混ざって弾かれる
 *
 * source 文字列ではなく、実アプリ(`app`・全 middleware 込み)と実 SQLite を叩く。
 * `?accountId=` を付けているのは、この口が feature 分類のため付けないと
 * 署名検証へ到達しないから（#746 で別途報告済み。この票では直していない）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const fireEvent = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../services/event-bus.js', () => ({ fireEvent }));

const { app } = await import('../index.js');

/** WEBHOOK_SECRET_MIN_LENGTH (32) 以上にする。短いと 503 で弾かれる。 */
const SECRET = 'replay-guard-secret-0123456789abcd';

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
  /*
   * iwh-2 には **iwh-1 と同じ鍵** を入れる。
   * 鍵が違うと同じ本文でも署名が別物になり、signature_hash が衝突しないので
   * 「予約の鍵に webhook_id が入っているか」を測れない(緑のまま通ってしまう)。
   * 同じ鍵を2つの受信口に使うのは運用上あり得る形でもある。
   */
  db.raw.prepare(`
    INSERT INTO incoming_webhooks (id, name, source_type, secret, line_account_id, is_active)
    VALUES ('iwh-2', '外部連携2', 'custom', ?, 'account-1', 1)
  `).run(SECRET);
}

const counts = (db: SqliteD1) => ({
  receipts: (db.raw.prepare(
    `SELECT COUNT(*) AS n FROM incoming_webhook_receipts`,
  ).get() as { n: number }).n,
  logs: (db.raw.prepare(
    `SELECT COUNT(*) AS n FROM webhook_interaction_logs`,
  ).get() as { n: number }).n,
  fired: fireEvent.mock.calls.length,
});

describe('N-365 #746 受信Webhookの再送を弾く', () => {
  let db: SqliteD1;
  let env: never;

  beforeEach(() => {
    fireEvent.mockClear();
    db = createTestD1();
    seed(db);
    env = { DB: db.db } as never;
  });

  /** 署名を付けて受信口を叩く。secret を指定しなければ iwh-1 の鍵で署名する。 */
  async function receive(
    body: string,
    options?: { webhookId?: string; secret?: string; signature?: string },
  ) {
    const webhookId = options?.webhookId ?? 'iwh-1';
    const signature = options?.signature
      ?? await sign(options?.secret ?? SECRET, body);
    return app.request(
      `/api/webhooks/incoming/${webhookId}/receive?accountId=account-1`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': signature },
        body,
      },
      env,
    );
  }

  it('同じ署名の2回目は副作用を起こさず弾かれる', async () => {
    const body = JSON.stringify({ order_id: 'A-1', amount: 12000 });

    const first = await receive(body);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      success: true, data: { received: true, source: 'custom' },
    });
    const afterFirst = counts(db);
    expect(afterFirst).toMatchObject({ receipts: 1, logs: 1, fired: 1 });

    const second = await receive(body);
    // 送り手が再試行を続けないよう 200 で返す。ただし重複だと分かる形にする。
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      success: true, data: { received: true, duplicate: true, source: 'custom' },
    });

    const third = await receive(body);
    expect(third.status).toBe(200);

    // 肝心なのは件数。2回目・3回目で下流が動いていないこと。
    expect(counts(db)).toMatchObject({ receipts: 1, logs: 1, fired: 1 });
  });

  it('別の本文（別の署名）は今までどおり通る（締めすぎていない）', async () => {
    const first = await receive(JSON.stringify({ order_id: 'A-1', amount: 12000 }));
    const second = await receive(JSON.stringify({ order_id: 'A-2', amount: 8000 }));
    expect([first.status, second.status]).toEqual([200, 200]);
    await expect(second.json()).resolves.toMatchObject({ data: { received: true } });
    expect(counts(db)).toMatchObject({ receipts: 2, logs: 2, fired: 2 });
  });

  it('形の壊れた本文は400のままで、予約を使い切らない', async () => {
    const broken = '{"order_id": "A-1"';
    const rejected = await receive(broken);
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({ error: 'Invalid JSON body' });
    // 予約を先に取っていたら、ここが 1 になる。
    expect(counts(db)).toMatchObject({ receipts: 0, logs: 0, fired: 0 });

    // 送り手が直して送り直したとき、「重複」ではなく通らなければならない。
    const fixed = await receive('{"order_id": "A-1"}');
    expect(fixed.status).toBe(200);
    const body = await fixed.json() as { data: Record<string, unknown> };
    expect(body.data.duplicate).toBeUndefined();
    expect(counts(db)).toMatchObject({ receipts: 1, logs: 1, fired: 1 });
  });

  it('署名が違えば401のまま（既存の守りを壊していない）', async () => {
    const body = JSON.stringify({ order_id: 'A-1' });
    const wrong = await receive(body, { signature: 'deadbeef' });
    expect(wrong.status).toBe(401);

    // 本文を変えて同じ署名を使い回す形も 401。
    const signature = await sign(SECRET, body);
    const tampered = await receive(JSON.stringify({ order_id: 'A-1', amount: 99999 }), { signature });
    expect(tampered.status).toBe(401);

    expect(counts(db)).toMatchObject({ receipts: 0, logs: 0, fired: 0 });
  });

  it('別の受信口の受信は互いに弾かない（鍵に webhook_id が入っている）', async () => {
    /*
     * 2つの受信口は同じ鍵なので、同じ本文の署名は**完全に同じ値**になる。
     * 予約の鍵が signature_hash だけなら、2つ目が「重複」で弾かれる。
     * webhook_id が入っていれば、どちらも通る。
     */
    const body = JSON.stringify({ order_id: 'A-1' });
    const signature = await sign(SECRET, body);
    const first = await receive(body, { webhookId: 'iwh-1', signature });
    expect(first.status).toBe(200);

    const second = await receive(body, { webhookId: 'iwh-2', signature });
    expect(second.status).toBe(200);
    const secondBody = await second.json() as { data: Record<string, unknown> };
    expect(secondBody.data.duplicate).toBeUndefined();

    const rows = db.raw.prepare(
      `SELECT webhook_id FROM incoming_webhook_receipts ORDER BY webhook_id`,
    ).all() as Array<{ webhook_id: string }>;
    expect(rows.map((row) => row.webhook_id)).toEqual(['iwh-1', 'iwh-2']);
    expect(counts(db)).toMatchObject({ receipts: 2, logs: 2, fired: 2 });
  });

  it('台帳には署名そのものを残さない（SHA-256を入れる）', async () => {
    const body = JSON.stringify({ order_id: 'A-1' });
    const signature = await sign(SECRET, body);
    expect((await receive(body, { signature })).status).toBe(200);

    const row = db.raw.prepare(
      `SELECT signature_hash FROM incoming_webhook_receipts WHERE webhook_id = 'iwh-1'`,
    ).get() as { signature_hash: string };
    // そのまま使い回せる署名が残っていないこと。
    expect(row.signature_hash).not.toBe(signature);
    expect(row.signature_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
