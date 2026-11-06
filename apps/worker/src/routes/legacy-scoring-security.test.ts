import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { scoring } from './scoring.js';

const paths = [
  ['GET', '/api/scoring-rules'], ['GET', '/api/scoring-rules/foreign-rule'],
  ['POST', '/api/scoring-rules'], ['PUT', '/api/scoring-rules/foreign-rule'],
  ['DELETE', '/api/scoring-rules/foreign-rule'],
] as const;
const contexts = [
  ['owner', 'tenant-a', false], ['owner', 'tenant-b', false], ['admin', 'tenant-a', false],
  ['staff', 'tenant-a', false], ['staff', 'tenant-a', true],
] as const;

describe('S07 legacy scoring cannot expose or mutate unassigned global rules', () => {
  for (const [role, tenantId, readOnly] of contexts) {
    it.each(paths)(`${role}/${tenantId}/readonly=${readOnly}: %s %s is retired before D1`, async (method, path) => {
      const prepare = vi.fn(() => { throw new Error('retired API reached D1'); });
      const app = new Hono<Env>();
      app.use('*', async (c, next) => {
        c.set('staff', { id: 'fixture-member', name: 'Fixture', role, tenantId, readOnly });
        await next();
      });
      app.route('/', scoring);
      const response = await app.request(path, {
        method, headers: { 'Content-Type': 'application/json' },
        ...(['POST', 'PUT'].includes(method) ? { body: JSON.stringify({ name: 'Fixture', eventType: 'follow', scoreValue: 1 }) } : {}),
      }, { DB: { prepare } } as unknown as Env['Bindings']);
      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({ success: false, code: 'LEGACY_SCORING_RETIRED' });
      expect(prepare).not.toHaveBeenCalled();
    });
  }
});
