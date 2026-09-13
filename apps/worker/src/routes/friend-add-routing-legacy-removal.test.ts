import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { app, notFoundHandler, type Env } from '../index.js';

const LEGACY_PREFIX = '/api/friend-add-routing';
const WEB_SOURCE_ROOT = resolve(process.cwd(), '../web/src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('旧 friend-add-routing HTTP 口の撤去', () => {
  test('Worker の route 表に旧口が無く、新しい rules/runs 口は残る', () => {
    const paths = app.routes.map((route) => route.path);

    expect(paths.some((path) => path === LEGACY_PREFIX || path.startsWith(`${LEGACY_PREFIX}/`))).toBe(false);
    expect(paths).toContain('/api/friend-add-rules');
    expect(paths).toContain('/api/friend-add-runs');
  });

  test.each([
    '/api/friend-add-routing',
    '/api/friend-add-routing/draft',
    '/api/friend-add-routing/validate',
    '/api/friend-add-routing/conflicts',
    '/api/friend-add-routing/draft/test',
    '/api/friend-add-routing/publish',
    '/api/friend-add-routing/events',
  ])('%s は Not found になる', async (path) => {
    const probe = new Hono<Env>();
    probe.notFound(notFoundHandler);

    const response = await probe.request(path);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Not found' });
  });

  test('Web の実装は旧 client と旧 URL を参照しない', () => {
    const matches = sourceFiles(WEB_SOURCE_ROOT)
      .filter((path) => !path.endsWith('friend-add-routing-legacy-removal.test.ts'))
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return source.includes('api.friendAddRouting') || source.includes('/api/friend-add-routing');
      });

    expect(matches).toEqual([]);
  });

  test('webhook は現役の service 実行経路を保つ', () => {
    const webhook = readFileSync(resolve(process.cwd(), 'src/routes/webhook.ts'), 'utf8');

    expect(webhook).toContain("import { applyFriendAddRouting } from '../services/friend-add-routing.js'");
    expect(webhook).toContain('await applyFriendAddRouting(');
  });
});
