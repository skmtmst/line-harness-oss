/** 公開前確認は、申込に使う回答フォームが止まっていれば form_active で公開を止める。実 route・認証・SQLite を通す。 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Env } from '../worker-env.js';
import { authMiddleware } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const TENANT = 'tenant-1';
const ACCOUNT = 'acc-a';
const KEY_OWNER = 'key-owner-aaa';
const WEBINAR = 'webinar-a';
const FORM = 'form-a';

let sqlite: SqliteD1;
let webinarRoutes: Awaited<typeof import('./webinars.js')>['webinarRoutes'];

function seed(raw: SqliteD1['raw']) {
  raw.prepare(`INSERT INTO tenants (id, name) VALUES (?, '統括1')`).run(TENANT);
  raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
     VALUES (?, 'channel-a', '本店', 'token', 'secret', ?)`,
  ).run(ACCOUNT, TENANT);
  raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-1', 'オーナー', 'owner', ?, ?, 'all')`,
  ).run(KEY_OWNER, TENANT);
  raw.prepare(
    `INSERT INTO webinars (id, account_id, title, slug, status, duration_seconds, schedule_json, created_at, updated_at)
     VALUES (?, ?, 'ウェビナー', 'webinar-a', 'draft', 1800, '[]', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
  ).run(WEBINAR, ACCOUNT);
  raw.prepare(`INSERT INTO forms (id, name, is_active) VALUES (?, '申込フォーム', 1)`).run(FORM);
  raw.prepare(
    `INSERT INTO webinar_editor_settings (webinar_id, registration_form_id, created_at, updated_at)
     VALUES (?, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
  ).run(WEBINAR, FORM);
}

async function validation() {
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', webinarRoutes);
  const res = await app.request(`/api/webinars/${WEBINAR}/publish-validation`, {
    headers: { Authorization: `Bearer ${KEY_OWNER}` },
  }, { DB: sqlite.db } as unknown as Env['Bindings']);
  expect(res.status).toBe(200);
  return (await res.json() as { data: { blockers: string[]; checks: Array<{ key: string; status: string }> } }).data;
}

beforeEach(async () => {
  sqlite = createTestD1({ loginPolicy: 'off' });
  seed(sqlite.raw);
  ({ webinarRoutes } = await import('./webinars.js'));
});

describe('公開前確認の申込フォーム', () => {
  test('公開中のフォームなら form_active は通る', async () => {
    const data = await validation();
    expect(data.checks.find((check) => check.key === 'form_active')?.status).toBe('passed');
    expect(data.blockers).not.toContain('form_active');
  });

  test('フォームを止めたら form_active で公開を止める', async () => {
    sqlite.raw.prepare('UPDATE forms SET is_active = 0 WHERE id = ?').run(FORM);
    const data = await validation();
    expect(data.checks.find((check) => check.key === 'form_active')?.status).toBe('failed');
    expect(data.blockers).toContain('form_active');
  });
});
