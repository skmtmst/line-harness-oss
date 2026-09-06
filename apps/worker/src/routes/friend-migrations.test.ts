import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const db = {
  UID_EVIDENCE_TYPES: ['same_provider', 'line_login', 'signed_customer_id', 'verified_contact', 'operator_csv', 'manual'],
  createUidMigrationRun: vi.fn(),
  getUidMigrationRun: vi.fn(),
  listUidMigrationItems: vi.fn(),
  listUidMigrationRuns: vi.fn(),
  protectCsvCell: vi.fn((value: string | null) => value ?? ''),
};
vi.mock('@line-crm/db', () => db);

const accountAccess = { canAccessAllLineAccounts: vi.fn(), getVisibleLineAccountScope: vi.fn() };
vi.mock('../services/account-access.js', () => accountAccess);

const { friendMigrations } = await import('./friend-migrations.js');
const run = vi.fn();
const first = vi.fn();
const all = vi.fn(async () => ({ results: [] }));
const bind = vi.fn(() => ({ run, first, all }));
const prepare = vi.fn((_sql: string) => ({ bind }));
const env = { DB: { prepare, batch: vi.fn() } as unknown as D1Database };

const RUN = {
  id: 'run-1', from_account_id: 'from', to_account_id: 'to', purpose: '移行', source_kind: 'csv',
  source_filename: 'map.csv', source_checksum: 'sum', status: 'ready', dry_run_revision: 1,
  total_count: 1, auto_count: 1, review_count: 0, unmatched_count: 0, conflict_count: 0,
  applied_count: 0, failed_count: 0, created_by: 'owner-1', approved_by: null,
  created_at: '2026-09-06T00:00:00Z', reviewed_at: null, executed_at: null,
  completed_at: null, rolled_back_at: null, failure_reason: null,
};

function appFor(staff = { id: 'owner-1', name: '作成者', role: 'owner', readOnly: false }) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', staff); await next(); });
  app.route('/', friendMigrations);
  return app;
}

function post(path: string, body: unknown) {
  return new Request(`https://example.com${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  accountAccess.canAccessAllLineAccounts.mockResolvedValue(true);
  accountAccess.getVisibleLineAccountScope.mockResolvedValue({ allowedAccountIds: ['from', 'to'] });
  db.getUidMigrationRun.mockResolvedValue(RUN);
  db.listUidMigrationItems.mockResolvedValue([]);
  db.listUidMigrationRuns.mockResolvedValue([RUN]);
  db.createUidMigrationRun.mockResolvedValue(RUN);
});

describe('UID移行API', () => {
  it('dry-runは対象アカウントの権限を確認する', async () => {
    accountAccess.canAccessAllLineAccounts.mockResolvedValue(false);
    const response = await appFor().fetch(post('/api/friends/migrations', {
      fromAccountId: 'from', toAccountId: 'to', purpose: '移行',
      mappings: [{ oldUid: 'old', newUid: 'new', evidenceType: 'operator_csv' }],
    }), env);
    expect(response.status).toBe(404);
    expect(db.createUidMigrationRun).not.toHaveBeenCalled();
  });

  it('dry-runは元のfriendsを書き換えない', async () => {
    const response = await appFor().fetch(post('/api/friends/migrations', {
      fromAccountId: 'from', toAccountId: 'to', purpose: '移行',
      mappings: [{ oldUid: 'old', newUid: 'new', evidenceType: 'operator_csv' }],
    }), env);
    expect(response.status).toBe(201);
    expect(db.createUidMigrationRun).toHaveBeenCalled();
    expect(prepare.mock.calls.some(([sql]) => /UPDATE\s+friends/i.test(String(sql)))).toBe(false);
  });

  it('作成者本人だけでは本移行できない', async () => {
    const response = await appFor().fetch(post('/api/friends/migrations/run-1/execute', {}), env);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('別のowner') });
  });

  it('staffは本移行できない', async () => {
    const response = await appFor({ id: 'staff-1', name: '担当者', role: 'staff', readOnly: false })
      .fetch(post('/api/friends/migrations/run-1/execute', {}), env);
    expect(response.status).toBe(403);
  });
});
