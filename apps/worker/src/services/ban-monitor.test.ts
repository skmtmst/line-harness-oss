import { beforeEach, describe, expect, it, vi } from 'vitest';

const getLineAccounts = vi.fn();
const createAccountHealthLog = vi.fn();
const createNotification = vi.fn();
const getLatestRiskLevel = vi.fn();

vi.mock('@line-crm/db', () => ({
  getLineAccounts: (...args: unknown[]) => getLineAccounts(...args),
  createAccountHealthLog: (...args: unknown[]) => createAccountHealthLog(...args),
  createNotification: (...args: unknown[]) => createNotification(...args),
  getLatestRiskLevel: (...args: unknown[]) => getLatestRiskLevel(...args),
}));

function database(counts: Record<string, number>): D1Database {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...values: unknown[]) => ({
        first: vi.fn(async () => ({ count: counts[String(values[1])] ?? 0 })),
      })),
      sql,
    })),
  } as unknown as D1Database;
}

beforeEach(() => {
  vi.clearAllMocks();
  getLineAccounts.mockResolvedValue([
    { id: 'account-a', channel_access_token: 'token-a', is_active: 1 },
    { id: 'account-b', channel_access_token: 'token-b', is_active: 1 },
  ]);
  getLatestRiskLevel.mockResolvedValue('normal');
  createAccountHealthLog.mockImplementation(async (_db, input: { lineAccountId: string }) => ({
    id: `health-${input.lineAccountId}`,
  }));
  createNotification.mockResolvedValue({ id: 'notice-1' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
});

describe('account health dashboard notifications', () => {
  it('counts outgoing messages per LINE account and notifies only the changed warning account', async () => {
    const db = database({ 'account-a': 6001, 'account-b': 0 });
    const { checkAccountHealth } = await import('./ban-monitor.js');

    await checkAccountHealth(db);

    const sql = vi.mocked(db.prepare).mock.calls[0]?.[0] as string;
    expect(sql).toContain('line_account_id = ?');
    expect(createAccountHealthLog).toHaveBeenCalledWith(db, expect.objectContaining({
      lineAccountId: 'account-a', riskLevel: 'warning',
    }));
    expect(createAccountHealthLog).toHaveBeenCalledWith(db, expect.objectContaining({
      lineAccountId: 'account-b', riskLevel: 'normal',
    }));
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith(db, expect.objectContaining({
      eventType: 'account_health_warning',
      lineAccountId: 'account-a',
      channel: 'dashboard',
      category: 'error',
    }));
  });

  it('does not create the same danger notification on every health check', async () => {
    getLineAccounts.mockResolvedValue([
      { id: 'account-a', channel_access_token: 'token-a', is_active: 1 },
    ]);
    getLatestRiskLevel.mockResolvedValue('danger');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const { checkAccountHealth } = await import('./ban-monitor.js');

    await checkAccountHealth(database({ 'account-a': 0 }));

    expect(createAccountHealthLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      riskLevel: 'danger',
    }));
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('creates a recovery update after a warning or danger clears', async () => {
    getLineAccounts.mockResolvedValue([
      { id: 'account-a', channel_access_token: 'token-a', is_active: 1 },
    ]);
    getLatestRiskLevel.mockResolvedValue('warning');
    const { checkAccountHealth } = await import('./ban-monitor.js');

    await checkAccountHealth(database({ 'account-a': 0 }));

    expect(createNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'account_health_recovered',
      lineAccountId: 'account-a',
      category: 'update',
    }));
  });
});
