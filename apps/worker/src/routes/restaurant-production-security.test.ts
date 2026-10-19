import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { restaurantDelivery } from './restaurant-delivery.js';
import { restaurantTest } from './restaurant-test.js';

describe('S36 production rejects test feature before D1 or external calls', () => {
  it.each([
    ['GET', '/api/restaurant-test/stores'],
    ['POST', '/api/restaurant-test/delivery/webhooks/ubereats'],
    ['POST', '/internal/ubereats/sandbox-token-probe'],
  ])('%s %s is closed even with the feature flag set true', async (method, path) => {
    const prepare = vi.fn(() => { throw new Error('production test feature reached D1'); });
    const app = new Hono<Env>();
    app.route('/', restaurantDelivery); app.route('/', restaurantTest);
    const response = await app.request(path, { method }, {
      DB: { prepare }, RESTAURANT_TEST_ENABLED: 'true', DEPLOY_ENV: 'production',
    } as unknown as Env['Bindings']);
    expect(response.status).toBe(404);
    expect(prepare).not.toHaveBeenCalled();
  });
});
