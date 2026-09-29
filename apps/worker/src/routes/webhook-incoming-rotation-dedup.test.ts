/*
 * R425: 合言葉を更新して同じ通知を再署名しても、受信処理と後続通知は重ねない。
 *
 * 落ち方（直前）: OLD署名の再送は重複扱いだが、NEWへ更新後の同一本文の
 *   NEW署名は新しい受領IDとなり、受領・未照合・後続通知が2件になる。
 * 通り方（直後）: 同じ接続・本文は新旧秘密値をまたいでも同じ受領と後続キーを使う。
 *   本文が違う正当な通知は別件のまま。誤署名・改ざんは拒否のまま。
 *
 * 実アプリ（app・全 middleware 込み）と実 SQLite を叩く。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const fireEvent = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined));
vi.mock('../services/event-bus.js', () => ({ fireEvent }));

const { app } = await import('../index.js');

const OLD_SECRET = 'rotation-old-secret-0123456789abcdef';
const NEW_SECRET = 'rotation-new-secret-0123456789abcdef';

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
  `).run(OLD_SECRET);
  db.raw.prepare(`UPDATE incoming_webhooks SET identity_match_json=?,action_refs_json=? WHERE id='iwh-1'`).run(
    JSON.stringify({ methods: [{ kind: 'harness_friend_id', path: '$.friendId' }], onNotFound: 'unmatched_box' }),
    JSON.stringify([]),
  );
}

const counts = (db: SqliteD1) => ({
  receipts: (db.raw.prepare(`SELECT COUNT(*) AS n FROM incoming_webhook_receipts`).get() as { n: number }).n,
  unmatched: (db.raw.prepare(`SELECT COUNT(*) AS n FROM incoming_webhook_unmatched_events`).get() as { n: number }).n,
  fired: fireEvent.mock.calls.length,
});

describe('R425 合言葉の入れ替え後の同一通知は重ねない', () => {
  let db: SqliteD1;
  let env: never;

  beforeEach(() => {
    fireEvent.mockReset().mockResolvedValue(undefined);
    db = createTestD1();
    seed(db);
    env = { DB: db.db } as never;
  });

  async function receive(body: string, secret: string) {
    return app.request(
      '/api/webhooks/incoming/iwh-1/receive?accountId=account-1',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': await sign(secret, body) },
        body,
      },
      env,
    );
  }

  it('OLD→NEWの再署名でも受領・未照合・後続通知は1件', async () => {
    const body = JSON.stringify({ eventId: 'evt-1', note: '同じ業務通知' });
    expect((await receive(body, OLD_SECRET)).status).toBe(200);
    expect(counts(db)).toMatchObject({ receipts: 1, unmatched: 1, fired: 1 });

    // OLD同署名の再送は従来どおり重複。
    const replayOld = await receive(body, OLD_SECRET);
    expect(replayOld.status).toBe(200);
    expect(await replayOld.json()).toMatchObject({ success: true, data: { duplicate: true } });
    expect(counts(db)).toMatchObject({ receipts: 1, unmatched: 1, fired: 1 });

    // 合言葉をNEWへ入れ替える。
    db.raw.prepare(`UPDATE incoming_webhooks SET secret=? WHERE id='iwh-1'`).run(NEW_SECRET);

    // 本文を一文字も変えずNEW署名で送る。別件にしてはならない。
    const resend = await receive(body, NEW_SECRET);
    expect(resend.status).toBe(200);
    expect(await resend.json()).toMatchObject({ success: true, data: { duplicate: true } });
    expect(counts(db)).toMatchObject({ receipts: 1, unmatched: 1, fired: 1 });
  });

  it('本文が違う正当な通知は別件、改ざん・誤署名は拒否のまま', async () => {
    const first = JSON.stringify({ eventId: 'evt-1' });
    expect((await receive(first, OLD_SECRET)).status).toBe(200);
    db.raw.prepare(`UPDATE incoming_webhooks SET secret=? WHERE id='iwh-1'`).run(NEW_SECRET);

    const second = JSON.stringify({ eventId: 'evt-2' });
    expect((await receive(second, NEW_SECRET)).status).toBe(200);
    expect(counts(db)).toMatchObject({ receipts: 2, unmatched: 2, fired: 2 });

    // 本文改ざん（OLD署名のまま本文だけ変える）は401。
    expect((await receive(JSON.stringify({ eventId: 'evt-1', hacked: true }), OLD_SECRET)).status).toBe(401);
    // 誤署名は401。
    expect((await receive(second, 'wrong-secret-0123456789abcdef-wr')).status).toBe(401);
    expect(counts(db)).toMatchObject({ receipts: 2, unmatched: 2, fired: 2 });
  });
});
