import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { autoReplies } from './auto-replies.js';

/*
 * m26c: 自動応答の公開・権限・競合（R551/R552/R553/R554/R558 のサーバ側）。
 * 実 Hono ルート＋実 SQLite（bootstrap.sql）で、監査の隔離再現を最新枝で
 * やり直す。故障注入は D1  wrapper が行い、製品コードには触らない。
 *
 * 期待する姿（いずれも現状は赤）:
 * - R551: 版を進めずに保存するため、同じ expectedVersion の後続保存が通る。
 * - R552: 試験の記録時に内容の変わり目を見ないため、古い成功が新内容に付く。
 * - R553: 公開の読取と書込のあいだの編集を見ないため、公開版と稼働設定が食い違う。
 * - R554: 公開の直前の停止を見ないため、停止済みが再有効化される。
 * - R558: 公開後に下書きが無いと競合確認が 404 のため、完了 URL の再読込が壊れる。
 */

const owner: AuthenticatedStaff = {
  id: 'owner-a',
  name: '統括',
  role: 'owner',
  readOnly: false,
  tenantId: 'tenant-a',
};

function buildApp(db: D1Database, staff: AuthenticatedStaff = owner) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', staff);
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
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-a', 'A統括'), ('tenant-b', 'B統括')`).run();
  raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES ('account-a', 'ch-a', 'A店', '', '', 1, 'tenant-a'),
            ('account-b', 'ch-b', 'B店', '', '', 1, 'tenant-b')`,
  ).run();
  raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-a', '統括', 'owner', 'key-owner-a', 'tenant-a', 'all')`,
  ).run();
  raw.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id)
     VALUES ('friend-a', 'u-a', '友だちA', 'account-a')`,
  ).run();
}

const DRAFT_BODY = {
  keyword: '予約',
  matchType: 'contains',
  responseType: 'text',
  responseContent: '承りました',
  lineAccountId: 'account-a',
};

async function createRuleWithTestedDraft(
  target: ReturnType<typeof buildApp>,
  raw: SqliteD1['raw'],
  responseContent: string,
): Promise<{ ruleId: string; draftId: string }> {
  const created = await target.instance.request(
    '/api/auto-replies',
    jsonRequest('POST', {
      keyword: '予約',
      matchType: 'contains',
      responseType: 'text',
      responseContent,
      lineAccountId: 'account-a',
      isActive: false,
    }),
    target.bindings,
  );
  expect(created.status).toBe(201);
  const createdBody = (await created.json()) as { data: { id: string } };
  const ruleId = createdBody.data.id;
  const saved = await target.instance.request(
    `/api/auto-replies/${ruleId}/draft`,
    jsonRequest('PUT', { ...DRAFT_BODY, responseContent, expectedVersion: 1 }),
    target.bindings,
  );
  expect(saved.status).toBe(200);
  const savedBody = (await saved.json()) as { data: { versionId: string } };
  raw.prepare(`UPDATE auto_reply_versions SET last_test_status = 'succeeded' WHERE id = ?`)
    .run(savedBody.data.versionId);
  return { ruleId, draftId: savedBody.data.versionId };
}

/** D1 への故障注入。呼出側の SQL を見て、割込み書込・batch 失敗を再現する。 */
function makeFaultDb(testDb: SqliteD1): {
  db: D1Database;
  armRunHook: (match: (sql: string) => boolean, fn: () => void) => void;
  armBatchHook: (match: (sqls: string[]) => boolean, fn: () => void) => void;
  armFailBatch: (match: (sqls: string[]) => boolean) => void;
} {
  let runHook: { match: (sql: string) => boolean; fn: () => void } | null = null;
  let batchHook: { match: (sqls: string[]) => boolean; fn: () => void } | null = null;
  let failBatch: ((sqls: string[]) => boolean) | null = null;
  const wrapBound = (sql: string, bound: Record<string, (...args: never[]) => Promise<unknown>>) => ({
    sql,
    run: async (...args: never[]) => {
      if (runHook?.match(sql)) {
        const hook = runHook;
        runHook = null;
        hook.fn();
      }
      return bound.run(...args);
    },
    first: (...args: never[]) => bound.first(...args),
    all: (...args: never[]) => bound.all(...args),
  });
  const runWithHook = (sql: string, run: (...args: never[]) => Promise<unknown>) => {
    if (runHook?.match(sql)) {
      const hook = runHook;
      runHook = null;
      hook.fn();
    }
    return run;
  };
  const db = {
    prepare: (sql: string) => {
      const stmt = (testDb.db as unknown as {
        prepare: (sql: string) => {
          bind: (...args: unknown[]) => Record<string, (...args: never[]) => Promise<unknown>>;
          run: (...args: never[]) => Promise<unknown>;
          first: (...args: never[]) => Promise<unknown>;
          all: (...args: never[]) => Promise<unknown>;
        };
      }).prepare(sql);
      const direct = {
        run: (...args: never[]) => runWithHook(sql, stmt.run)(...args),
        first: (...args: never[]) => stmt.first(...args),
        all: (...args: never[]) => stmt.all(...args),
      };
      return {
        ...direct,
        bind: (...args: unknown[]) => wrapBound(sql, stmt.bind(...args)),
      };
    },
    batch: async (statements: Array<{ sql?: string }>) => {
      const sqls = statements.map((item) => item?.sql ?? '');
      if (batchHook?.match(sqls)) {
        const hook = batchHook;
        batchHook = null;
        hook.fn();
      }
      if (failBatch?.(sqls)) {
        failBatch = null;
        throw new Error('INJECTED_BATCH_FAILURE');
      }
      return (testDb.db as unknown as {
        batch: (statements: unknown[]) => Promise<unknown[]>;
      }).batch(statements);
    },
  } as unknown as D1Database;
  return {
    db,
    armRunHook: (match, fn) => {
      runHook = { match, fn };
    },
    armBatchHook: (match, fn) => {
      batchHook = { match, fn };
    },
    armFailBatch: (match) => {
      failBatch = match;
    },
  };
}

describe('m26c R551: 古い下書き画面が先行保存を上書きする', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedBase(testDb.raw);
  });

  it('同じ版からの後続保存は競合となり、先行内容を保つ', async () => {
    const target = buildApp(testDb.db);
    const created = await target.instance.request(
      '/api/auto-replies/drafts',
      jsonRequest('POST', DRAFT_BODY),
      target.bindings,
    );
    expect(created.status).toBe(201);

    const createdBody = (await created.json()) as {
      data: { autoReplyId: string; versionNumber: number };
    };
    const ruleId = createdBody.data.autoReplyId;
    expect(createdBody.data.versionNumber).toBe(1);

    // A が先に保存する。版は進む。
    const first = await target.instance.request(
      `/api/auto-replies/${ruleId}/draft`,
      jsonRequest('PUT', { ...DRAFT_BODY, responseContent: 'Aの内容', expectedVersion: 1 }),
      target.bindings,
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { data: { versionNumber: number } };
    expect(firstBody.data.versionNumber).toBe(2);

    // B は古い版番号のまま保存する。競合として止まる。
    const second = await target.instance.request(
      `/api/auto-replies/${ruleId}/draft`,
      jsonRequest('PUT', { ...DRAFT_BODY, responseContent: 'Bの内容', expectedVersion: 1 }),
      target.bindings,
    );
    expect(second.status).toBe(409);
    const secondBody = (await second.json()) as {
      code?: string;
      error: string;
      data?: { currentVersion?: number };
    };
    expect(secondBody.code).toBe('VERSION_CONFLICT');
    expect(secondBody.error).toContain('読み直し');
    expect(secondBody.data?.currentVersion).toBe(2);

    // 先行内容が保たれている。
    const reloaded = await target.instance.request(
      `/api/auto-replies/${ruleId}/draft`,
      {},
      target.bindings,
    );
    const reloadedBody = (await reloaded.json()) as {
      data: { settings: { responseContent: string } };
    };
    expect(reloadedBody.data.settings.responseContent).toBe('Aの内容');
  });
});

describe('m26c R552: 古い試験の遅延成功が編集後の内容へ成功印を付けない', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedBase(testDb.raw);
  });

  it('試験の記録直前に編集が入ったら、新内容へ成功印を付けず再試験を要求する', async () => {
    const fault = makeFaultDb(testDb);
    const target = buildApp(fault.db);
    const created = await target.instance.request(
      '/api/auto-replies/drafts',
      jsonRequest('POST', DRAFT_BODY),
      target.bindings,
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      data: { autoReplyId: string; versionId: string };
    };
    const { autoReplyId, versionId } = createdBody.data;

    // 試験結果の書込直前に、同じ下書きへの編集保存が割り込む。
    fault.armRunHook(
      (sql) => sql.includes('last_test_status'),
      () => {
        testDb.raw.prepare(
          `UPDATE auto_reply_versions
              SET definition_snapshot = ?, updated_at = ?
            WHERE id = ? AND status = 'draft'`,
        ).run(
          JSON.stringify({ keyword: '予約', responseContent: '編集中の本文' }),
          '2026-09-29T12:00:01+09:00',
          versionId,
        );
      },
    );

    const tested = await target.instance.request(
      `/api/auto-replies/${autoReplyId}/test`,
      jsonRequest('POST', { friendId: 'friend-a', incomingText: '予約したい' }),
      target.bindings,
    );
    expect(tested.status).toBe(200);
    const testedBody = (await tested.json()) as { data: { staleTest?: boolean } };
    // 内容が変わった試験は成功として扱わず、再試験を求める。
    expect(testedBody.data.staleTest).toBe(true);

    const version = testDb.raw.prepare(`SELECT last_test_status FROM auto_reply_versions WHERE id = ?`)
      .get(versionId) as { last_test_status: string | null };
    expect(version.last_test_status).toBeNull();
  });
});

describe('m26c R553: 公開直前の編集で公開版と稼働設定が食い違わない', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedBase(testDb.raw);
  });

  it('公開の読取と書込のあいだに編集が入ったら競合として止まる', async () => {
    const fault = makeFaultDb(testDb);
    const target = buildApp(fault.db);
    const { ruleId } = await createRuleWithTestedDraft(target, testDb.raw, '公開する内容');

    // 公開 batch の直前に、同じ版への編集保存が割り込む。
    fault.armBatchHook(
      (sqls) => sqls.some((sql) => sql.includes("SET status = 'published'")),
      () => {
        testDb.raw.prepare(
          `UPDATE auto_reply_versions
              SET definition_snapshot = ?, last_test_status = NULL, updated_at = ?
            WHERE auto_reply_id = ? AND status = 'draft'`,
        ).run(
          JSON.stringify({ keyword: '予約', responseContent: '割り込んだ未試験の内容' }),
          '2026-09-29T12:00:02+09:00',
          ruleId,
        );
      },
    );

    const published = await target.instance.request(
      `/api/auto-replies/${ruleId}/publish`,
      jsonRequest('POST', {}, { 'Idempotency-Key': 'pub-key-r553' }),
      target.bindings,
    );
    expect(published.status).toBe(409);

    // 稼働設定は旧内容のまま、下書きは公開されていない。
    const rule = testDb.raw.prepare(`SELECT * FROM auto_replies WHERE id = ?`).get(ruleId) as {
      response_content: string;
      is_active: number;
      current_published_version_id: string | null;
    };
    expect(rule.response_content).toBe('公開する内容');
    expect(rule.is_active).toBe(0);
    const draft = testDb.raw.prepare(
      `SELECT status FROM auto_reply_versions WHERE auto_reply_id = ? AND status = 'draft'`,
    ).get(ruleId) as { status: string } | undefined;
    expect(draft?.status).toBe('draft');
  });
});

describe('m26c R554: 停止後に古い公開要求が再有効化しない', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedBase(testDb.raw);
  });

  it('公開 batch の直前に停止が入ったら競合として止まる', async () => {
    const fault = makeFaultDb(testDb);
    const target = buildApp(fault.db);
    const { ruleId } = await createRuleWithTestedDraft(target, testDb.raw, '公開する内容');

    // 公開 batch の直前に、別担当の停止が完了する。
    fault.armBatchHook(
      (sqls) => sqls.some((sql) => sql.includes("SET status = 'published'")),
      () => {
        testDb.raw.prepare(
          `UPDATE auto_replies
              SET is_active = 0, lifecycle_status = 'stopped', stopped_at = ?,
                  stopped_by_staff_id = ?, stop_reason = ?, stop_idempotency_key = ?
            WHERE id = ?`,
        ).run(
          '2026-09-29T12:00:03+09:00',
          'owner-a',
          '停止',
          'stop-key-r554',
          ruleId,
        );
      },
    );

    const published = await target.instance.request(
      `/api/auto-replies/${ruleId}/publish`,
      jsonRequest('POST', {}, { 'Idempotency-Key': 'pub-key-r554' }),
      target.bindings,
    );
    expect(published.status).toBe(409);

    const rule = testDb.raw.prepare(`SELECT * FROM auto_replies WHERE id = ?`).get(ruleId) as {
      is_active: number;
      lifecycle_status: string;
      stopped_at: string | null;
    };
    expect(rule.is_active).toBe(0);
    expect(rule.lifecycle_status).toBe('stopped');
    expect(rule.stopped_at).toBe('2026-09-29T12:00:03+09:00');
  });
});

describe('m26c R558: 公開済み URL の再読込で公開状態を表示する', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedBase(testDb.raw);
  });

  it('公開後に下書きが無くても競合確認が公開版を返す', async () => {
    const target = buildApp(testDb.db);
    const { ruleId } = await createRuleWithTestedDraft(target, testDb.raw, '公開する内容');

    const published = await target.instance.request(
      `/api/auto-replies/${ruleId}/publish`,
      jsonRequest('POST', {}, { 'Idempotency-Key': 'pub-key-r558' }),
      target.bindings,
    );
    expect(published.status).toBe(200);

    const draft = await target.instance.request(
      `/api/auto-replies/${ruleId}/draft`,
      {},
      target.bindings,
    );
    expect(draft.status).toBe(200);

    // 公開版への読替で 200 を返し、404 へ誤遷移させない。
    const conflicts = await target.instance.request(
      `/api/auto-replies/${ruleId}/conflicts`,
      {},
      target.bindings,
    );
    expect(conflicts.status).toBe(200);
    const conflictsBody = (await conflicts.json()) as { data: { conflicts: unknown[] } };
    expect(Array.isArray(conflictsBody.data.conflicts)).toBe(true);
  });
});
