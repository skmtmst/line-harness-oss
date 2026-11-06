/*
 * 画像で見張るルートの一覧（routes.mjs）の行き先が実在することの試験。
 *
 * 古い入口が残ると、見張りが 404 を撮り続けて誰も見なくなる
 * （B21：/settings/features が残っていた）。
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTES } from './routes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..', '..', 'apps', 'web', 'src', 'app');

/** app 配下の page.tsx から実在ルートの一覧を作る。 */
function listRoutes(): Set<string> {
  const routes = new Set<string>(['/']);
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry.startsWith('(') && entry.endsWith(')')) walk(full, prefix);
        else if (!entry.startsWith('_')) walk(full, `${prefix}/${entry}`);
        continue;
      }
      if (entry === 'page.tsx') routes.add(prefix === '' ? '/' : prefix);
    }
  };
  walk(APP_DIR, '');
  return routes;
}

describe('画像で見張るルートの一覧', () => {
  it('行き先がすべて実在の画面である', () => {
    const real = listRoutes();
    const dead = ROUTES.filter((route) => !real.has(route.path));
    expect(
      dead.map((route) => `${route.name}: ${route.path}`),
      '実在しない行き先があります。今の入口に直すか、一覧から外してください。',
    ).toEqual([]);
  });

  it('見張りの対象が空になっていない', () => {
    expect(ROUTES.length).toBeGreaterThan(0);
  });
});
