/*
 * N-327 #663: フォームの回答から運用者通知が自動発火することを、実 SQLite と
 * 実ルートで見張る。
 *
 * ここで止めたい崩れ方:
 *   1. 回答は保存されたのに運用者通知が出ない(接続が外れる)。
 *   2. 同じ Idempotency-Key の再送・再開で通知インスタンスが二重に作られる。
 *   3. 通知が落ちたときに回答の保存まで失敗する(副作用が本体を巻き込む)。
 *   4. 別アカウントのフォーム回答が、こちらのアカウントの通知として出る。
 *   5. 受け付けなかった回答(必須未入力・Webhook 却下)でも通知が出る。
 *
 * 発火は waitUntil の中なので、ExecutionContext は渡された Promise を集めて
 * 明示的に待つ。投げっぱなしにすると「出ていない」のか「まだ走っていない」
 * のか見分けられない。
 *
 * 通知の中身(誰へどの経路で送るか)は
 * services/operator-notification-dispatch.test.ts が実 DB で見ている。
 * ここは「フォーム回答という業務イベントから、正しい引数で1回だけ入るか」
 * に絞る。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Env } from '../index.js';

const dispatchOperatorEvent = vi.hoisted(() => vi.fn());
vi.mock('../services/operator-notification-dispatch.js', () => ({ dispatchOperatorEvent }));
// 本人確認と LINE 送信は対象外。回答の成否と運用者通知だけを見る。
vi.mock('../services/liff-auth.js', () => ({
  verifyCallerLineIdentity: vi.fn(async (auth: string | undefined) => {
    if (auth === 'Bearer user-b') return { lineUserId: 'U-b-1', lineAccountId: OTHER_ACCOUNT };
    if (auth === 'Bearer none') return null;
    return { lineUserId: 'U-a-1', lineAccountId: ACCOUNT };
  }),
}));
vi.mock('../services/line-proxy-send.js', () => ({
  pushViaHarnessProxy: vi.fn(async () => undefined),
}));
vi.mock('../services/local-line-proxy.js', () => ({
  dispatchLineProxyLocally: vi.fn(async () => new Response(null, { status: 200 })),
}));

const ACCOUNT = 'account-a';
const OTHER_ACCOUNT = 'account-b';

const { forms } = await import('./forms.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = readFileSync(
  join(HERE, '..', '..', '..', '..', 'packages', 'db', 'bootstrap.sql'),
  'utf8',
);

const TEXT_LAYOUT = JSON.stringify({
  sections: [{
    id: 's1',
    blocks: [{ id: 'b1', kind: 'input', type: 'text', name: 'full_name', label: 'お名前', required: true }],
  }],
  options: {},
});

/** better-sqlite3 を D1 の口へ。 */
function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes }, results: [] } as T;
      },
    } as unknown as D1PreparedStatement);
    return bound([]);
  }
  return { prepare } as unknown as D1Database;
}

/**
 * waitUntil に渡された Promise を集めて、明示的に待てるようにする。
 *
 * 拒否は握り潰さず `settle()` の戻りで返す。allSettled で飲み込むと
 * 「副作用が自分で後始末しているか」を見張れなくなり、後始末を外しても
 * 緑のままになる。
 */
function collectingExecCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => { pending.push(promise); },
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  return {
    ctx,
    /** @returns waitUntil の外まで漏れた拒否の理由。空なら誰も漏らしていない。 */
    async settle(): Promise<unknown[]> {
      const escaped: unknown[] = [];
      while (pending.length > 0) {
        const results = await Promise.allSettled(pending.splice(0));
        for (const result of results) {
          if (result.status === 'rejected') escaped.push(result.reason);
        }
      }
      return escaped;
    },
  };
}

