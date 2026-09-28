/*
 * R348/R349/R350: 通知ルールの所属が変わった後の、middleware の担当判定。
 *
 * 実 middleware＋実DB（better-sqlite3 + bootstrap.sql）で確かめる。
 * handler は素通しの stub（行の絞り込みは route 側の責務）。
 *
 * ここで止めたい崩れ方:
 *   1. R349: 親が B でも A の行を持つ口へ、Bだけの担当者が通れない…
 *      ではなく逆に、旧実装は親=Bだけ見て通し、route が行を絞らず A を漏らした。
 *      middleware は「行のどれかを担当していれば通す」までが責務。
 *   2. R348: Aだけの担当者が旧行の口へ届けない（親=B で 403）。
 *      行に A があれば通す。
 *   3. R348: query に旧所属・body に新所属を書いて検査をすり抜ける。
 *      両方が食い違う入力は断る。
 *   4. R350: /api/friend-reminders/:id の所属確認が存在しない列を読み 500。
 *      友だちの所属で判定し、許可者は通す。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { featureEnforcementMiddleware } from '../middleware/feature-enforcement.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

function owner(): AuthenticatedStaff {
  return { id: 'owner-1', name: 'owner', role: 'owner', readOnly: false, tenantId: DEFAULT_TENANT_ID };
}

function scopedStaff(id: string): AuthenticatedStaff {
  return { id, name: id, role: 'staff', readOnly: false, tenantId: DEFAULT_TENANT_ID };
}

function routeApp(current: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', current);
    await next();
  });
  instance.use('/api/*', featureEnforcementMiddleware);
  // 判定までが対象なので、handler は素通しの stub で足りる。
  instance.get('/api/reminders/:id/runs', (c) => c.json({ success: true }));
  instance.get('/api/reminders/:id/registrants', (c) => c.json({ success: true }));
  instance.put('/api/reminders/:id/draft', (c) => c.json({ success: true }));
  instance.delete('/api/friend-reminders/:id', (c) => c.json({ success: true }));
  return instance;
}

function setFeature(testDb: SqliteD1, accountId: string, key: string): void {
  testDb.raw.prepare(`
    INSERT INTO account_settings (id, line_account_id, key, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(line_account_id, key) DO UPDATE SET value = excluded.value
  `).run(`setting-${key}-${accountId}`, accountId, `feature.${key}`, JSON.stringify({ enabled: true }));
}

/**
 * ルール R は今は B の所属。A 時代の実行行と登録が残る。
 */
function seedMovedRule(testDb: SqliteD1): void {
  for (const id of ['acct-a', 'acct-b', 'acct-c']) {
    testDb.raw.prepare(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
      VALUES (?, ?, ?, 'fixture', 'fixture', ?)
    `).run(id, `channel-${id}`, `店舗${id}`, DEFAULT_TENANT_ID);
    setFeature(testDb, id, 'reminders');
  }
  // 範囲限定の担当者。
  for (const [staffId, accountId] of [['staff-a', 'acct-a'], ['staff-b', 'acct-b'], ['staff-c', 'acct-c']] as const) {
    testDb.raw.prepare(`
      INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
      VALUES (?, ?, 'staff', ?, ?, 'accounts')
    `).run(staffId, staffId, `key-${staffId}`, DEFAULT_TENANT_ID);
    testDb.raw.prepare(`
      INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
      VALUES (?, ?, '2026-09-01T00:00:00+09:00')
    `).run(staffId, accountId);
  }
  testDb.raw.prepare(`
    INSERT INTO friends (id, line_user_id, display_name, line_account_id)
    VALUES ('friend-a', 'U_A', 'A客', 'acct-a')
  `).run();
  testDb.raw.prepare(`INSERT INTO reminders (id, name, line_account_id) VALUES ('rem-1', '来店前日', 'acct-b')`).run();
  testDb.raw.prepare(`
    INSERT INTO friend_reminders (id, friend_id, reminder_id, target_date, status)
    VALUES ('fr-a', 'friend-a', 'rem-1', '2026-10-05', 'active')
  `).run();
  testDb.raw.prepare(`
    INSERT INTO reminder_steps (id, reminder_id, offset_minutes, message_type, message_content)
    VALUES ('rs-now', 'rem-1', 60, 'text', '現行')
  `).run();
  testDb.raw.prepare(`
    INSERT INTO reminder_delivery_runs
      (id, line_account_id, reminder_id, friend_reminder_id, friend_id, reminder_step_id,
       scheduled_at, idempotency_key, line_retry_key, status, created_at, updated_at)
    VALUES ('run-a', 'acct-a', 'rem-1', 'fr-a', 'friend-a', 'rs-now',
      '2026-10-05T10:00:00', 'idem-a', 'retry-a', 'queued', '2026-09-03T00:00:00', '2026-09-03T00:00:00')
  `).run();
}

describe('R348/R349 行単位の口の担当判定', () => {
  let testDb: SqliteD1;
  let env: Env['Bindings'];

  beforeEach(() => {
    vi.clearAllMocks();
    testDb = createTestD1();
    seedMovedRule(testDb);
    env = { DB: testDb.db } as Env['Bindings'];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Bだけの担当者は履歴・登録の口へ通る（行の絞り込みは route 側）', async () => {
    for (const path of ['/api/reminders/rem-1/runs', '/api/reminders/rem-1/registrants']) {
      const response = await routeApp(scopedStaff('staff-b')).request(path, {}, env);
      expect(response.status, path).toBe(200);
    }
  });

  it('Aだけの担当者は旧行がある口へ通る', async () => {
    for (const path of ['/api/reminders/rem-1/runs', '/api/reminders/rem-1/registrants']) {
      const response = await routeApp(scopedStaff('staff-a')).request(path, {}, env);
      expect(response.status, path).toBe(200);
    }
  });

  it('関係ない担当者は通さない', async () => {
    const response = await routeApp(scopedStaff('staff-c'))
      .request('/api/reminders/rem-1/runs', {}, env);
    expect(response.status).toBe(403);
  });

  it('R348: query と body の所属が食い違う入力は断る', async () => {
    // query=B で検査を通し body=A を書くすり抜け。旧実装は query だけ見て通した。
    const response = await routeApp(owner()).request('/api/reminders/rem-1/draft?account_id=acct-b', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'acct-a' }),
    }, env);
    expect(response.status).toBe(403);
    const body = await response.json() as { code: string };
    expect(body.code).toBe('LINE_ACCOUNT_MISMATCH');
  });

  it('query と body が一致すれば従来どおり通る', async () => {
    const response = await routeApp(owner()).request('/api/reminders/rem-1/draft?account_id=acct-b', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'acct-b' }),
    }, env);
    expect(response.status).toBe(200);
  });
});

describe('R350 個別登録の取消口の所属確認', () => {
  let testDb: SqliteD1;
  let env: Env['Bindings'];

  beforeEach(() => {
    vi.clearAllMocks();
    testDb = createTestD1();
    seedMovedRule(testDb);
    env = { DB: testDb.db } as Env['Bindings'];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('許可者は存在しない列で500にならず通る', async () => {
    for (const staffMember of [owner(), scopedStaff('staff-a')]) {
      const response = await routeApp(staffMember)
        .request('/api/friend-reminders/fr-a', { method: 'DELETE' }, env);
      expect(response.status).toBe(200);
    }
  });

  it('担当外は通さない', async () => {
    const response = await routeApp(scopedStaff('staff-c'))
      .request('/api/friend-reminders/fr-a', { method: 'DELETE' }, env);
    expect(response.status).toBe(403);
  });
});
