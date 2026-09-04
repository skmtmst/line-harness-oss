import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({
  getStripeEvents: vi.fn(),
  getAdConversionLogs: vi.fn(),
}));

vi.mock('@line-crm/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@line-crm/db')>(),
  getStripeEvents: mocks.getStripeEvents,
  getAdConversionLogs: mocks.getAdConversionLogs,
}));

const [{ stripe }, { adPlatforms }] = await Promise.all([
  import('./stripe.js'),
  import('./ad-platforms.js'),
]);

function app() {
  const app = new Hono<Env>();
  app.route('/', stripe);
  app.route('/', adPlatforms);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStripeEvents.mockResolvedValue([]);
  mocks.getAdConversionLogs.mockResolvedValue([]);
});

describe('外部連携ログの一覧上限', () => {
  test.each([
    ['999999', 200],
    ['-1', 100],
    ['NaN', 100],
  ])('Stripe limit=%s を最大200件以内へ直す', async (raw, expected) => {
    const response = await app().request(
      `/api/integrations/stripe/events?limit=${raw}`,
      {},
      { DB: {} as D1Database } as Env['Bindings'],
    );
    expect(response.status).toBe(200);
    expect(mocks.getStripeEvents).toHaveBeenCalledWith(
      expect.anything(),
      { friendId: undefined, eventType: undefined, limit: expected },
    );
  });

  test.each([
    ['999999', 200],
    ['-1', 50],
    ['NaN', 50],
  ])('広告ログ limit=%s を最大200件以内へ直す', async (raw, expected) => {
    const response = await app().request(
      `/api/ad-platforms/platform-1/logs?limit=${raw}`,
      {},
      { DB: {} as D1Database } as Env['Bindings'],
    );
    expect(response.status).toBe(200);
    expect(mocks.getAdConversionLogs).toHaveBeenCalledWith(
      expect.anything(),
      'platform-1',
      expected,
    );
  });
});
