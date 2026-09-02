import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  getLineAccountById: vi.fn(),
  addPoolAccount: vi.fn(),
  getTrafficPoolById: vi.fn(),
  createScenario: vi.fn(),
  createReminder: vi.fn(),
  getReminderById: vi.fn(),
  getScenarioById: vi.fn(),
  getFolderById: vi.fn(),
  lineClient: vi.fn(),
}));

vi.mock('../services/account-access.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/account-access.js')>(),
  canAccessAllLineAccounts: mocks.canAccess,
}));
vi.mock('@line-crm/line-sdk', () => ({ LineClient: mocks.lineClient }));
vi.mock('@line-crm/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@line-crm/db')>(),
  getLineAccountById: mocks.getLineAccountById,
  addPoolAccount: mocks.addPoolAccount,
  getTrafficPoolById: mocks.getTrafficPoolById,
  createScenario: mocks.createScenario,
  createReminder: mocks.createReminder,
  getReminderById: mocks.getReminderById,
  getScenarioById: mocks.getScenarioById,
  getFolderById: mocks.getFolderById,
}));

const [{ ecCommerce }, { trafficPools }, { scenarios }, { reminders }] = await Promise.all([
  import('./ec-commerce.js'), import('./traffic-pools.js'), import('./scenarios.js'), import('./reminders.js'),
]);

function app(route: Hono<any>) {
  const instance = new Hono<any>();
  instance.use('*', async (c, next) => {
    const statement = { bind: () => statement, first: vi.fn(async () => null), run: vi.fn(async () => ({})), all: vi.fn(async () => ({ results: [] })) };
    c.env = { DB: { prepare: () => statement } as unknown as D1Database };
    c.set('staff' as never, { id: 'owner', role: 'owner', tenantId: 'tenant-a' } as never);
    await next();
  });
  instance.route('/', route);
  return instance;
}

function post(body: unknown) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

const ecBody = { eventType: 'ec.order.confirmed', accountId: 'account', title: 'test', introText: '', outroText: '', buttonLabel: '', buttonUrl: '', imageUrl: '' };
const scenarioRow = { id: 'scenario', name: 'test', description: null, trigger_type: 'manual', trigger_tag_id: null, is_active: 1, delivery_mode: 'relative', allow_concurrent: 1, display_order: 0, folder_id: null, audience_condition_json: null, on_complete_mode: 'pause', on_complete_scenario_id: null, created_at: '', updated_at: '' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
  mocks.getLineAccountById.mockResolvedValue(null);
  mocks.addPoolAccount.mockResolvedValue({ id: 'member' });
  mocks.getTrafficPoolById.mockResolvedValue({ id: 'pool', active_account_id: 'own' });
  mocks.createScenario.mockResolvedValue(scenarioRow);
  mocks.createReminder.mockResolvedValue({ id: 'reminder', name: 'test', created_at: '' });
  mocks.getReminderById.mockResolvedValue({ id: 'reminder', line_account_id: 'own' });
  mocks.getScenarioById.mockResolvedValue({ ...scenarioRow, line_account_id: 'own', steps: [] });
  mocks.getFolderById.mockResolvedValue(null);
});

describe('A-5 body account tenant scope', () => {
  test('EC test-send rejects another tenant before account lookup or LINE request', async () => {
    mocks.canAccess.mockResolvedValue(false);
    const response = await app(ecCommerce).request('/api/ec-commerce/test-send', post(ecBody));
    expect(response.status).toBe(403);
    expect(mocks.getLineAccountById).not.toHaveBeenCalled();
    expect(mocks.lineClient).not.toHaveBeenCalled();
  });

  test('traffic pool rejects another tenant before adding the account', async () => {
    mocks.canAccess.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const response = await app(trafficPools).request('/api/traffic-pools/pool/accounts', post({ lineAccountId: 'other' }));
    expect(response.status).toBe(403);
    expect(mocks.addPoolAccount).not.toHaveBeenCalled();
  });

  test.each([
    ['scenario', scenarios, '/api/scenarios', { name: 'test', triggerType: 'manual', lineAccountId: 'other' }, mocks.createScenario],
    ['reminder', reminders, '/api/reminders', { name: 'test', lineAccountId: 'other' }, mocks.createReminder],
  ] as const)('%s rejects another tenant before creation', async (_name, route, path, body, create) => {
    mocks.canAccess.mockResolvedValue(false);
    const response = await app(route).request(path, post(body));
    expect(response.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  test.each([
    ['traffic pool', trafficPools, '/api/traffic-pools/pool'],
    ['scenario', scenarios, '/api/scenarios/scenario'],
    ['reminder', reminders, '/api/reminders/reminder'],
  ] as const)('%s :id route hides a saved record from another tenant', async (_name, route, path) => {
    mocks.canAccess.mockResolvedValue(false);
    const response = await app(route).request(path);
    expect(response.status).toBe(404);
  });

  test('own-tenant accounts continue through all four routes', async () => {
    expect((await app(ecCommerce).request('/api/ec-commerce/test-send', post(ecBody))).status).toBe(400);
    expect((await app(trafficPools).request('/api/traffic-pools/pool/accounts', post({ lineAccountId: 'own' }))).status).toBe(201);
    expect((await app(scenarios).request('/api/scenarios', post({ name: 'test', triggerType: 'manual', lineAccountId: 'own' }))).status).toBe(201);
    expect((await app(reminders).request('/api/reminders', post({ name: 'test', lineAccountId: 'own' }))).status).toBe(201);
  });

  test('reminder requires a LINE account before creation', async () => {
    const response = await app(reminders).request('/api/reminders', post({ name: 'test' }));
    expect(response.status).toBe(400);
    expect(mocks.createReminder).not.toHaveBeenCalled();
  });

  test('reminder rejects a folder belonging to another feature', async () => {
    mocks.getFolderById.mockResolvedValue({ id: 'folder', kind: 'tag' });
    const response = await app(reminders).request(
      '/api/reminders',
      post({ name: 'test', lineAccountId: 'own', folderId: 'folder' }),
    );
    expect(response.status).toBe(422);
    expect(mocks.createReminder).not.toHaveBeenCalled();
  });

  test('reminder accepts a reminder folder', async () => {
    mocks.getFolderById.mockResolvedValue({ id: 'folder', kind: 'reminder' });
    const response = await app(reminders).request(
      '/api/reminders',
      post({ name: 'test', lineAccountId: 'own', folderId: 'folder' }),
    );
    expect(response.status).toBe(201);
    expect(mocks.createReminder).toHaveBeenCalled();
  });
});