describe('N-327 #663 フォームの回答から運用者通知を自動発火する', () => {
  let sqlite: Database.Database;
  let app: Hono<Env>;
  let env: { DB: D1Database; LINE_CHANNEL_ACCESS_TOKEN: string; WORKER_URL: string };

  beforeEach(() => {
    dispatchOperatorEvent.mockReset();
    dispatchOperatorEvent.mockResolvedValue(undefined);

    sqlite = new Database(':memory:');
    sqlite.exec(BOOTSTRAP);
    sqlite.exec(`
      INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant-1', 'T1');
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
      VALUES ('${ACCOUNT}', 'ch-a', 'A店', 'tok-a', 'sec-a', 'tenant-1'),
             ('${OTHER_ACCOUNT}', 'ch-b', 'B店', 'tok-b', 'sec-b', 'tenant-1');
      INSERT INTO friends (id, line_user_id, line_account_id, display_name)
      VALUES ('friend-a', 'U-a-1', '${ACCOUNT}', '回答者A'),
             ('friend-b', 'U-b-1', '${OTHER_ACCOUNT}', '回答者B');
      INSERT INTO forms (id, name, fields, layout, save_to_metadata, is_active, submit_count)
      VALUES ('form-a', 'お問い合わせ', '[]', '${TEXT_LAYOUT}', 0, 1, 0),
             ('form-b', 'B店の問い合わせ', '[]', '${TEXT_LAYOUT}', 0, 1, 0);
      INSERT INTO forms (id, name, fields, layout, save_to_metadata, is_active, submit_count,
        on_submit_webhook_url, on_submit_webhook_fail_message)
      VALUES ('form-webhook', '審査つき', '[]', '${TEXT_LAYOUT}', 0, 1, 0,
        'https://verify.example.test/verify', '確認できませんでした');
      INSERT INTO form_accounts (form_id, line_account_id)
      VALUES ('form-a', '${ACCOUNT}'), ('form-webhook', '${ACCOUNT}'), ('form-b', '${OTHER_ACCOUNT}');
    `);

    app = new Hono<Env>();
    app.route('/', forms);
    env = {
      DB: asD1(sqlite),
      LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
      WORKER_URL: 'https://worker.example.test',
    };
  });

  afterEach(() => {
    sqlite.close();
    vi.unstubAllGlobals();
  });

  function submit(
    exec: ExecutionContext,
    options: { key: string; formId?: string; bearer?: string; data?: Record<string, unknown> },
  ) {
    return app.request(
      `/api/forms/${options.formId ?? 'form-a'}/submit`,
      {
        method: 'POST',
        body: JSON.stringify({ data: options.data ?? { full_name: '山田' } }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': options.key,
          Authorization: `Bearer ${options.bearer ?? 'user-a'}`,
        },
      },
      env as unknown as Env['Bindings'],
      exec,
    );
  }

  function submissionRows() {
    return sqlite.prepare(`SELECT id, form_id, friend_id FROM form_submissions ORDER BY id`).all() as
      Array<{ id: string; form_id: string; friend_id: string }>;
  }

  const KEY_A = 'aaaaaaaa-1111-4333-8444-666666666601';
  const KEY_B = 'aaaaaaaa-1111-4333-8444-666666666602';

  test('回答が保存されたら、回答IDを発生元にして運用者通知を1回出す', async () => {
    const { ctx, settle } = collectingExecCtx();

    const response = await submit(ctx, { key: KEY_A });
    await settle();

    expect(response.status).toBe(201);
    const rows = submissionRows();
    expect(rows).toHaveLength(1);
    expect(dispatchOperatorEvent).toHaveBeenCalledTimes(1);
    expect(dispatchOperatorEvent).toHaveBeenCalledWith(
      env.DB,
      expect.anything(),
      expect.objectContaining({
        lineAccountId: ACCOUNT,
        eventType: 'form_submitted',
        sourceEventId: rows[0].id,
        executionMode: 'automatic',
      }),
    );
  });

  test('同じ Idempotency-Key の再送では回答も通知も増えない', async () => {
    const first = collectingExecCtx();
    expect((await submit(first.ctx, { key: KEY_A })).status).toBe(201);
    await first.settle();

    const second = collectingExecCtx();
    const response = await submit(second.ctx, { key: KEY_A });
    await second.settle();

    expect(response.status).toBe(200);
    expect(response.headers.get('Idempotency-Replayed')).toBe('true');
    expect(submissionRows()).toHaveLength(1);
    expect(dispatchOperatorEvent).toHaveBeenCalledTimes(1);
  });

  test('必須が埋まっていない回答は保存も通知もしない', async () => {
    const { ctx, settle } = collectingExecCtx();

    const response = await submit(ctx, { key: KEY_A, data: {} });
    await settle();

    expect(response.status).toBe(400);
    expect(submissionRows()).toHaveLength(0);
    expect(dispatchOperatorEvent).not.toHaveBeenCalled();
  });

  test('Webhook に断られた回答は記録だけ残し、運用者通知は出さない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ eligible: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    const { ctx, settle } = collectingExecCtx();

    const response = await submit(ctx, { key: KEY_A, formId: 'form-webhook' });
    await settle();

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ data: { webhookPassed: false } });
    // 記録としての回答行は残る。だが受理していないので通知は出さない。
    expect(submissionRows()).toHaveLength(1);
    expect(dispatchOperatorEvent).not.toHaveBeenCalled();
  });

  test('通知が落ちても回答は保存し、拒否を外へ漏らさない', async () => {
    dispatchOperatorEvent.mockRejectedValueOnce(new Error('dispatch unavailable'));
    const { ctx, settle } = collectingExecCtx();

    const response = await submit(ctx, { key: KEY_A });
    const escaped = await settle();

    expect(response.status).toBe(201);
    expect(submissionRows()).toHaveLength(1);
    // 通知の失敗は発火側で後始末する。ここへ漏れていたら後始末が外れている。
    expect(escaped).toEqual([]);
  });

  test('別アカウントのフォーム回答は、そのアカウントの通知として出す', async () => {
    const { ctx, settle } = collectingExecCtx();

    const response = await submit(ctx, { key: KEY_B, formId: 'form-b', bearer: 'user-b' });
    await settle();

    expect(response.status).toBe(201);
    expect(dispatchOperatorEvent).toHaveBeenCalledTimes(1);
    const [, , input] = dispatchOperatorEvent.mock.calls[0] as [
      unknown, unknown, { lineAccountId: string },
    ];
    expect(input.lineAccountId).toBe(OTHER_ACCOUNT);
  });

  test('本人確認が通らない要求では回答も通知も作らない', async () => {
    const { ctx, settle } = collectingExecCtx();

    const response = await submit(ctx, { key: KEY_A, bearer: 'none' });
    await settle();

    expect(response.status).toBe(401);
    expect(submissionRows()).toHaveLength(0);
    expect(dispatchOperatorEvent).not.toHaveBeenCalled();
  });
});
