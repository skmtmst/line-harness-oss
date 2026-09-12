import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test as vitestTest, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { AsyncTestScope } from '../test-utils/async-test-scope.js';

/**
 * フォーム回答の冪等化の実DBテスト(N-165)。
 *
 * 本物の bootstrap.sql を better-sqlite3 に流し、本物の @line-crm/db
 * ヘルパーと本物の送信口で動かす。差し替えるのは本人確認・LINE送信・
 * Webhook の fetch だけ。真の Promise.all 並行でも予約の主キーが片方だけを
 * 通し、外部副作用は1回になることを見る。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = readFileSync(join(HERE, '..', '..', '..', '..', 'packages', 'db', 'bootstrap.sql'), 'utf8');

const KEY = 'aaaaaaaa-1111-4333-8444-666666666666';

const TEXT_LAYOUT = JSON.stringify({
  sections: [{ id: 's1', blocks: [{ id: 'b1', kind: 'input', type: 'text', name: 'full_name', label: 'お名前', required: true }] }],
  options: {},
});

const TAG_LAYOUT = JSON.stringify({
  sections: [{
    id: 's1',
    blocks: [
      { id: 'b1', kind: 'input', type: 'text', name: 'full_name', label: 'お名前', required: true },
      {
        id: 'b2',
        kind: 'input',
        type: 'radio',
        name: 'pet',
        label: '飼っている子',
        choiceMode: 'tag',
        choices: [{ id: 'c1', label: '犬', tagId: 'tag-dog' }],
      },
    ],
  }],
  options: {},
});

type Inject = { match: string; error: Error } | null;

function asD1(sqlite: Database.Database, injected: { current: Inject }) {
  function prepare(query: string): D1PreparedStatement {
    if (injected.current && query.includes(injected.current.match)) {
      const failure = injected.current;
      injected.current = null;
      throw failure.error;
    }
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

const pushCalls: Array<{ to: string; messages: unknown[]; retryKey: string }> = [];

vi.mock('../services/liff-auth.js', () => ({
  verifyCallerLineIdentity: vi.fn(async (auth: string | null) => {
    if (auth === 'Bearer user-2') return { lineUserId: 'U-2', lineAccountId: 'account-a' };
    return { lineUserId: 'U-1', lineAccountId: 'account-a' };
  }),
}));

vi.mock('../services/line-proxy-send.js', () => ({
  pushViaHarnessProxy: vi.fn(async (_origin: string, _token: string, to: string, messages: unknown[], retryKey: string) => {
    pushCalls.push({ to, messages, retryKey });
  }),
}));

vi.mock('../services/local-line-proxy.js', () => ({
  dispatchLineProxyLocally: vi.fn(async () => new Response(null, { status: 200 })),
}));

import { forms } from './forms.js';

let sqlite: Database.Database;
let injected: { current: Inject };
let scope: AsyncTestScope;

// A timeout rejects Vitest's wrapper, not this body. Keep owning the body until
// its requests, assertions and finally blocks have settled in afterEach.
function test(name: string, body: () => Promise<void>) {
  vitestTest(name, () => scope.run(body));
}

function setupDb() {
  sqlite = new Database(':memory:');
  sqlite.exec(BOOTSTRAP);
  sqlite.exec(`
    INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant-1', 'T1');
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES ('account-a', 'ch-a', 'A', 'tok-a', 'sec-a', 'tenant-1');
    INSERT INTO friends (id, line_user_id, line_account_id, display_name)
    VALUES ('friend-1', 'U-1', 'account-a', '一郎'),
           ('friend-2', 'U-2', 'account-a', '二郎');
    INSERT INTO forms (id, name, fields, layout, save_to_metadata, is_active, submit_count,
      on_submit_webhook_url, on_submit_webhook_fail_message)
    VALUES ('form-webhook', 'W', '[]', '${TEXT_LAYOUT}', 0, 1, 0,
      'https://verify.example.test/verify', '確認できませんでした');
    INSERT INTO forms (id, name, fields, layout, save_to_metadata, is_active, submit_count)
    VALUES ('form-tag', 'T', '[]', '${TAG_LAYOUT}', 0, 1, 0);
    INSERT INTO form_accounts (form_id, line_account_id)
    VALUES ('form-webhook', 'account-a'), ('form-tag', 'account-a');
    INSERT INTO tags (id, name) VALUES ('tag-dog', '犬');
  `);
  injected = { current: null };
}

function env() {
  return {
    DB: asD1(sqlite, injected),
    IMAGES: { put: vi.fn() } as unknown as R2Bucket,
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    WORKER_URL: 'https://worker.example.test',
  } as Env['Bindings'];
}

function app() {
  const a = new Hono<Env>();
  a.route('/', forms);
  return {
    fetch: (...args: Parameters<typeof a.fetch>) => scope.track(Promise.resolve(a.fetch(...args))),
  };
}

function submitRequest(formId: string, data: Record<string, unknown>, key: string, bearer: string) {
  return new Request(`https://worker.example.test/api/forms/${formId}/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify({ data }),
  });
}

function count(table: string, where = '1 = 1'): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
}

function claimStatus(key: string, friendId: string): string | null {
  const row = sqlite.prepare(
    `SELECT status FROM form_submit_claims WHERE idempotency_key = ? AND friend_id = ?`,
  ).get(key, friendId) as { status: string } | undefined;
  return row?.status ?? null;
}

function answerIdOf(key: string, friendId: string): string {
  const row = sqlite.prepare(
    `SELECT submission_id FROM form_submit_claims WHERE idempotency_key = ? AND friend_id = ?`,
  ).get(key, friendId) as { submission_id: string };
  return row.submission_id;
}

function delay(ms: number) {
  const gate = scope.gate(() => undefined);
  const timer = setTimeout(() => gate.resolve(undefined), ms);
  return scope.track(gate.promise.finally(() => clearTimeout(timer)));
}

beforeEach(() => {
  scope = new AsyncTestScope();
  vi.clearAllMocks();
  pushCalls.length = 0;
  setupDb();
});

afterEach(async () => {
  // Release fake I/O first, then join work, then restore globals/close the DB.
  // Never clear the next test's counters while an old request can still send.
  await scope.dispose();
  sqlite.close();
  vi.unstubAllGlobals();
});

describe('フォーム回答の冪等化(実DB)', () => {
  // Deliberately do not wrap these two probes with scope.run: the test itself
  // stands in for afterEach after Vitest has stopped awaiting the original body.
  vitestTest('#757 cleanup waits for the real request and its body continuation', async () => {
    const gate = scope.gate(() => new Response(JSON.stringify({ eligible: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', vi.fn(async () => gate.promise));
    let bodyFinished = false;
    const body = scope.run(async () => {
      const response = await app().fetch(submitRequest('form-webhook', { full_name: '山田' }, KEY, 'user-1'), env());
      expect(response.status).toBe(201);
      await response.json();
      bodyFinished = true;
    });
    await scope.dispose();
    expect(bodyFinished).toBe(true);
    expect(pushCalls).toHaveLength(1);
    expect(claimStatus(KEY, 'friend-1')).toBe('completed');
    await body;
  });

  vitestTest('#757 cleanup also owns an HTTP request abandoned by a failed assertion', async () => {
    const gate = scope.gate(() => new Response(JSON.stringify({ eligible: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', vi.fn(async () => gate.promise));
    const request = app().fetch(submitRequest('form-webhook', { full_name: '山田' }, KEY, 'user-1'), env());
    // No body awaits this request: this models an assertion failing before join.
    await scope.dispose();
    expect(pushCalls).toHaveLength(1);
    expect(claimStatus(KEY, 'friend-1')).toBe('completed');
    expect((await request).status).toBe(201);
  });

  test('真の並行2要求でも回答・Webhook・通知・マイルは1回だけ', async () => {
    const held = scope.gate(() => new Response(JSON.stringify({ eligible: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const gate = held.promise;
    const release = held.resolve;
    const fetchMock = vi.fn(async () => gate);
    vi.stubGlobal('fetch', fetchMock);

    const first = app().fetch(submitRequest('form-webhook', { full_name: '山田' }, KEY, 'user-1'), env());
    await delay(30);
    const second = app().fetch(submitRequest('form-webhook', { full_name: '山田' }, KEY, 'user-1'), env());
    const settledSecond = await Promise.race([second, delay(2000).then(() => 'TIMEOUT' as const)]);
    release(new Response(JSON.stringify({ eligible: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const firstRes = await first;
    const secondRes = settledSecond === 'TIMEOUT' ? await second : settledSecond;

    const statuses = [firstRes.status, secondRes.status];
    expect(statuses).toContain(201);
    const other = statuses.find((status) => status !== 201);
    expect(other === 200 || other === 429).toBe(true);

    // 実DBで数える。外部への呼び出しは勝った側の1回だけ。
    expect(count('form_submissions')).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pushCalls.length).toBe(1);
    const answerId = answerIdOf(KEY, 'friend-1');
    // LINE 再送キーは UUID 形の固定値。
    expect(pushCalls[0].retryKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(count('engagement_events', `source = 'form' AND source_event_id = '${answerId}'`)).toBe(1);
    expect((sqlite.prepare(`SELECT submit_count AS n FROM forms WHERE id = 'form-webhook'`).get() as { n: number }).n).toBe(1);
    const claim = sqlite.prepare(
      `SELECT tenant_id, line_account_id, status FROM form_submit_claims WHERE idempotency_key = ?`,
    ).get(KEY) as { tenant_id: string; line_account_id: string; status: string };
    expect(claim.tenant_id).toBe('tenant-1');
    expect(claim.line_account_id).toBe('account-a');
  });

  test('成功後のDB失敗は500にし、同じキーで再開して補完する', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ eligible: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    injected.current = { match: 'submit_count = (SELECT', error: new Error('D1 UPDATE failed') };
    const failed = await app().fetch(submitRequest('form-webhook', { full_name: '山田' }, KEY, 'user-1'), env());
    expect(failed.status).toBe(500);
    expect(count('form_submissions')).toBe(1);
    expect(claimStatus(KEY, 'friend-1')).toBe('failed');

    const resumed = await app().fetch(submitRequest('form-webhook', { full_name: '山田' }, KEY, 'user-1'), env());
    expect(resumed.status).toBe(200);
    expect(count('form_submissions')).toBe(1);
    expect(claimStatus(KEY, 'friend-1')).toBe('completed');
    const answerId = answerIdOf(KEY, 'friend-1');
    expect(count('engagement_events', `source = 'form' AND source_event_id = '${answerId}'`)).toBe(1);
    expect(pushCalls.length).toBe(1);
    expect(pushCalls[0].retryKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  test('マイル付与のDB失敗は202で未完を返し、再送で付け直す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ eligible: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    injected.current = { match: 'INTO engagement_events', error: new Error('D1 INSERT failed') };
    const first = await app().fetch(submitRequest('form-webhook', { full_name: '山田' }, KEY, 'user-1'), env());
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as {
      data: { complete: boolean; pendingEffects: string[] };
    };
    expect(firstBody.data.complete).toBe(false);
    expect(firstBody.data.pendingEffects).toContain('mileage');
    expect(claimStatus(KEY, 'friend-1')).toBe('failed');

    const resumed = await app().fetch(submitRequest('form-webhook', { full_name: '山田' }, KEY, 'user-1'), env());
    expect(resumed.status).toBe(200);
    expect(claimStatus(KEY, 'friend-1')).toBe('completed');
    const answerId = answerIdOf(KEY, 'friend-1');
    expect(count('engagement_events', `source = 'form' AND source_event_id = '${answerId}'`)).toBe(1);
    // 成功済みの確認返信は重ねない
    expect(pushCalls.length).toBe(1);
  });

  test('レイアウトの部分失敗は欠落を固定せず、再送で補完する', async () => {
    injected.current = { match: 'INTO friend_tags', error: new Error('D1 INSERT failed') };
    const first = await app().fetch(submitRequest('form-tag', { full_name: '山田', pet: '犬' }, KEY, 'user-1'), env());
    expect(first.status).toBe(202);
    expect(claimStatus(KEY, 'friend-1')).toBe('failed');
    expect(count('friend_tags', `friend_id = 'friend-1'`)).toBe(0);

    const resumed = await app().fetch(submitRequest('form-tag', { full_name: '山田', pet: '犬' }, KEY, 'user-1'), env());
    expect(resumed.status).toBe(200);
    expect(claimStatus(KEY, 'friend-1')).toBe('completed');
    expect(count('friend_tags', `friend_id = 'friend-1'`)).toBe(1);
    expect(count('form_submissions')).toBe(1);
    expect(pushCalls.length).toBe(1);
  });

  test('別 scope(友だち違い)の同じキーは独立に成功する', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ eligible: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    const first = await app().fetch(submitRequest('form-webhook', { full_name: '山田' }, KEY, 'user-1'), env());
    expect(first.status).toBe(201);
    const second = await app().fetch(submitRequest('form-webhook', { full_name: '山田' }, KEY, 'user-2'), env());
    expect(second.status).toBe(201);
    expect(count('form_submissions')).toBe(2);
  });

  test('キーなし送信は400で断る', async () => {
    const res = await app().fetch(new Request('https://worker.example.test/api/forms/form-webhook/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-1' },
      body: JSON.stringify({ data: { full_name: '山田' } }),
    }), env());
    expect(res.status).toBe(400);
    expect(count('form_submissions')).toBe(0);
  });

  test('実DBの2接続でも真の並行2要求は回答・副作用1回だけ', async () => {
    // 単一 :memory: 接続ではなく、同じファイル DB への2接続で競合させる。
    // (D1 の並行に近い形。better-sqlite3 は同期実行なので、文単位の原子性と
    // 主キー調停・接続をまたいだ可視性を見る)
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'form-2conn-'));
    const file = join(dir, 'test.sqlite');
    const primary = new Database(file);
    primary.exec(BOOTSTRAP);
    primary.exec(`PRAGMA journal_mode=WAL;`);
    primary.exec(`
    INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant-1', 'T1');
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES ('account-a', 'ch-a', 'A', 'tok-a', 'sec-a', 'tenant-1');
    INSERT INTO friends (id, line_user_id, line_account_id, display_name)
    VALUES ('friend-1', 'U-1', 'account-a', '一郎');
    INSERT INTO forms (id, name, fields, layout, save_to_metadata, is_active, submit_count)
    VALUES ('form-2conn', 'C', '[]', '${TEXT_LAYOUT}', 0, 1, 0);
    INSERT INTO form_accounts (form_id, line_account_id)
    VALUES ('form-2conn', 'account-a');
    `);
    const secondary = new Database(file);
    secondary.exec(`PRAGMA journal_mode=WAL;`);
    const injected2: { current: Inject } = { current: null };
    const env1 = { ...env(), DB: asD1(primary, injected) };
    const env2 = { ...env(), DB: asD1(secondary, injected2) };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ eligible: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const [res1, res2] = await Promise.all([
        app().fetch(submitRequest('form-2conn', { full_name: '山田' }, KEY, 'user-1'), env1),
        app().fetch(submitRequest('form-2conn', { full_name: '山田' }, KEY, 'user-1'), env2),
      ]);
      const statuses = [res1.status, res2.status];
      expect(statuses).toContain(201);
      const other = statuses.find((status) => status !== 201);
      expect(other === 200 || other === 429).toBe(true);
      const answers = primary.prepare(`SELECT COUNT(*) AS n FROM form_submissions`).get() as { n: number };
      expect(answers.n).toBe(1);
      // 別接続からも1行に見える。
      const seen = secondary.prepare(`SELECT COUNT(*) AS n FROM form_submissions`).get() as { n: number };
      expect(seen.n).toBe(1);
      expect(pushCalls.length).toBe(1);
      const claim = primary.prepare(
        `SELECT status, version, lease_generation FROM form_submit_claims WHERE idempotency_key = ?`,
      ).get(KEY) as { status: string; version: number; lease_generation: number };
      expect(claim.status).toBe('completed');
    } finally {
      primary.close();
      secondary.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Webhook送達後の記録失敗は実DBの再送で呼び直さない', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => new Response(
      JSON.stringify({ eligible: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    // 配達はできたが結果の記録だけ落ちた(送達後の停止)。
    injected.current = { match: 'SET webhook = ?', error: new Error('D1 UPDATE failed') };
    const lost = await app().fetch(submitRequest('form-webhook', { full_name: '山田' }, KEY, 'user-1'), env());
    expect(lost.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(claimStatus(KEY, 'friend-1')).toBe('failed');

    const resumed = await app().fetch(submitRequest('form-webhook', { full_name: '山田' }, KEY, 'user-1'), env());
    expect(resumed.status).toBe(200);
    // outbox に配達済みの結果があるので呼び直さない。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(count('form_submissions')).toBe(1);
    expect(claimStatus(KEY, 'friend-1')).toBe('completed');
    expect(pushCalls.length).toBe(1);
  });

  test('配達の記録が落ちた再開は実DBでも同じ event id で呼び直す', async () => {
    const seenEvents: Array<unknown> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      seenEvents.push((init?.headers as Record<string, string> | undefined)?.['X-Form-Event-Id']);
      return new Response(JSON.stringify({ eligible: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    injected.current = { match: 'UPDATE form_submit_outbox', error: new Error('D1 UPDATE failed') };
    const lost = await app().fetch(submitRequest('form-webhook', { full_name: '山田' }, KEY, 'user-1'), env());
    expect(lost.status).toBe(500);

    const resumed = await app().fetch(submitRequest('form-webhook', { full_name: '山田' }, KEY, 'user-1'), env());
    expect(resumed.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seenEvents[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(seenEvents[1]).toBe(seenEvents[0]);
    expect(claimStatus(KEY, 'friend-1')).toBe('completed');
  });

  test('キーが変わっても同じ内容の未完があれば元のキーへ誘導する(実DB)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ eligible: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    injected.current = { match: 'submit_count = (SELECT', error: new Error('D1 UPDATE failed') };
    const failed = await app().fetch(submitRequest('form-webhook', { full_name: '山田' }, KEY, 'user-1'), env());
    expect(failed.status).toBe(500);

    const guided = await app().fetch(
      submitRequest('form-webhook', { full_name: '山田' }, 'bbbbbbbb-2222-4333-8444-666666666666', 'user-1'),
      env(),
    );
    expect(guided.status).toBe(409);
    const guidedBody = (await guided.json()) as { code: string; retryable: boolean; idempotencyKey: string };
    expect(guidedBody.code).toBe('idempotency_recovery_pending');
    expect(guidedBody.retryable).toBe(true);
    expect(guidedBody.idempotencyKey).toBe(KEY);
    expect(count('form_submissions')).toBe(1);

    const resumed = await app().fetch(submitRequest('form-webhook', { full_name: '山田' }, KEY, 'user-1'), env());
    expect(resumed.status).toBe(200);
    expect(count('form_submissions')).toBe(1);
    expect(claimStatus(KEY, 'friend-1')).toBe('completed');
  });

  test('形の違う回答・リンク指定は実DBに触れる前に400', async () => {
    const arrayBody = await app().fetch(new Request('https://worker.example.test/api/forms/form-webhook/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer user-1',
        'Idempotency-Key': KEY,
      },
      body: JSON.stringify({ data: ['山田'] }),
    }), env());
    expect(arrayBody.status).toBe(400);

    const badLink = await app().fetch(new Request('https://worker.example.test/api/forms/form-webhook/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer user-1',
        'Idempotency-Key': KEY,
      },
      body: JSON.stringify({ data: { full_name: '山田' }, trackedLinkId: 'x'.repeat(129) }),
    }), env());
    expect(badLink.status).toBe(400);
    expect(count('form_submissions')).toBe(0);
    expect(count('form_submit_claims')).toBe(0);
  });
});
