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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const fireEvent = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined));
vi.mock('../services/event-bus.js', () => ({ fireEvent }));
const delivery = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; attempts: number; lastStatus: number }>>());
vi.mock('../services/outgoing-webhook-delivery.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/outgoing-webhook-delivery.js')>(),
  deliverWebhook: delivery,
}));

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
    fireEvent.mockReset().mockResolvedValue(undefined);
    delivery.mockReset();
    db = createTestD1();
    seed(db);
    env = { DB: db.db } as never;
  });
  afterEach(() => vi.restoreAllMocks());

  function configureTags() {
    db.raw.prepare(`INSERT INTO friends (id,line_user_id,line_account_id,is_following) VALUES ('friend-1','U1','account-1',1)`).run();
    db.raw.prepare(`INSERT INTO tags (id,name,line_account_id) VALUES ('tag-1','受付済','account-1')`).run();
    db.raw.prepare(`UPDATE incoming_webhooks SET identity_match_json=?,action_refs_json=? WHERE id='iwh-1'`).run(
      JSON.stringify({ methods: [{ kind: 'harness_friend_id', path: '$.friendId' }], onNotFound: 'do_nothing' }),
      JSON.stringify([{ refKind: 'tag', refId: 'tag-1', refVersionId: null }]),
    );
  }

  function configureOrderedMetadata(splitRefs = false, firstType = 'set_metadata', lastType = 'set_metadata') {
    configureTags();
    const actions = ['first', 'last'].map((stage, index) => {
      const type = index === 0 ? firstType : lastType;
      return { id: stage, type, onFailure: 'continue', params: type === 'set_metadata'
        ? { values: { stage } } : { richMenuPageId: 'menu-page' } };
    });
    const plans = splitRefs ? actions.map(action => [action]) : [actions];
    const refs = plans.map((plan, index) => {
      const id = `common-${index}`;
      const version = `version-${index}`;
      db.raw.prepare(`INSERT INTO common_actions (id,line_account_id,name,status,current_published_version_id)
        VALUES (?,'account-1',?,'published',?)`).run(id, id, version);
      db.raw.prepare(`INSERT INTO common_action_versions (id,common_action_id,version_number,status,action_config)
        VALUES (?,?,1,'published',?)`).run(version, id, JSON.stringify(plan));
      return { refKind: 'common_action', refId: id, refVersionId: version };
    });
    db.raw.prepare(`UPDATE incoming_webhooks SET action_refs_json=? WHERE id='iwh-1'`).run(JSON.stringify(refs));
  }

  const metadata = () => JSON.parse((db.raw.prepare("SELECT metadata FROM friends WHERE id='friend-1'")
    .get() as { metadata: string }).metadata || '{}');

  function seedRichMenu() {
    db.raw.exec(`INSERT INTO rich_menu_groups (id,account_id,name,chat_bar_text,size,status)
      VALUES ('menu-group','account-1','menu','menu','large','published');
      INSERT INTO rich_menu_pages (id,group_id,order_index,name,alias_id,line_richmenu_id)
      VALUES ('menu-page','menu-group',0,'menu','alias','line-menu');`);
  }

  it.each([false, true])('同じ受信の複数rich-menu最終状態操作は実行前に拒否する（参照分割=%s）', async split => {
    configureOrderedMetadata(split, 'switch_rich_menu', 'remove_rich_menu');
    seedRichMenu();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"richMenuId":"other"}', { status: 200 }));
    const body = JSON.stringify({ friendId: 'friend-1', order: 'ambiguous-menu' });
    expect((await receive(body)).status).toBe(500);
    expect(fetch).not.toHaveBeenCalled();
    expect(db.raw.prepare(`SELECT step_key FROM incoming_webhook_steps WHERE step_key LIKE 'action:%'`).all()).toEqual([]);
    expect(fireEvent).not.toHaveBeenCalled();
  });

  it.each(['switch_rich_menu', 'remove_rich_menu'])('%sがすでに目的状態なら確認だけで成功し再変更しない', async type => {
    configureOrderedMetadata(false, type);
    seedRichMenu();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(String(url)).toBe('https://api.line.me/v2/bot/user/U1/richmenu');
      expect(init?.method).toBe('GET');
      return type === 'switch_rich_menu'
        ? new Response('{"richMenuId":"line-menu"}', { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response('not found', { status: 404 });
    });
    const body = JSON.stringify({ friendId: 'friend-1', order: 'already-menu' });
    expect((await receive(body)).status).toBe(200);
    expect(metadata()).toEqual({ stage: 'last' });
    expect((await receive(body)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['action:0:0', false, { stage: 'first' }],
    ['plan:0', true, {}],
  ] as const)('%sのcheckpoint失敗では後工程を止め、再送後の最終値を巻き戻さない', async (key, splitRefs, afterFailure) => {
    configureOrderedMetadata(splitRefs);
    const prepare = db.db.prepare.bind(db.db);
    let fail = true;
    vi.spyOn(db.db, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql);
      if (!sql.includes("UPDATE incoming_webhook_steps SET status='completed'")) return statement;
      return { ...statement, bind(...args: unknown[]) {
        const bound = statement.bind(...args);
        if (!fail || args[2] !== key) return bound;
        return new Proxy(bound, { get(target, property) {
          if (property === 'run') return async () => { fail = false; throw new Error('checkpoint unavailable'); };
          const value = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        } });
      } } as D1PreparedStatement;
    });
    const body = JSON.stringify({ friendId: 'friend-1', order: 'ordered-steps' });
    expect((await receive(body)).status).toBe(500);
    expect(metadata()).toEqual(afterFailure);
    expect(fireEvent).not.toHaveBeenCalled();
    expect(db.raw.prepare('SELECT status,attempt_count FROM incoming_webhook_receipts').get())
      .toEqual({ status: 'retryable_failed', attempt_count: 1 });
    expect(db.raw.prepare(`SELECT step_key FROM incoming_webhook_steps WHERE step_key IN ('action:0:1','action:1:0','plan:1')`).all())
      .toEqual([]);
    expect((await receive(body)).status).toBe(200);
    expect(metadata()).toEqual({ stage: 'last' });
    expect(db.raw.prepare(`SELECT status FROM incoming_webhook_steps WHERE step_key LIKE 'action:%'`).all())
      .toEqual([{ status: 'completed' }, { status: 'completed' }]);
    expect(db.raw.prepare('SELECT status,attempt_count FROM incoming_webhook_receipts').get())
      .toEqual({ status: 'completed', attempt_count: 2 });
    expect((await receive(body)).status).toBe(200);
    expect(metadata()).toEqual({ stage: 'last' });
    expect(fireEvent).toHaveBeenCalledTimes(1);
  });

  it('leaseを失った旧workerの遅い書き込みで再送完了後の最終値を戻さない', async () => {
    configureOrderedMetadata();
    const prepare = db.db.prepare.bind(db.db);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let intercepted = false;
    const metadataStatements = new WeakSet<D1PreparedStatement>();
    const batch = db.db.batch.bind(db.db);
    vi.spyOn(db.db, 'batch').mockImplementation(async statements => {
      if (!intercepted && statements.some(statement => metadataStatements.has(statement))) {
        intercepted = true; enter(); await blocked;
      }
      return batch(statements);
    });
    vi.spyOn(db.db, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql);
      if (!sql.includes('UPDATE friends SET metadata')) return statement;
      return { ...statement, bind(...args: unknown[]) {
        const bound = statement.bind(...args);
        const delayed = { ...bound, async run() {
          if (!intercepted) { intercepted = true; enter(); await blocked; }
          return bound.run();
        } } as D1PreparedStatement;
        metadataStatements.add(delayed);
        return delayed;
      } } as D1PreparedStatement;
    });
    const body = JSON.stringify({ friendId: 'friend-1', order: 'stale-action-write' });
    const stale = receive(body);
    await entered;
    expect((await receive(body)).status).toBe(503);
    db.raw.prepare('UPDATE incoming_webhook_receipts SET lease_expires_at=0').run();
    expect((await receive(body)).status).toBe(200);
    expect(metadata()).toEqual({ stage: 'last' });
    release();
    expect((await stale).status).toBe(500);
    expect(metadata()).toEqual({ stage: 'last' });
  });

  it('行動自体の失敗でも後工程を先に実行せず、復旧後は元の順に実行する', async () => {
    configureOrderedMetadata();
    const prepare = db.db.prepare.bind(db.db);
    let fail = true;
    vi.spyOn(db.db, 'prepare').mockImplementation((sql) => {
      if (fail && sql.includes('UPDATE friends SET metadata')) {
        fail = false;
        throw new Error('metadata write unavailable');
      }
      return prepare(sql);
    });
    const body = JSON.stringify({ friendId: 'friend-1', order: 'action-failure' });
    expect((await receive(body)).status).toBe(500);
    expect(metadata()).toEqual({});
    expect(fireEvent).not.toHaveBeenCalled();
    expect((await receive(body)).status).toBe(200);
    expect(metadata()).toEqual({ stage: 'last' });
  });

  it('未対応の行動を飛ばして後工程の結果だけ確定しない', async () => {
    configureOrderedMetadata(false, 'future_action');
    const body = JSON.stringify({ friendId: 'friend-1', order: 'unknown-action' });
    expect((await receive(body)).status).toBe(500);
    expect((await receive(body)).status).toBe(500);
    expect(metadata()).toEqual({});
    expect(fireEvent).not.toHaveBeenCalled();
    expect(db.raw.prepare(`SELECT step_key FROM incoming_webhook_steps WHERE step_key LIKE 'action:%'`).all()).toEqual([]);
  });

  it('別tenantの友だち・タグには受信actionが触れない', async () => {
    configureTags();
    db.raw.prepare("INSERT INTO tenants (id,name) VALUES ('tenant-2','別組織')").run();
    db.raw.prepare(`INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret,is_active,tenant_id)
      VALUES ('account-2','ch-2','別店舗','token-2','secret-2',1,'tenant-2')`).run();
    db.raw.prepare(`INSERT INTO friends (id,line_user_id,line_account_id,is_following) VALUES ('friend-2','U2','account-2',1)`).run();
    db.raw.prepare(`INSERT INTO tags (id,name,line_account_id) VALUES ('tag-2','別組織のタグ','account-2')`).run();
    expect((await receive(JSON.stringify({ friendId: 'friend-2' }))).status).toBe(200);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM friend_tags').get()).toEqual({ n: 0 });
    db.raw.prepare(`UPDATE incoming_webhooks SET action_refs_json=? WHERE id='iwh-1'`).run(JSON.stringify([
      { refKind: 'tag', refId: 'tag-2', refVersionId: null },
    ]));
    expect((await receive(JSON.stringify({ friendId: 'friend-1' }))).status).toBe(500);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM friend_tags').get()).toEqual({ n: 0 });
  });

  it('処理開始前のDB例外を失敗として残し、正規再送で回復する', async () => {
    configureTags();
    const prepare = db.db.prepare.bind(db.db);
    let fail = true;
    vi.spyOn(db.db, 'prepare').mockImplementation((sql) => {
      if (fail && sql.includes('SELECT id FROM friends WHERE id = ? AND line_account_id = ?')) {
        fail = false;
        throw new Error('temporary DB failure');
      }
      return prepare(sql);
    });
    const body = JSON.stringify({ friendId: 'friend-1' });
    expect((await receive(body)).status).toBe(500);
    expect(db.raw.prepare(`SELECT status,attempt_count FROM incoming_webhook_receipts`).get())
      .toEqual({ status: 'retryable_failed', attempt_count: 1 });
    expect((await receive(body)).status).toBe(200);
    expect(db.raw.prepare(`SELECT COUNT(*) AS n FROM friend_tags`).get()).toEqual({ n: 1 });
    expect(db.raw.prepare(`SELECT status,attempt_count FROM incoming_webhook_receipts`).get())
      .toEqual({ status: 'completed', attempt_count: 2 });
  });

  it.each([
    ['INSERT OR IGNORE INTO incoming_webhook_receipts', null],
    ["SET status='processing',lease_owner=", 'accepted'],
    ['SELECT source_event_id,status,received_at', 'processing'],
  ])('受付途中のDB障害でも受信を失わない: %s', async (fragment, expectedStatus) => {
    const prepare = db.db.prepare.bind(db.db);
    let fail = true;
    vi.spyOn(db.db, 'prepare').mockImplementation((sql) => {
      if (fail && sql.includes(fragment!)) {
        fail = false;
        throw new Error('receipt DB unavailable');
      }
      return prepare(sql);
    });
    const body = JSON.stringify({ order: 'receipt-db-failure' });
    expect((await receive(body)).status).toBe(500);
    expect(fireEvent).not.toHaveBeenCalled();
    const row = db.raw.prepare('SELECT status FROM incoming_webhook_receipts').get() as { status: string } | undefined;
    expect(row?.status ?? null).toBe(expectedStatus);
    if (expectedStatus === 'processing') {
      expect((await receive(body)).status).toBe(503);
      db.raw.prepare('UPDATE incoming_webhook_receipts SET lease_expires_at=0').run();
    }
    expect((await receive(body)).status).toBe(200);
    expect(fireEvent).toHaveBeenCalledTimes(1);
    expect(db.raw.prepare('SELECT status FROM incoming_webhook_receipts').get()).toEqual({ status: 'completed' });
  });

  it('fireEvent失敗後は同じ発生元IDで再開し、成功済み行動は繰り返さない', async () => {
    configureTags();
    fireEvent.mockRejectedValueOnce(new Error('temporary event failure'));
    const body = JSON.stringify({ friendId: 'friend-1' });
    expect((await receive(body)).status).toBe(500);
    expect(db.raw.prepare(`SELECT COUNT(*) AS n FROM friend_tags`).get()).toEqual({ n: 1 });
    // その後に運用者がタグを外しても、完了済み受信行動で付け直してはいけない。
    db.raw.prepare(`DELETE FROM friend_tags`).run();
    expect((await receive(body)).status).toBe(200);
    expect(db.raw.prepare(`SELECT COUNT(*) AS n FROM friend_tags`).get()).toEqual({ n: 0 });
    expect(fireEvent).toHaveBeenCalledTimes(2);
    const calls = fireEvent.mock.calls as unknown as Array<[unknown, unknown, { sourceEventId: string; occurredAt: string }]>;
    expect(calls[0]![2].sourceEventId).toBe(calls[1]![2].sourceEventId);
    expect(calls[0]![2].occurredAt).toBe(calls[1]![2].occurredAt);
    expect(counts(db).logs).toBe(1);
  });

  it('部分成功のあとは失敗した行動だけ再開する', async () => {
    configureTags();
    db.raw.prepare(`UPDATE incoming_webhooks SET action_refs_json=? WHERE id='iwh-1'`).run(JSON.stringify([
      { refKind: 'tag', refId: 'tag-1', refVersionId: null },
      { refKind: 'tag', refId: 'tag-2', refVersionId: null },
    ]));
    const body = JSON.stringify({ friendId: 'friend-1' });
    expect((await receive(body)).status).toBe(500);
    expect(fireEvent).not.toHaveBeenCalled();
    db.raw.prepare(`DELETE FROM friend_tags`).run();
    db.raw.prepare(`INSERT INTO tags (id,name,line_account_id) VALUES ('tag-2','復旧','account-1')`).run();
    expect((await receive(body)).status).toBe(200);
    expect(db.raw.prepare(`SELECT tag_id FROM friend_tags`).all()).toEqual([{ tag_id: 'tag-2' }]);
  });

  it('同時再送は処理中を503で返し、初回失敗後に回復できる', async () => {
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    let reject!: (error: Error) => void;
    const blocked = new Promise<void>((_, fail) => { reject = fail; });
    fireEvent.mockImplementationOnce(async () => { enter(); await blocked; });
    const body = JSON.stringify({ order: 'concurrent' });
    const pending = receive(body);
    await entered;
    const duplicate = await receive(body);
    expect(duplicate.status).toBe(503);
    expect(duplicate.headers.get('Retry-After')).toBe('5');
    expect(fireEvent).toHaveBeenCalledTimes(1);
    reject(new Error('first request failed'));
    expect((await pending).status).toBe(500);
    expect((await receive(body)).status).toBe(200);
    expect(fireEvent).toHaveBeenCalledTimes(2);
  });

  it('初回応答前にworkerが止まってもlease期限後に回復し、古いworkerは確定できない', async () => {
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    fireEvent.mockImplementationOnce(async () => { enter(); await blocked; });
    const body = JSON.stringify({ order: 'lost-worker' });
    const pending = receive(body);
    await entered;
    expect((await receive(body)).status).toBe(503);
    db.raw.prepare(`UPDATE incoming_webhook_receipts SET lease_expires_at=0`).run();
    expect((await receive(body)).status).toBe(200);
    release();
    expect((await pending).status).toBe(500);
    expect(db.raw.prepare(`SELECT status,attempt_count,lease_owner FROM incoming_webhook_receipts`).get())
      .toEqual({ status: 'completed', attempt_count: 2, lease_owner: null });
    expect((await receive(body)).status).toBe(200);
    expect(fireEvent).toHaveBeenCalledTimes(2);
  });

  it('完了保存だけ失敗しても下流の成功を繰り返さず再送で完了する', async () => {
    const prepare = db.db.prepare.bind(db.db);
    let fail = true;
    vi.spyOn(db.db, 'prepare').mockImplementation((sql) => {
      if (fail && sql.includes("SET status='completed',completed_at=")) {
        fail = false;
        throw new Error('completion write failed');
      }
      return prepare(sql);
    });
    const body = JSON.stringify({ order: 'lost-response' });
    expect((await receive(body)).status).toBe(500);
    expect((await receive(body)).status).toBe(200);
    expect(fireEvent).toHaveBeenCalledTimes(1);
    expect(counts(db)).toEqual({ receipts: 1, logs: 1, fired: 1 });
  });

  it('LINE受理後に応答を失っても同じRetry-Keyで回復し、完了済み送信は繰り返さない', async () => {
    configureTags();
    db.raw.prepare(`INSERT INTO templates (id,name,message_type,message_content,line_account_id)
      VALUES ('template-1','受信応答','text','受付しました','account-1')`).run();
    db.raw.prepare(`UPDATE incoming_webhooks SET action_refs_json=? WHERE id='iwh-1'`).run(JSON.stringify([
      { refKind: 'template', refId: 'template-1', refVersionId: null },
    ]));
    const accepted = new Set<string>();
    const requests: Array<{ key: string; body: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(String(url)).toBe('https://api.line.me/v2/bot/message/push');
      const key = new Headers(init?.headers).get('X-Line-Retry-Key')!;
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      requests.push({ key, body: String(init?.body) });
      if (accepted.has(key)) return new Response(null, { status: 409 });
      accepted.add(key);
      throw new Error('response lost after LINE accepted the message');
    });
    const body = JSON.stringify({ friendId: 'friend-1', order: 'lost-line-response' });
    expect((await receive(body)).status).toBe(500);
    fireEvent.mockRejectedValueOnce(new Error('event failed after LINE retry succeeded'));
    expect((await receive(body)).status).toBe(500);
    expect((await receive(body)).status).toBe(200);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(accepted.size).toBe(1);
    expect(db.raw.prepare(`SELECT COUNT(*) AS n FROM messages_log`).get()).toEqual({ n: 1 });
    expect(db.raw.prepare(`SELECT status FROM outbound_send_requests`).get()).toEqual({ status: 'succeeded' });
  });

  it('実event busで加点後に記録が失敗しても、再送で二重加点しない', async () => {
    configureTags();
    db.raw.prepare(`INSERT INTO scoring_rules (id,name,event_type,score_value,is_active)
      VALUES ('score-1','受信','incoming_webhook.custom',10,1)`).run();
    const actual = await vi.importActual<typeof import('../services/event-bus.js')>('../services/event-bus.js');
    fireEvent.mockImplementation((...args) => actual.fireEvent(...args as Parameters<typeof actual.fireEvent>));
    const prepare = db.db.prepare.bind(db.db);
    let fail = true;
    vi.spyOn(db.db, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql);
      if (!sql.includes("UPDATE incoming_webhook_steps SET status='completed'")) return statement;
      return { ...statement, bind(...args: unknown[]) {
        const bound = statement.bind(...args);
        if (!fail || args[2] !== 'event:scoring') return bound;
        return { ...bound, async run() { fail = false; throw new Error('score checkpoint unavailable'); } } as unknown as D1PreparedStatement;
      } } as D1PreparedStatement;
    });
    const body = JSON.stringify({ friendId: 'friend-1' });
    expect((await receive(body)).status).toBe(500);
    expect(db.raw.prepare(`SELECT score FROM friends WHERE id='friend-1'`).get()).toEqual({ score: 10 });
    expect((await receive(body)).status).toBe(200);
    expect(db.raw.prepare(`SELECT score FROM friends WHERE id='friend-1'`).get()).toEqual({ score: 10 });
    expect(db.raw.prepare(`SELECT COUNT(*) AS n FROM friend_scores`).get()).toEqual({ n: 1 });
  });

  it('実event busの一部送り先だけ失敗したら成功した送り先へは再送しない', async () => {
    const actual = await vi.importActual<typeof import('../services/event-bus.js')>('../services/event-bus.js');
    fireEvent.mockImplementation((...args) => actual.fireEvent(...args as Parameters<typeof actual.fireEvent>));
    for (const id of ['out-1', 'out-2']) {
      db.raw.prepare(`INSERT INTO outgoing_webhooks (id,name,url,event_types,secret,line_account_id)
        VALUES (?,?,?,'["incoming_webhook.custom"]',?,'account-1')`).run(id, id, `https://${id}.example.test`, SECRET);
    }
    let fail = true;
    delivery.mockImplementation(async (webhook) => {
      const ok = (webhook as { id: string }).id !== 'out-2' || !fail;
      if (!ok) fail = false;
      return { ok, attempts: 1, lastStatus: ok ? 200 : 500 };
    });
    const body = JSON.stringify({ order: 'outgoing-partial' });
    expect((await receive(body)).status).toBe(500);
    expect((await receive(body)).status).toBe(200);
    const calls = delivery.mock.calls;
    expect(calls.filter(([wh]) => (wh as { id: string }).id === 'out-1')).toHaveLength(1);
    const retried = calls.filter(([wh]) => (wh as { id: string }).id === 'out-2');
    expect(retried).toHaveLength(2);
    expect(retried[0]![1]).toBe(retried[1]![1]);
    expect(retried[0]![2]).toEqual(retried[1]![2]);
  });

  it('実event busの旧自動処理も失敗後に回復し、完了した行動を繰り返さない', async () => {
    configureTags();
    db.raw.prepare(`INSERT INTO tags (id,name,line_account_id) VALUES ('tag-legacy','旧処理','account-1')`).run();
    db.raw.prepare(`INSERT INTO automations (id,name,event_type,actions,line_account_id) VALUES ('legacy-1','旧処理','incoming_webhook.custom',?,'account-1')`).run(JSON.stringify([
      { type: 'add_tag', params: { tagId: 'tag-legacy' } },
      { type: 'set_metadata', params: { data: '{broken' } },
    ]));
    const actual = await vi.importActual<typeof import('../services/event-bus.js')>('../services/event-bus.js');
    fireEvent.mockImplementation((...args) => actual.fireEvent(...args as Parameters<typeof actual.fireEvent>));
    const body = JSON.stringify({ friendId: 'friend-1' });
    expect((await receive(body)).status).toBe(500);
    db.raw.prepare(`DELETE FROM friend_tags WHERE tag_id='tag-legacy'`).run();
    db.raw.prepare(`UPDATE automations SET actions=? WHERE id='legacy-1'`).run(JSON.stringify([
      { type: 'add_tag', params: { tagId: 'tag-legacy' } },
      { type: 'set_metadata', params: { data: '{"recovered":true}' } },
    ]));
    expect((await receive(body)).status).toBe(200);
    expect(db.raw.prepare(`SELECT tag_id FROM friend_tags WHERE tag_id='tag-legacy'`).all()).toEqual([]);
    expect(JSON.parse((db.raw.prepare(`SELECT metadata FROM friends WHERE id='friend-1'`).get() as { metadata: string }).metadata))
      .toMatchObject({ recovered: true });
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
