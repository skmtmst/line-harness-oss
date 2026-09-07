import { describe, expect, test } from 'vitest';
import { FEATURE_IDS } from '@line-crm/shared';
import { app } from './index.js';
import {
  FEATURE_ROUTE_MANIFEST,
  FEATURE_ROUTE_PATTERN_MANIFEST,
  routeClassification,
} from './middleware/feature-enforcement.js';

const INFRASTRUCTURE_PATTERNS = new Set(['/*', '/api/*']);

function mountedRoutes(): Array<{ method: string; path: string }> {
  const unique = new Map<string, { method: string; path: string }>();
  for (const route of app.routes) {
    if (INFRASTRUCTURE_PATTERNS.has(route.path)) continue;
    const key = `${route.method} ${route.path}`;
    unique.set(key, { method: route.method, path: route.path });
  }
  return [...unique.values()];
}

describe('feature route manifest', () => {
  test('mount 済みの全 route が feature/core/public/system のいずれかに分類される', () => {
    const unclassified = mountedRoutes().filter(({ method, path }) => !routeClassification(path, method));
    expect(unclassified).toEqual([]);
  });

  test('manifest は未知の featureId と重複 prefix を持たない', () => {
    const known = new Set<string>(FEATURE_IDS);
    const unknown = [...FEATURE_ROUTE_MANIFEST, ...FEATURE_ROUTE_PATTERN_MANIFEST].filter(
      ({ classification }) => classification.kind === 'feature' && !known.has(classification.featureId),
    );
    const prefixes = FEATURE_ROUTE_MANIFEST.map(({ prefix }) => prefix);
    const duplicates = prefixes.filter((prefix, index) => prefixes.indexOf(prefix) !== index);
    expect(unknown).toEqual([]);
    expect(duplicates).toEqual([]);
  });

  test('共通 friends prefix 内の機能 route は固有 featureId を優先する', () => {
    expect(routeClassification('/api/friends/:id/fields', 'GET')).toEqual({
      kind: 'feature', featureId: 'friend_fields',
    });
    expect(routeClassification('/api/friends/:id/support-mark', 'PATCH')).toEqual({
      kind: 'feature', featureId: 'support_marks',
    });
    expect(routeClassification('/api/friends/:id/mileage', 'GET')).toEqual({
      kind: 'feature', featureId: 'mileage',
    });
  });
});
