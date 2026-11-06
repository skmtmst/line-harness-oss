import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { registerUberConnectionManagementRoutes } from './restaurant-delivery-uber-connection-management.js';
import { uberOAuthModeForConnection } from './restaurant-delivery-uber.js';

let database: SqliteD1;
let env: Env['Bindings'];
let role: 'owner' | 'admin' | 'staff';

function app(): Hono<Env> {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', role } as never);
    await next();
  });
  registerUberConnectionManagementRoutes(instance, {
    deliveryStore: async () => ({
      id: 'store-1', name: 'Store', organizationId: 'org-1', lineAccountId: 'account-1',
    }),
    isoFromMs: (value) => value === null || value === undefined ? null : new Date(value).toISOString(),
  });
  return instance;
}

async function request(path: string, method: 'POST' | 'DELETE', body: unknown): Promise<Response> {
  return await app().request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, env);
}

beforeEach(() => {
  database = createTestD1({ loginPolicy: 'off' });
  role = 'owner';
  env = {
    DB: database.db,
    RT_DELIVERY_SEND_ENABLED: 'true',
    RT_DELIVERY_UBEREATS_CLIENT_ID: 'test-client-id',
    RT_DELIVERY_UBEREATS_CLIENT_SECRET: 'test-client-secret',
    WORKER_PUBLIC_URL: 'https://worker.example.test',
    LINE_CREDENTIAL_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  } as Env['Bindings'];
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('must not call provider'))));
});

afterEach(() => vi.unstubAllGlobals());

describe('Uber connection management route guards', () => {
  it('uses normal connect for an unmapped pending OAuth retry and reconnect only for mapped stores', () => {
    expect(uberOAuthModeForConnection({ status: 'pending_store', uber_store_id: null })).toBe('connect');
    expect(uberOAuthModeForConnection({ status: 'disconnected', uber_store_id: 'uber-store-1' })).toBe('connect');
    expect(uberOAuthModeForConnection({ status: 'expired', uber_store_id: 'uber-store-1' })).toBe('reconnect');
  });

  it('requires explicit disconnect confirmation before any provider or D1 lookup', async () => {
    const response = await request('/api/restaurant-test/delivery/ubereats/connection', 'DELETE', {});
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'confirmation_required' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows only owners and admins to check or disconnect', async () => {
    role = 'staff';
    const response = await request('/api/restaurant-test/delivery/ubereats/connection', 'DELETE', {
      confirmed: true,
    });
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends nothing while the delivery outbound gate is disabled', async () => {
    env.RT_DELIVERY_SEND_ENABLED = 'false';
    const response = await request('/api/restaurant-test/delivery/ubereats/connection/check', 'POST', {});
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'delivery_send_disabled' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
