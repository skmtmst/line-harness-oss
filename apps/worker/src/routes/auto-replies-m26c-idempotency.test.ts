import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { autoReplies } from './auto-replies.js';

/*
 * m26c R556/R570: 作成・複製の再送を1件化する（migration 543）。
 * 実 Hono ルート＋実 SQLite（bootstrap.sql）で確かめる。
 *
 * 期待する姿（いずれも現状は赤）:
 * - R556: 下書き付き作成の再送は同じ下書きへ復帰し、2件にならない。
 * - R570: 直接作成の再送は同じ行を返し、2行にならない。
 * - 同じキーに異なる内容が来たら作らず止める（409）。
 * - 同時実行でも1行に収まる。
 */

const owner: AuthenticatedStaff = {
  id: 'owner-a',
  name: '統括',
  role: 'owner',
  readOnly: false,
  tenantId: 'tenant-a',
};

function buildApp(db: D1Database) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', owner);
    await next();
  });
  instance.route('/', autoReplies);
  return {
    instance,
    bindings: { DB: db, WORKER_URL: 'https://worker.test' } as Env['Bindings'],
  };
}

function jsonRequest(method: string, body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

function seedBase(raw: SqliteD1['raw']): void {
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-a', 'A統括')`).run();
  raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES ('account-a', 'ch-a', 'A店', '', '', 1, 'tenant-a')`,
  ).run();
  raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-a', '統括', 'owner', 'key-owner-a', 'tenant-a', 'all')`,
  ).run();
}

const DRAFT_BODY = {
  keyword: '予約',
  matchType: 'contains',
  responseType: 'text',
  responseContent: '承りました',
  lineAccountId: 'account-a',
};

const RULE_BODY = {
  keyword: '予約',
  matchType: 'contains',
  responseType: 'text',
  responseContent: '稼働中の回答',
  lineAccountId: 'account-a',
  isActive: false,
};

function countRules(raw: SqliteD1['raw']): number {
  return (raw.prepare(`SELECT COUNT(*) AS n FROM auto_replies`).get() as { n: number }).n;
}

/*
 * 試験台の直列化。better-sqlite3 は1接続で batch（BEGIN..COMMIT）の
 * 多重実行ができない。本番 D1 の直列化可能な書込と同じ順序意味にするため、
 * batch だけを順番待ちにする。SELECT の並行はそのまま。
 * 実線の並行（2接続の同時書込）の再現ではなく、収束の不変量
 *（同じキー→同じID・1行）を見るための措置。環境限界として明記する。
 */
function serializedDb(testDb: SqliteD1): D1Database & {
  armBeforeFirstBatch: (fn: () => Promise<void>) => void;
} {
  let tail: Promise<unknown> = Promise.resolve();
  let beforeFirstBatch: (() => Promise<void>) | null = null;
  const native = testDb.db as unknown as {
    prepare: (sql: string) => unknown;
    batch: (statements: unknown[]) => Promise<unknown[]>;
  };
  return {
    prepare: (sql: string) => native.prepare(sql),
    batch: (statements: unknown[]) => {
      const run = async () => {
        if (beforeFirstBatch) {
          const hook = beforeFirstBatch;
          beforeFirstBatch = null;
          await hook();
        }
        return native.batch(statements);
      };
      const result = tail.then(run, run);
      tail = result.catch(() => null);
      return result;
    },
    armBeforeFirstBatch: (fn: () => Promise<void>) => {
      beforeFirstBatch = fn;
    },
  } as unknown as D1Database & { armBeforeFirstBatch: (fn: () => Promise<void>) => void };
}

