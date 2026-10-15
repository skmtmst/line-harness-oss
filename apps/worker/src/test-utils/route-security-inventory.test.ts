import { describe, expect, it } from 'vitest';
import { inspectRouteSource } from './route-security-inventory.js';

describe('security route inventory', () => {
  it('includes reads, exports, writes and inherited guards, following called local helpers', () => {
    const source = `const router = new Hono();
      async function authorize(c, next) { await canAccessAllLineAccounts(); await next(); }
      router.use('/api/items/:id/*', authorize);
      router.get('/api/items/:id/export', c => c.text('csv'));
      router.get('/api/items', c => c.json([]));
      router.post('/api/items', c => c.json({}));`;
    const routes = inspectRouteSource('fixture.ts', source);
    expect(routes.map(route => route.method)).toEqual(['GET', 'GET', 'POST']);
    expect(routes[0].evidence).toContain('canAccessAllLineAccounts');
    expect(routes[1].evidence).toEqual([]);
  });
  it('does not count unused/imported guards, other routers, late middleware or comments as evidence', () => {
    const source = `import { canAccessAllLineAccounts } from './access';
      const router = new Hono(); const other = new Hono();
      function unused() { return canAccessAllLineAccounts(); }
      other.use('*', unused);
      // router.use('*', unused)
      router.delete('/api/items/:id', c => c.json({}));
      router.use('*', unused);`;
    expect(inspectRouteSource('fixture.ts', source)[0].evidence).toEqual([]);
  });
  it('removing a real boundary loses its evidence, and reports never include argument values', () => {
    const normal = `const router = new Hono(); router.put('/api/items/:id', async c => {
      await canAccessAllLineAccounts(c.env.DB, c.get('staff'), ['fixture-value']); return c.json({}); });`;
    expect(inspectRouteSource('fixture.ts', normal)[0].evidence).toEqual(['canAccessAllLineAccounts']);
    expect(inspectRouteSource('fixture.ts', normal.replace('canAccessAllLineAccounts', 'unprotected'))[0].evidence).toEqual([]);
    expect(JSON.stringify(inspectRouteSource('fixture.ts', normal))).not.toContain('fixture-value');
  });
  it('a same-named variable in another handler cannot supply scope evidence', () => {
    const routes = inspectRouteSource('fixture.ts', `const router = new Hono();
      router.get('/api/unsafe', async c => { const scope = []; return c.json(scope); });
      router.get('/api/safe', async c => { const scope = await getVisibleLineAccountScope(); return c.json(scope); });`);
    expect(routes[0].evidence).toEqual([]);
    expect(routes[1].evidence).toEqual(['getVisibleLineAccountScope']);
  });
  it('expands constant paths, loop tuples, templates and Hono on method arrays', () => {
    const routes = inspectRouteSource('fixture.ts', `const router = new Hono(); const base = '/api/items';
      router.on(['POST','DELETE'], base, async c => c.json({}));
      for (const [suffix, action] of [['approve','yes'],['reject','no']] as const)
        router.post(\`${'${base}'}/:id/${'${suffix}'}\`, async c => c.json({action}));`);
    expect(routes.map(route => route.method + ' ' + route.path)).toEqual([
      'POST /api/items', 'DELETE /api/items', 'POST /api/items/:id/approve', 'POST /api/items/:id/reject',
    ]);
  });
});
