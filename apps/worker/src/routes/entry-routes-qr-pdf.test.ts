import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = {
  getEntryRoutes: vi.fn(),
  getLineAccountScopeEntries: vi.fn(async () => []),
  getStaffById: vi.fn(async () => null),
  getStaffAccountScopeIds: vi.fn(async () => []),
  getEntryRouteById: vi.fn(),
  getLineAccountById: vi.fn(),
  createEntryRoute: vi.fn(),
  updateEntryRoute: vi.fn(),
  deleteEntryRoute: vi.fn(),
  getEntryRouteFunnel: vi.fn(),
  getEntryRouteSources: vi.fn(),
  getEntryRouteGenres: vi.fn(),
  createEntryRouteGenre: vi.fn(),
  updateEntryRouteGenre: vi.fn(),
};
vi.mock('@line-crm/db', () => mocks);

const { entryRoutes } = await import('./entry-routes.js');

const env = { DB: {} as D1Database };

function appFor(role: 'owner' | 'admin' | 'staff', permissionKeys: string[] = []) {
  const roleApp = new Hono<Env>();
  roleApp.use('*', async (c, next) => {
    c.set('staff', {
      id: `${role}-1`, name: role, role, readOnly: false, tenantId: 'tenant-a', permissionKeys,
    });
    return next();
  });
  roleApp.route('/', entryRoutes);
  return roleApp;
}

function postPdf(roleApp: Hono<Env>, id: string) {
  return roleApp.fetch(new Request(`https://example.com/api/entry-routes/${id}/qr-pdf`, {
    method: 'POST',
  }), env);
}

const activeRoute = {
  id: 'route-active', ref_code: 'summer', name: '夏の経路', is_active: 1,
  tenant_id: 'tenant-a', line_account_id: null,
  stopped_at: null, stopped_reason: null,
};
const stoppedRoute = {
  ...activeRoute, id: 'route-stopped', ref_code: 'old', is_active: 0,
  stopped_at: '2026-09-20T10:00:00+09:00', stopped_reason: '配布終了',
};

// M (止めた流入経路の QR): 印刷用 PDF はサーバーで作る。止めた経路は出さない。
describe('entry routes qr-pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEntryRouteById.mockImplementation(async (_db: unknown, id: string) => {
      if (id === 'route-active') return activeRoute;
      if (id === 'route-stopped') return stoppedRoute;
      return null;
    });
    mocks.getLineAccountById.mockResolvedValue(null);
  });

  it('権限のない職員は403', async () => {
    const response = await postPdf(appFor('staff'), 'route-active');
    expect(response.status).toBe(403);
    expect(mocks.getEntryRouteById).not.toHaveBeenCalled();
  });

  it('無い経路は404', async () => {
    const response = await postPdf(appFor('owner'), 'route-missing');
    expect(response.status).toBe(404);
  });

  it('止めた経路は409でPDFを返さない', async () => {
    const response = await postPdf(appFor('owner'), 'route-stopped');
    expect(response.status).toBe(409);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('停止しています');
  });

  it('受付中はA4のPDFを返す', async () => {
    const response = await postPdf(appFor('owner'), 'route-active');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="qr-summer.pdf"');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const head = Array.from(bytes.slice(0, 8)).map((byte) => String.fromCharCode(byte)).join('');
    expect(head).toBe('%PDF-1.4');
    const text = Array.from(bytes).map((byte) => String.fromCharCode(byte)).join('');
    expect(text).toContain('https://example.com/r/summer');
  });

  it('帳簿を書き換えない(読み取りだけ)', async () => {
    await postPdf(appFor('owner'), 'route-active');
    expect(mocks.updateEntryRoute).not.toHaveBeenCalled();
    expect(mocks.createEntryRoute).not.toHaveBeenCalled();
    expect(mocks.deleteEntryRoute).not.toHaveBeenCalled();
  });
});
