/*
 * R402: 受信の再試行中に設定を変えても、元の受信は元の計画で動く。
 *
 * 落ち方（直前）: 再試行がその時点の設定を読み直す。T2を外すと旧T2の
 *   進捗が processing のまま受領全体が completed になる。T3を足すと
 *   同じ旧受信へ新しいT3も付く。未照合保存の失敗後に扱いを変えると
 *   保留が消える。
 * 通り方（直後）: 受領時に固定した計画（照合・未一致時の扱い・処理配列・
 *   版）を再試行が最後まで使う。T2だけを一度完了する。T3は混ざらない。
 *   未照合の再試行も当初の保留方針を守る。
 *
 * 実アプリ（app・全 middleware 込み）と実 SQLite を叩く。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const fireEvent = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined));
vi.mock('../services/event-bus.js', () => ({ fireEvent }));

const { app } = await import('../index.js');

/** WEBHOOK_SECRET_MIN_LENGTH (32) 以上にする。短いと 503 で弾かれる。 */
const SECRET = 'retry-plan-secret-0123456789abcdef';

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
  for (const tag of ['tag-1', 'tag-2', 'tag-3']) {
    db.raw.prepare(`INSERT INTO tags (id,name,line_account_id) VALUES (?,?,'account-1')`).run(tag, `タグ${tag}`);
  }
}

function setConfig(db: SqliteD1, actions: Array<{ refKind: string; refId: string }>, onNotFound = 'do_nothing'): void {
  db.raw.prepare(`UPDATE incoming_webhooks SET identity_match_json=?,action_refs_json=?,version=version+1 WHERE id='iwh-1'`).run(
    JSON.stringify({ methods: [{ kind: 'harness_friend_id', path: '$.friendId' }], onNotFound }),
    JSON.stringify(actions.map((action) => ({ ...action, refVersionId: null }))),
  );
}

const friendTags = (db: SqliteD1): string[] => (db.raw.prepare(
  `SELECT tag_id AS id FROM friend_tags WHERE friend_id='friend-1' ORDER BY tag_id`,
).all() as Array<{ id: string }>).map((row) => row.id);

describe('R402 再試行は受領時の計画を使う', () => {
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

  it('T2を外しても元の受信はT2だけを一度完了する', async () => {
    setConfig(db, [{ refKind: 'tag', refId: 'tag-1' }, { refKind: 'tag', refId: 'tag-2' }]);
    // 初回はT2の保存を失敗させる（参照先を消す）。
    db.raw.prepare(`DELETE FROM tags WHERE id='tag-2'`).run();
    const body = JSON.stringify({ friendId: 'friend-1' });
    expect((await receive(body)).status).toBe(500);
    expect(friendTags(db)).toEqual(['tag-1']);

    // 運用者が再試行の前にT2を外す。T2自体は復旧しておく。
    db.raw.prepare(`INSERT INTO tags (id,name,line_account_id) VALUES ('tag-2','タグtag-2','account-1')`).run();
    setConfig(db, [{ refKind: 'tag', refId: 'tag-1' }]);
    const retry = await receive(body);
    expect(retry.status).toBe(200);
    // 元の計画の未処理（T2）を完了し、全体成功にする。
    expect(friendTags(db)).toEqual(['tag-1', 'tag-2']);
    expect(db.raw.prepare(`SELECT status FROM incoming_webhook_receipts`).get()).toEqual({ status: 'completed' });
  });

  it('T3を足しても同じ旧受信へ新しい処理は混ざらない', async () => {
    setConfig(db, [{ refKind: 'tag', refId: 'tag-1' }, { refKind: 'tag', refId: 'tag-2' }]);
    db.raw.prepare(`DELETE FROM tags WHERE id='tag-2'`).run();
    const body = JSON.stringify({ friendId: 'friend-1' });
    expect((await receive(body)).status).toBe(500);

    db.raw.prepare(`INSERT INTO tags (id,name,line_account_id) VALUES ('tag-2','タグtag-2','account-1')`).run();
    setConfig(db, [
      { refKind: 'tag', refId: 'tag-1' },
      { refKind: 'tag', refId: 'tag-2' },
      { refKind: 'tag', refId: 'tag-3' },
    ]);
    const retry = await receive(body);
    expect(retry.status).toBe(200);
    expect(friendTags(db)).toEqual(['tag-1', 'tag-2']);
  });

  it('未照合保存の再試行は当初の保留方針を守る', async () => {
    setConfig(db, [], 'unmatched_box');
    // 初回は保留の保存だけを失敗させる。
    const prepare = db.db.prepare.bind(db.db);
    let failOnce = true;
    vi.spyOn(db.db, 'prepare').mockImplementation(((sql: string) => {
      const statement = prepare(sql);
      if (!failOnce || !sql.includes('INSERT OR IGNORE INTO incoming_webhook_unmatched_events')) {
        return statement;
      }
      return {
        ...statement,
        bind(...args: unknown[]) {
          const bound = (statement as unknown as { bind: (...inner: unknown[]) => unknown }).bind(...args);
          return new Proxy(bound as object, {
            get(target, property) {
              if (property === 'run') {
                return async () => {
                  failOnce = false;
                  throw new Error('unmatched store unavailable');
                };
              }
              const value = Reflect.get(target, property);
              return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
            },
          });
        },
      } as unknown as D1PreparedStatement;
    }) as typeof db.db.prepare);
    const body = JSON.stringify({ friendId: 'nobody' });
    expect((await receive(body)).status).toBe(500);
    vi.restoreAllMocks();

    // 運用者が再試行の前に扱いを「何もしない」へ変える。
    setConfig(db, [], 'do_nothing');
    const retry = await receive(body);
    expect(retry.status).toBe(200);
    // 当初の保留方針で箱へ1件残る。保留0件のまま完了にしない。
    expect((db.raw.prepare(`SELECT COUNT(*) AS n FROM incoming_webhook_unmatched_events`).get() as { n: number }).n).toBe(1);
  });
});
