import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';

const db = {
  UID_EVIDENCE_TYPES: ['same_provider', 'line_login', 'signed_customer_id', 'verified_contact', 'operator_csv', 'manual'],
  countUidMigrationItems: vi.fn(),
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

function appFor(staff: AuthenticatedStaff = { id: 'owner-1', name: '作成者', role: 'owner', readOnly: false }) {
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
  db.countUidMigrationItems.mockResolvedValue(0);
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

  it('一致先のない行にcreateは選べない', async () => {
    first.mockReset();
    first.mockResolvedValue({ id: 'item-1', old_friend_id: 'f-old', new_friend_id: null });
    const response = await appFor().fetch(new Request('https://example.com/api/friends/migrations/run-1/items/item-1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'create' }),
    }), env);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('新規作成できません') });
  });
});

describe('対応表のページ送り', () => {
  const ITEM = {
    id: 'item-1', old_uid: 'old-1', new_uid: 'new-1', candidate_name: '候補',
    evidence_type: 'operator_csv', classification: 'review', conflict_reason: null,
    decision: 'pending', result: 'pending', error_message: null,
  };

  it('件数と未判断数をそろえて返す', async () => {
    db.listUidMigrationItems.mockResolvedValue([ITEM]);
    db.countUidMigrationItems.mockResolvedValueOnce(25).mockResolvedValueOnce(3);
    const response = await appFor().fetch(new Request('https://example.com/api/friends/migrations/run-1'), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        itemTotal: 25, itemLimit: 20, itemOffset: 0, unresolved: 3,
        items: [{ id: 'item-1', oldUid: 'old-1', newUid: 'new-1', decision: 'pending' }],
      },
    });
    expect(db.listUidMigrationItems).toHaveBeenCalledWith(
      expect.anything(), 'run-1',
      { classifications: undefined, pendingOnly: undefined },
      { limit: 20, offset: 0 },
    );
  });

  it('分類と未判断のみを受け付ける', async () => {
    await appFor().fetch(
      new Request('https://example.com/api/friends/migrations/run-1?limit=5&offset=10&classification=review&pendingOnly=1'),
      env,
    );
    expect(db.listUidMigrationItems).toHaveBeenCalledWith(
      expect.anything(), 'run-1',
      { classifications: ['review'], pendingOnly: true },
      { limit: 5, offset: 10 },
    );
    expect(db.countUidMigrationItems).toHaveBeenCalledWith(
      expect.anything(), 'run-1', { classifications: ['review'], pendingOnly: true },
    );
  });

  it('知らない分類は断る', async () => {
    const response = await appFor().fetch(
      new Request('https://example.com/api/friends/migrations/run-1?classification=maybe'),
      env,
    );
    expect(response.status).toBe(400);
    expect(db.listUidMigrationItems).not.toHaveBeenCalled();
  });
});

describe('取り込みの競合検出と実行', () => {
  const VALUES = { displayName: '表示', realName: null, systemDisplayName: null };

  it('対象と他アカウントを別々に見る', async () => {
    first.mockReset();
    await appFor().fetch(post('/api/friends/imports', {
      accountId: 'acc-1', sourceFilename: 'in.csv', sourceChecksum: 'sum-1',
      rows: [{ lineUid: 'U1', ...VALUES }],
    }), env);
    const statements = prepare.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => /line_account_id = \? AND line_user_id = \?/.test(sql))).toBe(true);
    expect(statements.some((sql) => /line_user_id = \? AND line_account_id != \?/.test(sql))).toBe(true);
  });

  it('同アカウントに無く他アカウントにあれば競合にする', async () => {
    first.mockReset();
    first.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue({ id: 'f-other' });
    const response = await appFor().fetch(post('/api/friends/imports', {
      accountId: 'acc-1', sourceFilename: 'in.csv', sourceChecksum: 'sum-2',
      rows: [{ lineUid: 'U9', ...VALUES }],
    }), env);
    expect(response.status).toBe(201);
    const body = await response.json() as { data: { result: { rows: Array<{ kind: string }> } } };
    expect(body.data.result.rows[0].kind).toBe('conflict');
  });

  it('競合が残る実行は409で止める', async () => {
    first.mockReset();
    first.mockResolvedValue({
      id: 'job-1', line_account_id: 'acc-1', status: 'previewed',
      result_json: JSON.stringify({ rows: [{ lineUid: 'U1', kind: 'conflict', values: VALUES }] }),
    });
    const response = await appFor().fetch(post('/api/friends/imports/job-1/execute', {}), env);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('競合') });
    const statements = prepare.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => /INSERT INTO friends|UPDATE friend_import_jobs/.test(sql))).toBe(false);
  });

  it('入力不備が残る実行は422で止める', async () => {
    first.mockReset();
    first.mockResolvedValue({
      id: 'job-2', line_account_id: 'acc-1', status: 'previewed',
      result_json: JSON.stringify({ rows: [{ lineUid: '', kind: 'error', values: VALUES }] }),
    });
    const response = await appFor().fetch(post('/api/friends/imports/job-2/execute', {}), env);
    expect(response.status).toBe(422);
    const statements = prepare.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => /INSERT INTO friends|UPDATE friend_import_jobs/.test(sql))).toBe(false);
  });

  it('きれいな確認ずみは反映できる', async () => {
    first.mockReset();
    first.mockResolvedValue({
      id: 'job-3', line_account_id: 'acc-1', status: 'previewed',
      result_json: JSON.stringify({ rows: [{ lineUid: 'U1', kind: 'add', values: VALUES }] }),
    });
    const response = await appFor().fetch(post('/api/friends/imports/job-3/execute', {}), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { status: 'completed' } });
  });
});
