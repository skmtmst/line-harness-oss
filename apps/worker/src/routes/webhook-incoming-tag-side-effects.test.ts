/*
 * R403: 受信のタグ付与でマイル・成果の記録だけ失敗しても成功扱いにしない。
 *
 * 落ち方（直前）: タグは付くが queue/成果が欠けても受領は completed。
 *   同じ受信の再送は重複扱いで何もせず、欠けは戻らない。
 * 通り方（直後）: 連動処理の失敗は受領を失敗状態で残す。同じ受信の再送で
 *   欠けた記録だけが一度作られ、正常な成果を二重計上しない。
 *
 * 実アプリ（app・全 middleware 込み）と実 SQLite を叩く。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const fireEvent = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined));
vi.mock('../services/event-bus.js', () => ({ fireEvent }));

const { app } = await import('../index.js');

/** WEBHOOK_SECRET_MIN_LENGTH (32) 以上にする。短いと 503 で弾かれる。 */
const SECRET = 'tag-side-effect-secret-0123456789ab';

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
  db.raw.prepare(`INSERT INTO friends (id,line_user_id,line_account_id,is_following) VALUES ('friend-1','U1','account-1',1)`).run();
  db.raw.prepare(`INSERT INTO users (id, tenant_id) VALUES ('user-1', 'tenant-1')`).run();
  db.raw.prepare(`UPDATE friends SET user_id='user-1' WHERE id='friend-1'`).run();
  db.raw.prepare(`INSERT INTO tags (id,name,line_account_id) VALUES ('tag-1','受付済','account-1')`).run();
  db.raw.prepare(`
    INSERT INTO conversion_points (id, name, event_type, line_account_id, tenant_id)
    VALUES ('cp-1', 'タグ起点', 'tag_added', 'account-1', 'tenant-1')
  `).run();
  db.raw.prepare(`UPDATE incoming_webhooks SET identity_match_json=?,action_refs_json=? WHERE id='iwh-1'`).run(
    JSON.stringify({ methods: [{ kind: 'harness_friend_id', path: '$.friendId' }], onNotFound: 'do_nothing' }),
    JSON.stringify([{ refKind: 'tag', refId: 'tag-1', refVersionId: null }]),
  );
}

/** 指定の SQL を含む文の run を1回だけ失敗させる。 */
function failOnce(db: SqliteD1, needle: string): void {
  const prepare = db.db.prepare.bind(db.db);
  let armed = true;
  vi.spyOn(db.db, 'prepare').mockImplementation(((sql: string) => {
    const statement = prepare(sql);
    if (!armed || !sql.includes(needle)) return statement;
    return {
      ...statement,
      bind(...args: unknown[]) {
        const bound = (statement as unknown as { bind: (...inner: unknown[]) => unknown }).bind(...args);
        return new Proxy(bound as object, {
          get(target, property) {
            if (property === 'run') {
              return async () => {
                armed = false;
                throw new Error('side effect store unavailable');
              };
            }
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
          },
        });
      },
    } as unknown as D1PreparedStatement;
  }) as typeof db.db.prepare);
}

const counts = (db: SqliteD1) => ({
  tags: (db.raw.prepare(`SELECT COUNT(*) AS n FROM friend_tags`).get() as { n: number }).n,
  queue: (db.raw.prepare(`SELECT COUNT(*) AS n FROM mileage_event_queue`).get() as { n: number }).n,
  conversions: (db.raw.prepare(
    `SELECT COUNT(*) AS n FROM conversion_events WHERE conversion_point_id='cp-1'`,
  ).get() as { n: number }).n,
  receipt: db.raw.prepare(`SELECT status FROM incoming_webhook_receipts`).get() as { status: string },
});

describe('R403 タグ連動の失敗は受領に残し再送で直す', () => {
  let db: SqliteD1;
  let env: never;

  beforeEach(() => {
    fireEvent.mockReset().mockResolvedValue(undefined);
    db = createTestD1();
    seed(db);
    env = { DB: db.db } as never;
  });

  async function receive(body: string) {
    return app.request(
      '/api/webhooks/incoming/iwh-1/receive?accountId=account-1',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': await sign(SECRET, body) },
        body,
      },
      env,
    );
  }

  it('マイル待ち行の保存失敗は成功扱いにせず、再送で1件だけ作る', async () => {
    const body = JSON.stringify({ friendId: 'friend-1' });
    failOnce(db, 'INSERT OR IGNORE INTO mileage_event_queue');
    expect((await receive(body)).status).toBe(500);
    vi.restoreAllMocks();
    expect(counts(db)).toMatchObject({ tags: 1, queue: 0, receipt: { status: 'retryable_failed' } });

    expect((await receive(body)).status).toBe(200);
    expect(counts(db)).toMatchObject({ tags: 1, queue: 1, receipt: { status: 'completed' } });

    // 正常な記録の再送は重複扱いで増やさない。
    expect((await receive(body)).status).toBe(200);
    expect(counts(db)).toMatchObject({ tags: 1, queue: 1 });
  });

  it('成果記録の保存失敗は成功扱いにせず、再送で1件だけ作る', async () => {
    const body = JSON.stringify({ friendId: 'friend-1' });
    failOnce(db, 'INSERT INTO conversion_events');
    expect((await receive(body)).status).toBe(500);
    vi.restoreAllMocks();
    expect(counts(db)).toMatchObject({ tags: 1, conversions: 0, receipt: { status: 'retryable_failed' } });

    expect((await receive(body)).status).toBe(200);
    expect(counts(db)).toMatchObject({ tags: 1, conversions: 1, receipt: { status: 'completed' } });

    expect((await receive(body)).status).toBe(200);
    expect(counts(db)).toMatchObject({ tags: 1, conversions: 1 });
  });
});
