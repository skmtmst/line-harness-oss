import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import adminUpdate from './admin-update.js';
import adminVersion from './admin-version.js';

describe('S05: HTTP self-update is retired', () => {
  it.each([
    ['POST', '/start'], ['GET', '/history'], ['GET', '/status/example'],
    ['GET', '/stream/example'], ['POST', '/rollback'],
  ])('%s %s stays closed even with the former deployment key', async (method, path) => {
    const db = { prepare: vi.fn() };
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network'));
    try {
      const app = new Hono().route('/admin/update', adminUpdate);
      const response = await app.request(`/admin/update${path}`, {
        method, headers: { 'x-admin-api-key': 'synthetic-deployment-key' },
      }, { DB: db, ADMIN_API_KEY: 'synthetic-deployment-key' });
      expect(response.status).toBe(404);
      expect(db.prepare).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it('keeps public build metadata available without credentials', async () => {
    const app = new Hono().route('/admin', adminVersion).route('/admin/update', adminUpdate);
    expect((await app.request('/admin/version', {}, {})).status).toBe(200);
    expect((await app.request('/admin/update/history', {}, {})).status).toBe(404);
  });
});
