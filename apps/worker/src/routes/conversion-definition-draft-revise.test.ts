/*
 * CONVERSION-07: 下書きの成果地点の編集が常に409で失敗していた回帰（口の結合試験）。
 *
 * 直す前は、事前検査（allowDraft）が下書きの編集を許すのに、UPDATE の
 * CAS が `status = 'active'` だけを通していた。下書きを編集すると必ず
 * 0件更新→ version_conflict(409) になり、画面上では「別の人が更新した」
 * にしか見えない失敗が毎回起きていた。
 *
 * ここでは実SQLite（bootstrap.sql を流した better-sqlite3）に実物の
 * conversions ルートと実物の認証を当て、下書きの正常編集が成功し、
 * 真の競合・停止済み・重複名だけが 409 で弾かれることを固定する。
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const ACC_A = 'acc-a';
const ACC_B = 'acc-b';
const KEY_OWNER = 'key-owner-aaa';
const KEY_ADMIN_A = 'key-admin-aaa';

function seed(sqlite: SqliteD1['raw']) {
  sqlite.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  for (const id of [ACC_A, ACC_B]) {
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 'tenant-1')`,
    ).run(id, `channel-${id}`, id);
  }
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-1', 'オーナー', 'owner', ?, 'tenant-1', 'all')`,
  ).run(KEY_OWNER);
  // acc-a だけを見られる admin。別アカウントの地点は404で隠れるはず。
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('admin-a', '管理A', 'admin', ?, 'tenant-1', 'accounts')`,
  ).run(KEY_ADMIN_A);
  sqlite.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
     VALUES ('admin-a', ?, '2026-09-01T00:00:00.000Z')`,
  ).run(ACC_A);
}

let sqlite: SqliteD1;
let conversionsRoute: Awaited<typeof import('./conversions.js')>['conversions'];

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', conversionsRoute);
  return instance;
}

const env = () => ({ DB: sqlite.db }) as unknown as Env['Bindings'];

function postJson(path: string, apiKey: string, body: unknown) {
  return app().request(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }, env());
}

function getJson(path: string, apiKey: string) {
  return app().request(path, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }, env());
}

function createBody(over: Record<string, unknown> = {}) {
  return {
    name: '購入完了',
    sourceType: 'form_submitted',
    sourceConfig: {},
    lineAccountId: ACC_A,
    deduplicationMode: 'every',
    valueMode: 'fixed',
    fixedValue: 100,
    reversalPolicy: 'none',
    attributionDays: 7,
    usages: [],
    ...over,
  };
}

function reviseBody(over: Record<string, unknown> = {}) {
  return {
    expectedVersion: 1,
    name: '購入完了（改）',
    sourceType: 'form_submitted',
    sourceConfig: {},
    deduplicationMode: 'every',
    valueMode: 'fixed',
    fixedValue: 500,
    reversalPolicy: 'none',
    attributionDays: 14,
    ...over,
  };
}

async function createDefinition(over: Record<string, unknown> = {}): Promise<string> {
  const response = await postJson('/api/conversions/definitions', KEY_OWNER, createBody(over));
  expect(response.status).toBe(201);
  const body = await response.json() as { data: { id: string } };
  return body.data.id;
}

beforeEach(async () => {
  sqlite = createTestD1();
  seed(sqlite.raw);
  ({ conversions: conversionsRoute } = await import('./conversions.js'));
});

describe('下書きの成果地点の編集（CONVERSION-07）', () => {
  test('下書きを正常に編集でき、再取得でも名前・日数・下書きのままが保持される', async () => {
    const id = await createDefinition({ draft: true });

    const revised = await postJson(`/api/conversions/definitions/${id}/revise`, KEY_OWNER, reviseBody());
    expect(revised.status).toBe(200);
    const revisedBody = await revised.json() as { data: { version: number } };
    expect(revisedBody.data.version).toBe(2);

    const detail = await getJson(`/api/conversions/definitions/${id}`, KEY_OWNER);
    expect(detail.status).toBe(200);
    const detailBody = await detail.json() as {
      data: { name: string; status: string; state: string; attributionDays: number; version: number };
    };
    expect(detailBody.data.status).toBe('draft');
    expect(detailBody.data.state).toBe('draft');
    expect(detailBody.data.name).toBe('購入完了（改）');
    expect(detailBody.data.attributionDays).toBe(14);
    expect(detailBody.data.version).toBe(2);
  });

  test('下書きを編集→公開→その後の編集もできる', async () => {
    const id = await createDefinition({ draft: true });
    await postJson(`/api/conversions/definitions/${id}/revise`, KEY_OWNER, reviseBody());

    const published = await postJson(`/api/conversions/definitions/${id}/publish`, KEY_OWNER, { expectedVersion: 2 });
    expect(published.status).toBe(200);

    const edited = await postJson(
      `/api/conversions/definitions/${id}/revise`,
      KEY_OWNER,
      reviseBody({ expectedVersion: 3, name: '公開後の編集' }),
    );
    expect(edited.status).toBe(200);
  });

  test('古い版からの編集は真の競合として409を返し、地点は変わらない', async () => {
    const id = await createDefinition({ draft: true });

    const conflict = await postJson(
      `/api/conversions/definitions/${id}/revise`,
      KEY_OWNER,
      reviseBody({ expectedVersion: 99 }),
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ success: false, code: 'version_conflict' });

    const detail = await getJson(`/api/conversions/definitions/${id}`, KEY_OWNER);
    const detailBody = await detail.json() as { data: { name: string; version: number; status: string } };
    expect(detailBody.data).toMatchObject({ name: '購入完了', version: 1, status: 'draft' });
  });

  test('停止済みの地点は編集できない', async () => {
    const id = await createDefinition();
    const stopped = await postJson(`/api/conversions/definitions/${id}/stop`, KEY_OWNER, { expectedVersion: 1 });
    expect(stopped.status).toBe(200);

    const denied = await postJson(
      `/api/conversions/definitions/${id}/revise`,
      KEY_OWNER,
      reviseBody({ expectedVersion: 2 }),
    );
    expect(denied.status).toBe(409);
    expect(await denied.json()).toMatchObject({ success: false, code: 'definition_stopped' });
  });

  test('同じアカウント内で名前が重なる編集は409を返す', async () => {
    await createDefinition({ name: '使われている名前' });
    const id = await createDefinition({ draft: true });

    const denied = await postJson(
      `/api/conversions/definitions/${id}/revise`,
      KEY_OWNER,
      reviseBody({ name: '使われている名前' }),
    );
    expect(denied.status).toBe(409);
    expect(await denied.json()).toMatchObject({ success: false, code: 'duplicate_name' });
  });

  test('担当外アカウントの地点は404で隠す', async () => {
    const id = await createDefinition({ draft: true, lineAccountId: ACC_B });

    const hidden = await postJson(
      `/api/conversions/definitions/${id}/revise`,
      KEY_ADMIN_A,
      reviseBody(),
    );
    expect(hidden.status).toBe(404);
  });
});