describe('m26c R556: 複製・下書き作成の再送は1件', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedBase(testDb.raw);
  });

  it('同じ確認キーの再送は同じ下書きへ復帰する', async () => {
    const target = buildApp(testDb.db);
    const key = 'dup-key-r556-0001-aaaaaaaa';

    const first = await target.instance.request(
      '/api/auto-replies/drafts',
      jsonRequest('POST', DRAFT_BODY, { 'Idempotency-Key': key }),
      target.bindings,
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as {
      data: { autoReplyId: string; versionId: string; versionNumber: number };
    };

    // 応答を失った想定でもう一度送る。
    const second = await target.instance.request(
      '/api/auto-replies/drafts',
      jsonRequest('POST', DRAFT_BODY, { 'Idempotency-Key': key }),
      target.bindings,
    );
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as {
      data: { autoReplyId: string; versionId: string };
    };
    expect(secondBody.data.autoReplyId).toBe(firstBody.data.autoReplyId);
    expect(secondBody.data.versionId).toBe(firstBody.data.versionId);
    expect(countRules(testDb.raw)).toBe(1);
  });

  it('同じキーに異なる内容が来たら作らず止める', async () => {
    const target = buildApp(testDb.db);
    const key = 'dup-key-r556-0002-aaaaaaaa';

    const first = await target.instance.request(
      '/api/auto-replies/drafts',
      jsonRequest('POST', DRAFT_BODY, { 'Idempotency-Key': key }),
      target.bindings,
    );
    expect(first.status).toBe(201);

    const other = await target.instance.request(
      '/api/auto-replies/drafts',
      jsonRequest('POST', { ...DRAFT_BODY, responseContent: '別内容' }, { 'Idempotency-Key': key }),
      target.bindings,
    );
    expect(other.status).toBe(409);
    expect(countRules(testDb.raw)).toBe(1);
  });

  it('同時実行でも下書きは1件に収まる（201のみ・500は認めない）', async () => {
    const target = buildApp(serializedDb(testDb));
    const key = 'dup-key-r556-0003-aaaaaaaa';
    const send = () => target.instance.request(
      '/api/auto-replies/drafts',
      jsonRequest('POST', DRAFT_BODY, { 'Idempotency-Key': key }),
      target.bindings,
    );

    // 製品 API の 500 は正常扱いにしない。201 または処理中の 409 のみ。
    const [a, b] = await Promise.all([send(), send()]);
    expect([201, 409]).toContain(a.status);
    expect([201, 409]).toContain(b.status);
    const ids = new Set<string>();
    for (const res of [a, b]) {
      if (res.status === 201) {
        const body = (await res.json()) as { data: { autoReplyId: string; versionId: string } };
        ids.add(`${body.data.autoReplyId}:${body.data.versionId}`);
      } else {
        // 処理中の割込みは再送で同じ ID へ収束させる。
        const retry = await send();
        expect(retry.status).toBe(201);
        const body = (await retry.json()) as { data: { autoReplyId: string; versionId: string } };
        ids.add(`${body.data.autoReplyId}:${body.data.versionId}`);
      }
    }
    expect(ids.size).toBe(1);
    expect(countRules(testDb.raw)).toBe(1);
  });

  it('勝者確定後の負け側 batch は保存済みを返す（決定的な割込み）', async () => {
    const wrapped = serializedDb(testDb);
    const target = buildApp(wrapped);
    const key = 'dup-key-r556-0004-aaaaaaaa';
    const send = () => target.instance.request(
      '/api/auto-replies/drafts',
      jsonRequest('POST', DRAFT_BODY, { 'Idempotency-Key': key }),
      target.bindings,
    );

    // 最初の batch の直前に別要求を完走させ、読取→書込のあいだの
    // 割込み（UNIQUE→勝者の再検索）を決定的に通す。
    let winnerId: string | null = null;
    wrapped.armBeforeFirstBatch(async () => {
      const rival = buildApp(testDb.db);
      const res = await rival.instance.request(
        '/api/auto-replies/drafts',
        jsonRequest('POST', DRAFT_BODY, { 'Idempotency-Key': key }),
        rival.bindings,
      );
      expect(res.status).toBe(201);
      winnerId = ((await res.json()) as { data: { autoReplyId: string } }).data.autoReplyId;
    });

    const res = await send();
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { autoReplyId: string } };
    expect(body.data.autoReplyId).toBe(winnerId);
    expect(countRules(testDb.raw)).toBe(1);
  });
});

describe('m26c R570: 直接作成の再送は同じ行', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedBase(testDb.raw);
  });

  it('同じ確認キーの再送は同じIDを返し1行だけ残る', async () => {
    const target = buildApp(testDb.db);
    const key = 'rule-key-r570-0001-aaaaaaaa';

    const first = await target.instance.request(
      '/api/auto-replies',
      jsonRequest('POST', RULE_BODY, { 'Idempotency-Key': key }),
      target.bindings,
    );
    expect(first.status).toBe(201);
    const firstId = ((await first.json()) as { data: { id: string } }).data.id;

    const second = await target.instance.request(
      '/api/auto-replies',
      jsonRequest('POST', RULE_BODY, { 'Idempotency-Key': key }),
      target.bindings,
    );
    expect(second.status).toBe(201);
    const secondId = ((await second.json()) as { data: { id: string } }).data.id;
    expect(secondId).toBe(firstId);
    expect(countRules(testDb.raw)).toBe(1);
  });

  it('同じキーに異なる内容が来たら作らず止める', async () => {
    const target = buildApp(testDb.db);
    const key = 'rule-key-r570-0002-aaaaaaaa';

    const first = await target.instance.request(
      '/api/auto-replies',
      jsonRequest('POST', RULE_BODY, { 'Idempotency-Key': key }),
      target.bindings,
    );
    expect(first.status).toBe(201);

    const other = await target.instance.request(
      '/api/auto-replies',
      jsonRequest('POST', { ...RULE_BODY, responseContent: '別内容' }, { 'Idempotency-Key': key }),
      target.bindings,
    );
    expect(other.status).toBe(409);
    expect(countRules(testDb.raw)).toBe(1);
  });

  it('下書き用と行用でキーを取り違えたら止める', async () => {
    const target = buildApp(testDb.db);
    const key = 'shared-key-r556-570-aaaaaaaa';

    const draft = await target.instance.request(
      '/api/auto-replies/drafts',
      jsonRequest('POST', DRAFT_BODY, { 'Idempotency-Key': key }),
      target.bindings,
    );
    expect(draft.status).toBe(201);

    const rule = await target.instance.request(
      '/api/auto-replies',
      jsonRequest('POST', RULE_BODY, { 'Idempotency-Key': key }),
      target.bindings,
    );
    expect(rule.status).toBe(409);
    expect(countRules(testDb.raw)).toBe(1);
  });

  it('キーが無ければ従来どおり2行になる（後方互換）', async () => {
    const target = buildApp(testDb.db);
    const first = await target.instance.request(
      '/api/auto-replies',
      jsonRequest('POST', RULE_BODY),
      target.bindings,
    );
    const second = await target.instance.request(
      '/api/auto-replies',
      jsonRequest('POST', RULE_BODY),
      target.bindings,
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(countRules(testDb.raw)).toBe(2);
  });
});
