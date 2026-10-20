import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { collectSecurityRoutes } from './route-security-inventory.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'route-constant-'));
  directories.push(directory);
  mkdirSync(join(directory, 'routes'));
  mkdirSync(join(directory, 'public'));
  writeFileSync(join(directory, 'index.ts'), `
    import { Hono } from 'hono';
    import { requireRole } from './middleware/role-guard.js';
    import { CALLBACK } from './public/index.js';
    export const app = new Hono();
    app.use('/api/*', requireRole('admin'));
    app.post(CALLBACK, requireRole('admin'), handler);
  `);
  writeFileSync(join(directory, 'public/index.ts'), "export { INTERNAL as CALLBACK } from '../constants.js';");
  writeFileSync(join(directory, 'constants.ts'), "export const INTERNAL = '/api/guarded-callback';");
  return directory;
}

it('公開入口の別名を通した経路も権限検査へ含める', () => {
  const routes = collectSecurityRoutes(fixture());
  expect(routes).toHaveLength(1);
  expect(routes[0]).toMatchObject({ method: 'POST', path: '/api/guarded-callback', guarded: true });
});

it.each(['missing', 'computed', 'cycle'])('公開定数が解決できなければ経路を省略せず失敗する: %s', fault => {
  const directory = fixture();
  if (fault === 'missing') writeFileSync(join(directory, 'public/index.ts'), 'export {};');
  if (fault === 'computed') writeFileSync(join(directory, 'constants.ts'), "export const INTERNAL = unknownPath();");
  if (fault === 'cycle') writeFileSync(join(directory, 'constants.ts'), "export { CALLBACK as INTERNAL } from './public/index.js';");
  expect(() => collectSecurityRoutes(directory)).toThrow('Unresolved route expression');
});
