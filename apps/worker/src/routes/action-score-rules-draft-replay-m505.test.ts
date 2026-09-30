import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { defaultActionScoreRuleBundle } from '@line-crm/db';

/**
 * M505: 下書き保存の応答喪失後、再送が「ほかの人が先に保存しています」の
 * 輪にならない。要求キー付きの再送は、同じ内容なら保存済みの結果を返す。
 *
 * 実ルート（action-score-rules.ts）＋実DB（createTestD1）で確かめる。
 */

const { actionScoreRules } = await import('./action-score-rules.js');

const ACCOUNT = 'account-m505';
const KEY = '22222222-2222-4222-8222-222222222222';

let testDb: SqliteD1;

const owner = (): AuthenticatedStaff => ({
  id: 'owner-1',
  name: '統括',
  role: 'owner',
  readOnly: false,
  tenantId: DEFAULT_TENANT_ID,
});

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', owner());
    return next();
  });
  instance.route('/', actionScoreRules);
  return instance;
}

async function save(body: unknown, key?: string) {
  return app().request('/api/action-scores/rules/draft', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify(body),
  }, { DB: testDb.db } as Env['Bindings']);
}

function versionCount() {
  return (testDb.raw.prepare(`SELECT COUNT(*) AS n FROM action_score_rule_versions`).get() as { n: number }).n;
}

beforeEach(() => {
  testDb = createTestD1();
  testDb.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
     VALUES (?, ?, ?, 'token', 'secret', ?)`,
  ).run(ACCOUNT, 'channel-m505', 'M505店', DEFAULT_TENANT_ID);
});

describe('PATCH /api/action-scores/rules/draft — 再送は保存済みを返す（M505）', () => {
  it('応答消失後の再送（同じキー・同じ内容）は成功として復帰し版を増やさない', async () => {
    const bundle = defaultActionScoreRuleBundle();
    const first = await save({ accountId: ACCOUNT, expectedDraftVersionId: null, configuration: bundle }, KEY);
    expect(first.status).toBe(200);
    const firstJson = await first.json() as { data: { currentDraftVersionId: string } };
    expect(versionCount()).toBe(1);

    // 応答だけ失われた想定で、古い版のまま同じ内容・同じキーを送り直す。
    const retry = await save({ accountId: ACCOUNT, expectedDraftVersionId: null, configuration: bundle }, KEY);
    expect(retry.status).toBe(200);
    const retryJson = await retry.json() as { data: { currentDraftVersionId: string }; replayed?: boolean };
    expect(retryJson.replayed).toBe(true);
    expect(retryJson.data.currentDraftVersionId).toBe(firstJson.data.currentDraftVersionId);
    expect(versionCount()).toBe(1);
  });

  it('同じキーでも内容が違えば409のまま', async () => {
    const bundle = defaultActionScoreRuleBundle();
    const first = await save({ accountId: ACCOUNT, expectedDraftVersionId: null, configuration: bundle }, KEY);
    expect(first.status).toBe(200);

    const changed = structuredClone(bundle);
    changed.rules[0] = { ...changed.rules[0], value: changed.rules[0].value + 1 };
    const retry = await save({ accountId: ACCOUNT, expectedDraftVersionId: null, configuration: changed }, KEY);
    expect(retry.status).toBe(409);
    const retryJson = await retry.json() as { code?: string };
    expect(retryJson.code).toBe('version_conflict');
    expect(versionCount()).toBe(1);
  });

  it('キーが無ければ従来どおり409（輪の再現）', async () => {
    const bundle = defaultActionScoreRuleBundle();
    expect((await save({ accountId: ACCOUNT, expectedDraftVersionId: null, configuration: bundle })).status).toBe(200);
    const retry = await save({ accountId: ACCOUNT, expectedDraftVersionId: null, configuration: bundle });
    expect(retry.status).toBe(409);
  });

  it('キーになっていない値は400で止める', async () => {
    const bundle = defaultActionScoreRuleBundle();
    const res = await save({ accountId: ACCOUNT, expectedDraftVersionId: null, configuration: bundle }, 'not-a-uuid');
    expect(res.status).toBe(400);
  });
});
