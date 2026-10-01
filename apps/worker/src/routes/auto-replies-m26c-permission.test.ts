import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { autoReplies } from './auto-replies.js';

/*
 * m26c: 自動応答の公開・権限・競合（R562/R563/R569/R570 のサーバ側）。
 * 実 Hono ルート＋実 SQLite（bootstrap.sql）で、監査の隔離再現を最新枝で
 * やり直す。期待する姿（いずれも現状は赤、ただし owner の正規操作は緑）:
 * - R562: 限定担当 admin は NULL 所属（全アカウント共通）の作成・共通化が 403。
 * - R563: 別 tenant の既知 templateId を送っても本文が返らず保存されない。
 * - R569: 公開中ルールの一覧編集は稼働定義を変えず下書きへ。版保存失敗で食い違わない。
 * - R570: 版保存に失敗した作成は行・版とも残らない。
 */

const owner: AuthenticatedStaff = {
  id: 'owner-a',
  name: '統括',
  role: 'owner',
  readOnly: false,
  tenantId: 'tenant-a',
};

const scopedAdmin: AuthenticatedStaff = {
  id: 'scoped-admin',
  name: '限定担当',
  role: 'admin',
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
     VALUES ('owner-a', '統括', 'owner', 'key-owner-a', 'tenant-a', 'all'),
            ('scoped-admin', '限定担当', 'admin', 'key-scoped', 'tenant-a', 'accounts')`,
  ).run();
  raw.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
     VALUES ('scoped-admin', 'account-a', '2026-01-01T00:00:00+09:00')`,
  ).run();
  raw.prepare(
    `INSERT INTO templates (id, name, message_type, message_content, line_account_id)
     VALUES ('template-a', 'TA', 'text', 'Aテンプレート本文', 'account-a'),
            ('template-b', 'TB', 'text', 'B SECRET BODY', 'account-b')`,
  ).run();
}

function makeFaultDb(testDb: SqliteD1): {
  db: D1Database;
  armFailBatch: (match: (sqls: string[]) => boolean) => void;
} {
  let failBatch: ((sqls: string[]) => boolean) | null = null;
  const wrapBound = (sql: string, bound: Record<string, (...args: never[]) => Promise<unknown>>) => ({
    sql,
    run: (...args: never[]) => bound.run(...args),
    first: (...args: never[]) => bound.first(...args),
    all: (...args: never[]) => bound.all(...args),
  });
  const db = {
    prepare: (sql: string) => {
      const stmt = (testDb.db as unknown as {
        prepare: (sql: string) => {
          bind: (...args: unknown[]) => Record<string, (...args: never[]) => Promise<unknown>>;
        };
      }).prepare(sql);
      return {
        bind: (...args: unknown[]) => wrapBound(sql, stmt.bind(...args)),
      };
    },
    batch: async (statements: Array<{ sql?: string }>) => {
      const sqls = statements.map((item) => item?.sql ?? '');
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
    armFailBatch: (match) => {
      failBatch = match;
    },
  };
}

const NULL_RULE_BODY = {
  keyword: '問い合わせ',
  matchType: 'contains',
  responseType: 'text',
  responseContent: '共通の回答',
  lineAccountId: null,
};

describe('m26c R562: 限定担当 admin は全アカウント共通ルールを作れない', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedBase(testDb.raw);
  });

  it('可視アカウントを query に付けても NULL 所属の作成は 403', async () => {
    const target = buildApp(testDb.db, scopedAdmin);
    const res = await target.instance.request(
      '/api/auto-replies?lineAccountId=account-a',
      jsonRequest('POST', { ...NULL_RULE_BODY, isActive: true }),
      target.bindings,
    );
    expect(res.status).toBe(403);

    const rows = testDb.raw.prepare(`SELECT COUNT(*) AS n FROM auto_replies WHERE line_account_id IS NULL`)
      .get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it('個別ルールの NULL 共通化も 403', async () => {
    const asOwner = buildApp(testDb.db, owner);
    const created = await asOwner.instance.request(
      '/api/auto-replies',
      jsonRequest('POST', {
        keyword: '予約',
        matchType: 'contains',
        responseType: 'text',
        responseContent: '承りました',
        lineAccountId: 'account-a',
        isActive: false,
      }),
      asOwner.bindings,
    );
    expect(created.status).toBe(201);
    const ruleId = ((await created.json()) as { data: { id: string } }).data.id;

    const target = buildApp(testDb.db, scopedAdmin);
    const res = await target.instance.request(
      `/api/auto-replies/${ruleId}?lineAccountId=account-a`,
      jsonRequest('PUT', { lineAccountId: null, responseContent: '変えた回答' }),
      target.bindings,
    );
    expect(res.status).toBe(403);

    const rule = testDb.raw.prepare(`SELECT line_account_id, response_content FROM auto_replies WHERE id = ?`)
      .get(ruleId) as { line_account_id: string | null; response_content: string };
    expect(rule.line_account_id).toBe('account-a');
    expect(rule.response_content).toBe('承りました');
  });

  it('owner の共通ルール操作は成功する', async () => {
    const target = buildApp(testDb.db, owner);
    const created = await target.instance.request(
      '/api/auto-replies?lineAccountId=account-a',
      jsonRequest('POST', { ...NULL_RULE_BODY, isActive: false }),
      target.bindings,
    );
    expect(created.status).toBe(201);

    // 個別ルールの内容更新も owner は通る（NULL 行の可視性は別 middleware の扱い）。
    const owned = await target.instance.request(
      '/api/auto-replies',
      jsonRequest('POST', {
        keyword: '予約',
        matchType: 'contains',
        responseType: 'text',
        responseContent: '個別の回答',
        lineAccountId: 'account-a',
        isActive: false,
      }),
      target.bindings,
    );
    expect(owned.status).toBe(201);
    const ownedId = ((await owned.json()) as { data: { id: string } }).data.id;
    const updated = await target.instance.request(
      `/api/auto-replies/${ownedId}`,
      jsonRequest('PUT', { responseContent: '統括が更新' }),
      target.bindings,
    );
    expect(updated.status).toBe(200);
  });
});

