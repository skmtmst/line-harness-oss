import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  getScope: vi.fn(),
}));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: mocks.canAccess,
  getVisibleLineAccountScope: mocks.getScope,
}));
vi.mock('@line-crm/line-sdk', () => ({ LineClient: vi.fn() }));
vi.mock('@line-crm/db', () => ({ getLineAccountById: vi.fn(), jstNow: vi.fn() }));

const { ecCommerce } = await import('./ec-commerce.js');

function harness() {
  const statements: Array<{ query: string; bindings: unknown[] }> = [];
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.env = {
      DB: {
        prepare(query: string) {
          const entry = { query, bindings: [] as unknown[] };
          statements.push(entry);
          const statement = {
            bind(...bindings: unknown[]) { entry.bindings = bindings; return statement; },
            async first() { return query.includes('COUNT(*) AS count') ? { count: 0 } : null; },
            async all() { return { results: [] }; },
            async run() { return { success: true }; },
          };
          return statement;
        },
      },
    };
    c.set('staff', { id: 'staff-1', role: 'owner', tenantId: 'tenant-a' });
    await next();
  });
  app.route('/', ecCommerce);
  return { app, statements };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
  mocks.getScope.mockResolvedValue({ allowedAccountIds: ['account-a'], canSeeUnassigned: false });
});

describe('EC event admin account scope', () => {
  it('filters overview and event type counts to the selected account', async () => {
    const { app, statements } = harness();
    expect((await app.request('/api/ec-commerce/overview?lineAccountId=account-a')).status).toBe(200);
    /*
     * 3本。出来事の集計・種類別の内訳・定期便の件数(#731)。
     * 本数を数え続けるのは、**アカウントで絞っていないクエリが紛れ込むのを
     * 見張るため**。下の2つの表明(絞り込み句があること・渡す値がこのアカウント
     * だけであること)は、増えた1本にも同じように当たる。
     */
    expect(statements).toHaveLength(3);
    for (const statement of statements) {
      expect(statement.query).toContain('line_account_id = ?');
      expect(statement.bindings).toEqual(['account-a']);
    }
  });

  it('rejects a selected account outside the staff scope', async () => {
    mocks.canAccess.mockResolvedValue(false);
    const { app, statements } = harness();
    expect((await app.request('/api/ec-commerce/events?lineAccountId=account-b')).status).toBe(403);
    expect(statements).toHaveLength(0);
  });

  it('accepts identity_pending as a visible operational state', async () => {
    const { app, statements } = harness();
    expect((await app.request(
      '/api/ec-commerce/events?lineAccountId=account-a&status=identity_pending',
    )).status).toBe(200);
    expect(statements[0]?.query).toContain('e.line_account_id = ?');
    expect(statements[0]?.bindings.slice(0, 2)).toEqual(['account-a', 'identity_pending']);
  });

  it('never becomes global when no account is selected', async () => {
    const { app, statements } = harness();
    expect((await app.request('/api/ec-commerce/overview')).status).toBe(200);
    for (const statement of statements) {
      expect(statement.query).toContain('line_account_id IN (?)');
      expect(statement.bindings).toEqual(['account-a']);
    }
  });
});
