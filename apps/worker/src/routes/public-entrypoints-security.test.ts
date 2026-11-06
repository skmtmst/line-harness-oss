import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { app } from '../index.js';
import { isPublicApiBoundary } from '../middleware/public-api-boundary.js';
import { collectSecurityRoutes } from '../test-utils/route-security-inventory.js';

function difference(expected: Set<string>, text: string) {
  const listed = new Set([...text.matchAll(/^\| `(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ALL) ([^`]+)` \|/gm)].map(m => `${m[1]} ${m[2]}`));
  return { missing: [...expected].filter(key => !listed.has(key)), extra: [...listed].filter(key => !expected.has(key)) };
}

describe('public entrypoint inventory', () => {
  const runtime = new Set(app.routes.filter(r => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ALL'].includes(r.method)).map(r => `${r.method} ${r.path}`));
  const routes = collectSecurityRoutes(fileURLToPath(new URL('..', import.meta.url))).filter(r => runtime.has(`${r.method} ${r.path}`));
  const expected = new Set(routes.filter(r => !r.path.startsWith('/api/') || isPublicApiBoundary(r.method, r.path)).map(r => `${r.method} ${r.path}`));
  const document = readFileSync(new URL('../../../../docs/security/PUBLIC-ENTRYPOINTS.md', import.meta.url), 'utf8');

  it('lists every route outside administrator authentication, including dedicated signatures and static fallback exclusions', () => {
    expect(expected.size).toBeGreaterThan(150);
    expect(difference(expected, document)).toEqual({ missing: [], extra: [] });
    expect(document).toContain(`**${expected.size}経路**`);
  });

  it('detects an omitted route and an invented route (negative controls)', () => {
    expect(difference(expected, document.replace('| `GET /images/*` |', '| omitted |')).missing).toContain('GET /images/*');
    expect(difference(expected, document + '\n| `GET /api/public/invented` |').extra).toContain('GET /api/public/invented');
  });
});