describe('m26c R563: 別 tenant のテンプレート本文を取り込めない', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedBase(testDb.raw);
  });

  const crossBody = {
    keyword: '予約',
    matchType: 'contains',
    lineAccountId: 'account-a',
    templateId: 'template-b',
    responseContent: '',
  };

  it('別 tenant の既知 templateId による直接作成は本文を返さず保存しない', async () => {
    const target = buildApp(testDb.db, scopedAdmin);
    const res = await target.instance.request(
      '/api/auto-replies?lineAccountId=account-a',
      jsonRequest('POST', crossBody),
      target.bindings,
    );
    expect([400, 403, 404]).toContain(res.status);

    const leaked = testDb.raw.prepare(
      `SELECT COUNT(*) AS n FROM auto_replies WHERE response_content = 'B SECRET BODY'`,
    ).get() as { n: number };
    expect(leaked.n).toBe(0);
    if (res.status !== 404) {
      const body = (await res.json()) as { data?: { responseContent?: string } };
      expect(body.data?.responseContent ?? '').not.toContain('B SECRET BODY');
    }
  });

  it('別 tenant の既知 templateId による下書き作成も拒否する', async () => {
    const target = buildApp(testDb.db, scopedAdmin);
    const res = await target.instance.request(
      '/api/auto-replies/drafts?lineAccountId=account-a',
      jsonRequest('POST', crossBody),
      target.bindings,
    );
    expect([400, 403, 404]).toContain(res.status);

    const leaked = testDb.raw.prepare(
      `SELECT COUNT(*) AS n FROM auto_reply_versions WHERE definition_snapshot LIKE '%B SECRET BODY%'`,
    ).get() as { n: number };
    expect(leaked.n).toBe(0);
  });

  it('自アカウントのテンプレート参照は正常に動く', async () => {
    const target = buildApp(testDb.db, scopedAdmin);
    const res = await target.instance.request(
      '/api/auto-replies/drafts?lineAccountId=account-a',
      jsonRequest('POST', { ...crossBody, templateId: 'template-a' }),
      target.bindings,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { settings: { responseContent: string } } };
    expect(body.data.settings.responseContent).toBe('Aテンプレート本文');
  });
});

