import { afterEach, expect, test, vi } from 'vitest';
import worker, { app } from './index.js';
import { QA_STAGING_DATABASE } from './services/staging-qa-safety.js';
import type { WorkerBindings } from './worker-bindings.js';
import { sha256Hex } from './middleware/auth.js';
import { createTestD1 } from './test-utils/d1-sqlite.js';

afterEach(() => vi.unstubAllGlobals());
test('本番の実HTTP入口では認証・DBより先に試験APIを閉じる', async () => {
  const prepare = vi.fn(() => { throw new Error('must not touch production DB'); });
  for (const [path, method] of [['', 'GET'], ['/safety', 'GET'], ['/runs', 'GET'], ['/runs', 'POST'], ['/runs/fake', 'GET'], ['/runs/fake', 'DELETE'], ['/runs/fake/friends', 'POST'], ['/runs/fake/cron', 'POST'], ['/runs/fake/session', 'POST'], ['/runs', 'OPTIONS']]) {
    const response = await app.request(`https://api.musubo.jp/api/ops/staging-qa${path}`, { method }, {
      DEPLOY_ENV: 'production', STAGING_QA_ENABLED: 'true', STAGING_QA_OUTBOUND_DISABLED: 'true', DB: { prepare },
    } as unknown as WorkerBindings);
    expect(response.status).toBe(404);
  }
  expect(prepare).not.toHaveBeenCalled();
});

test('QA送信止め中は全体scheduled・queue・受信メールの外部転送を起動しない', async () => {
  const prepare = vi.fn(() => { throw new Error('must not sweep shared DB'); });
  const network = vi.fn(); vi.stubGlobal('fetch', network);
  const env = { DEPLOY_ENV: 'staging', WORKER_NAME: 'nen-line-stg', D1_DATABASE_ID: QA_STAGING_DATABASE,
    WORKER_PUBLIC_URL: 'https://stg-api.musubo.jp', STAGING_QA_ENABLED: 'true', STAGING_QA_OUTBOUND_DISABLED: 'true', DB: { prepare },
  } as unknown as WorkerBindings;
  for (const cron of ['* * * * *', '*/5 * * * *', '1-56/5 * * *', '0 */6 * * *']) {
    await expect(worker.scheduled({ cron, scheduledTime: Date.now() } as ScheduledEvent, env, {} as ExecutionContext)).resolves.toBeUndefined();
  }
  const retry = vi.fn(), ack = vi.fn();
  await worker.queue({ messages: [{ retry, ack }] } as unknown as Parameters<typeof worker.queue>[0], env);
  expect(retry).toHaveBeenCalledOnce(); expect(ack).not.toHaveBeenCalled();
  const setReject = vi.fn(), forward = vi.fn();
  await worker.email({ setReject, forward } as unknown as ForwardableEmailMessage, env, {} as ExecutionContext);
  expect(setReject).toHaveBeenCalledOnce(); expect(forward).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
});

test('実HTTP入口は未ログインを拒否し、運営の既存認証からだけ準備できる', async () => {
  const fixture = createTestD1();
  try {
    fixture.raw.exec(`INSERT INTO staff_members(id,name,role,api_key) VALUES ('entry-operator','QA operator','owner','qa-entry-operator-key');
      INSERT INTO platform_admins(staff_id) VALUES ('entry-operator');`);
    const env = { DEPLOY_ENV: 'staging', WORKER_NAME: 'nen-line-stg', D1_DATABASE_ID: QA_STAGING_DATABASE,
      WORKER_PUBLIC_URL: 'https://stg-api.musubo.jp', WORKER_URL: 'https://stg-api.musubo.jp',
      STAGING_QA_ENABLED: 'true', STAGING_QA_OUTBOUND_DISABLED: 'true', DB: fixture.db,
    } as WorkerBindings;
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    const url = 'https://stg-api.musubo.jp/api/ops/staging-qa/safety';
    expect((await app.request(url, {}, env)).status).toBe(401);
    const response = await app.request(url, { headers: { Authorization: 'Bearer qa-entry-operator-key' } }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { outboundStopped: true } });
    expect(network).not.toHaveBeenCalled();
  } finally { fixture.raw.close(); }
});


test('実入口でも他店owner・閲覧のみ・期限切れセッション・CookieのCSRF不足を拒否する', async () => {
  const fixture = createTestD1();
  try {
    fixture.raw.exec(`INSERT INTO tenants(id,name) VALUES ('outside-tenant','Synthetic outside tenant');
      INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES ('outside-owner','Outside','owner','outside-key','outside-tenant');
      INSERT INTO staff_members(id,name,role,api_key,access_level) VALUES ('readonly-operator','Readonly','owner','readonly-key','read_only');
      INSERT INTO staff_members(id,name,role,api_key) VALUES ('cookie-operator','Operator','owner','cookie-api-key');
      INSERT INTO platform_admins(staff_id) VALUES ('readonly-operator'),('cookie-operator');`);
    const env = { DEPLOY_ENV: 'staging', WORKER_NAME: 'nen-line-stg', D1_DATABASE_ID: QA_STAGING_DATABASE,
      WORKER_PUBLIC_URL: 'https://stg-api.musubo.jp', WORKER_URL: 'https://stg-api.musubo.jp', ADMIN_ORIGIN: 'https://stg-admin.musubo.jp',
      STAGING_QA_ENABLED: 'true', STAGING_QA_OUTBOUND_DISABLED: 'true', DB: fixture.db,
    } as WorkerBindings;
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    const url = 'https://stg-api.musubo.jp/api/ops/staging-qa';
    for (const token of ['outside-key', 'readonly-key']) {
      expect((await app.request(`${url}/safety`, { headers: { Authorization: `Bearer ${token}` } }, env)).status).toBe(403);
      expect((await app.request(`${url}/runs`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, env)).status).toBe(403);
    }
    const token = 'qa-cookie-session';
    fixture.raw.prepare('INSERT INTO admin_sessions(token_hash,staff_id,expires_at) VALUES (?,?,?)')
      .run(await sha256Hex(token), 'cookie-operator', new Date(Date.now() + 60_000).toISOString());
    const headers = { Cookie: `lh_admin_session=${token}; lh_csrf=qa-csrf`, 'Content-Type': 'application/json' };
    expect((await app.request(`${url}/runs`, { method: 'POST', headers, body: '{}' }, env)).status).toBe(403);
    expect((await app.request(`${url}/runs`, { method: 'POST', headers: { ...headers, 'X-CSRF-Token': 'wrong' }, body: '{}' }, env)).status).toBe(403);
    // Matching CSRF reaches the normal payload validation; it does not create a run.
    expect((await app.request(`${url}/runs`, { method: 'POST', headers: { ...headers, 'X-CSRF-Token': 'qa-csrf' }, body: '{}' }, env)).status).toBe(400);
    expect((await app.request(`${url}/safety`, { headers }, env)).status).toBe(200);
    fixture.raw.prepare('UPDATE admin_sessions SET expires_at=? WHERE token_hash=?').run('2020-01-01T00:00:00Z', await sha256Hex(token));
    expect((await app.request(`${url}/safety`, { headers }, env)).status).toBe(401);
    expect(fixture.raw.prepare("SELECT COUNT(*) n FROM platform_settings WHERE key LIKE 'staging-qa:run:%'").get()).toEqual({ n: 0 });
    expect(network).not.toHaveBeenCalled();
  } finally { fixture.raw.close(); }
});
