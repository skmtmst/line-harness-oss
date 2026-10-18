import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectSecurityRoutes, inspectRouteSource } from './route-security-inventory.js';

describe('security route inventory', () => {
  it('follows nested imported registrars with only prior, matching guards on the same router', () => {
    const root = mkdtempSync(join(tmpdir(), 'security-nested-registrar-'));
    try {
      mkdirSync(join(root, 'routes/feature'), { recursive: true });
      writeFileSync(join(root, 'index.ts'), `import router from './routes/feature.js';
        const app = new Hono(); app.route('/api', router);`);
      const entry = `import { install } from './feature/register.js';
        const router = new Hono(); const other = new Hono();
        other.use('*', requireRole('owner'));
        router.use('/safe/*', authMiddleware);
        install(router);
        router.use('*', authMiddleware);
        export default router;`;
      writeFileSync(join(root, 'routes/feature.ts'), entry);
      writeFileSync(join(root, 'routes/feature/register.ts'), `import { leaf } from './leaf.js';
        export function install(target: Hono<Env>) { leaf(target); }
        export function unused(target: Hono<Env>) { target.post('/unused', c => c.json({})); }`);
      writeFileSync(join(root, 'routes/feature/leaf.ts'), `export function leaf(target: Hono<Env>) {
        target.post('/safe/write', c => c.json({}));
        target.post('/unsafe/write', c => c.json({}));
        target.post('/explicit/write', requireRole('owner'), c => c.json({})); }`);
      const scan = () => collectSecurityRoutes(root).map(route => [route.path, route.guarded]);
      expect(scan()).toEqual([['/api/explicit/write', true], ['/api/safe/write', true], ['/api/unsafe/write', false]]);
      writeFileSync(join(root, 'routes/feature.ts'), entry.replace("router.use('/safe/*', authMiddleware);", ''));
      expect(scan()).toEqual([['/api/explicit/write', true], ['/api/safe/write', false], ['/api/unsafe/write', false]]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('retains every mount of a shared router factory and rereads changed source', () => {
    const root = mkdtempSync(join(tmpdir(), 'security-shared-mount-'));
    try {
      mkdirSync(join(root, 'routes'));
      writeFileSync(join(root, 'index.ts'), `import { router } from './routes/shared.js';
        const app = new Hono(); app.route('/api/store', router); app.route('/api/hq', router);`);
      const source = `export const router = new Hono();
        function register(app: Hono<Env>) { app.get('/items', c => c.json({})); }
        register(router);`;
      const file = join(root, 'routes/shared.ts');
      writeFileSync(file, source);
      expect(collectSecurityRoutes(root).map(r => `${r.method} ${r.path}`)).toEqual([
        'GET /api/hq/items', 'GET /api/store/items',
      ]);
      writeFileSync(file, source.replace("app.get('/items', c => c.json({}));", ''));
      expect(collectSecurityRoutes(root)).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('follows invoked router factories and excludes unused factories sharing a parameter name', () => {
    const root = mkdtempSync(join(tmpdir(), 'security-factory-'));
    try {
      mkdirSync(join(root, 'routes'));
      const entry = `import { register as install, unused } from './routes/factory.js';
        const app = new Hono(); const other = new Hono(); install(app); unused(other);`;
      writeFileSync(join(root, 'index.ts'), entry);
      writeFileSync(join(root, 'routes/factory.ts'), `const base = '/api/items';
        export function register(app: Hono<Env>) { app.get(base, c => c.json({}));
          app.put(base + '/:id', c => c.json({})); }
        export function unused(app: Hono<Env>) { app.delete('/api/unused', c => c.json({})); }`);
      expect(collectSecurityRoutes(root).map(r => r.method + ' ' + r.path)).toEqual([
        'GET /api/items', 'PUT /api/items/:id',
      ]);
      writeFileSync(join(root, 'index.ts'), entry.replace('install(app);', ''));
      expect(collectSecurityRoutes(root)).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

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
  it('keeps recursive shared guard evidence for every method without leaking it to other paths', () => {
    const source = `const router = new Hono();
      function first() { second(); canAccessAllLineAccounts(); }
      function second() { first(); verifyCallerLineIdentity(); }
      router.use('/api/items/*', first);
      router.on(['GET', 'POST'], '/api/items/:id', c => c.json({}));
      router.get('/api/outside', c => c.json({}));
      router.use('*', c => { getVisibleLineAccountScope(); });
      router.get('/api/later', c => c.json({}));`;
    const routes = inspectRouteSource('fixture.ts', source);
    expect(routes.map(route => [route.method, route.path, route.evidence])).toEqual([
      ['GET', '/api/items/:id', ['canAccessAllLineAccounts', 'verifyCallerLineIdentity']],
      ['POST', '/api/items/:id', ['canAccessAllLineAccounts', 'verifyCallerLineIdentity']],
      ['GET', '/api/outside', []],
      ['GET', '/api/later', ['getVisibleLineAccountScope']],
    ]);
    expect(inspectRouteSource('fixture.ts', source.replace('canAccessAllLineAccounts()', 'unprotected()'))[0].evidence)
      .toEqual(['verifyCallerLineIdentity']);
  });
});

it('S07 inventories typed Hono registrar parameters and their guards',()=>{
 const source=`export function register(app: Hono<Env>, visible: MiddlewareHandler<Env>) {
  app.get('/api/derived/:id', visible, c=>c.json({}));
  app.put('/api/derived/:id', requireRole('owner'), visible, c=>c.json({}));
 }`;
 expect(inspectRouteSource('registrar.ts',source).map(r=>[r.router,r.method,r.path])).toEqual([['app','GET','/api/derived/:id'],['app','PUT','/api/derived/:id']]);
});