describe('m26c R569: 一覧編集は公開中ルールの稼働定義を変えない', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedBase(testDb.raw);
  });

  async function createLiveRule(): Promise<string> {
    const target = buildApp(testDb.db, owner);
    const created = await target.instance.request(
      '/api/auto-replies',
      jsonRequest('POST', {
        keyword: '予約',
        matchType: 'contains',
        responseType: 'text',
        responseContent: '稼働中の回答',
        lineAccountId: 'account-a',
        isActive: true,
      }),
      target.bindings,
    );
    expect(created.status).toBe(201);
    return ((await created.json()) as { data: { id: string } }).data.id;
  }

  it('公開中ルールの一覧編集は稼働定義を保ち、下書きへ保存する', async () => {
    const ruleId = await createLiveRule();
    const target = buildApp(testDb.db, owner);

    const res = await target.instance.request(
      `/api/auto-replies/${ruleId}?lineAccountId=account-a`,
      jsonRequest('PUT', { responseContent: '一覧から変えた回答' }),
      target.bindings,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { draftSaved?: boolean } };
    expect(body.data.draftSaved).toBe(true);

    // 稼働定義は変わらない。
    const rule = testDb.raw.prepare(`SELECT response_content, is_active FROM auto_replies WHERE id = ?`)
      .get(ruleId) as { response_content: string; is_active: number };
    expect(rule.response_content).toBe('稼働中の回答');
    expect(rule.is_active).toBe(1);

    // 変更は下書き版に載る。
    const draft = testDb.raw.prepare(
      `SELECT definition_snapshot FROM auto_reply_versions WHERE auto_reply_id = ? AND status = 'draft'`,
    ).get(ruleId) as { definition_snapshot: string } | undefined;
    expect(draft).toBeDefined();
    expect(draft!.definition_snapshot).toContain('一覧から変えた回答');
  });

  it('停止中ルールの一覧編集は従来どおり直接保存する', async () => {
    const target = buildApp(testDb.db, owner);
    const created = await target.instance.request(
      '/api/auto-replies',
      jsonRequest('POST', {
        keyword: '予約',
        matchType: 'contains',
        responseType: 'text',
        responseContent: '停止中の回答',
        lineAccountId: 'account-a',
        isActive: false,
      }),
      target.bindings,
    );
    expect(created.status).toBe(201);
    const ruleId = ((await created.json()) as { data: { id: string } }).data.id;

    const res = await target.instance.request(
      `/api/auto-replies/${ruleId}`,
      jsonRequest('PUT', { responseContent: '停止中に直した回答' }),
      target.bindings,
    );
    expect(res.status).toBe(200);
    const rule = testDb.raw.prepare(`SELECT response_content FROM auto_replies WHERE id = ?`)
      .get(ruleId) as { response_content: string };
    expect(rule.response_content).toBe('停止中に直した回答');
  });

  it('版保存に失敗したら行も変えず食い違わない', async () => {
    const target = buildApp(testDb.db, owner);
    const created = await target.instance.request(
      '/api/auto-replies',
      jsonRequest('POST', {
        keyword: '予約',
        matchType: 'contains',
        responseType: 'text',
        responseContent: '停止中の回答',
        lineAccountId: 'account-a',
        isActive: false,
      }),
      target.bindings,
    );
    const ruleId = ((await created.json()) as { data: { id: string } }).data.id;

    const fault = makeFaultDb(testDb);
    const faulty = buildApp(fault.db, owner);
    // 版まわりの書込を含む batch を落とす。
    fault.armFailBatch((sqls) => sqls.some((sql) => sql.includes('auto_reply_versions')));

    // 画面は internalMemo を必ず送る。版の batch 経路に載せるため付ける。
    const res = await faulty.instance.request(
      `/api/auto-replies/${ruleId}`,
      jsonRequest('PUT', { responseContent: '失敗するはずの回答', internalMemo: 'メモ' }),
      faulty.bindings,
    );
    expect(res.status).toBe(500);

    const rule = testDb.raw.prepare(`SELECT response_content FROM auto_replies WHERE id = ?`)
      .get(ruleId) as { response_content: string };
    expect(rule.response_content).toBe('停止中の回答');
  });
});

describe('m26c R570: 版保存に失敗した作成は行も残さない', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedBase(testDb.raw);
  });

  it('版の書込を含む batch が落ちたらルール行も残らない', async () => {
    const fault = makeFaultDb(testDb);
    const target = buildApp(fault.db, owner);
    fault.armFailBatch((sqls) => sqls.some((sql) => sql.includes('INSERT INTO auto_reply_versions')));

    const res = await target.instance.request(
      '/api/auto-replies',
      jsonRequest('POST', {
        keyword: '予約',
        matchType: 'contains',
        responseType: 'text',
        responseContent: '作りかけの回答',
        lineAccountId: 'account-a',
        isActive: false,
      }),
      target.bindings,
    );
    expect(res.status).toBe(500);

    const rows = testDb.raw.prepare(`SELECT COUNT(*) AS n FROM auto_replies`).get() as { n: number };
    expect(rows.n).toBe(0);
    const versions = testDb.raw.prepare(`SELECT COUNT(*) AS n FROM auto_reply_versions`).get() as { n: number };
    expect(versions.n).toBe(0);
  });
});
