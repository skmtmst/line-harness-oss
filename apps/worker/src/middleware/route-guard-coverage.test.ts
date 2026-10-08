import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { registrations, hasPriorGuard, importedRouters, exportedRouters } from '../test-utils/route-guards.js';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ readOnly: false }));
vi.mock('@line-crm/db', async (original) => ({
  ...await original<typeof import('@line-crm/db')>(),
  getStaffByAdminSession: async () => null,
  getStaffByApiKey: async () => ({ id: 'coverage-staff', name: 'Coverage', role: 'staff',
    access_level: authState.readOnly ? 'read_only' : 'full', permission_keys: '[]', tenant_status: 'active' }),
  getActiveImpersonation: async () => null,
}));
import { app } from '../index.js';


import {
  isPublicApiBoundary,
  isStaffExplicitAllow,
  isStaffSelfRouteTemplate,
  permissionForApiPath,
} from './auth.js';

/** 更新ルートごとのmiddleware引数と、登録済みの親のガードを確認する。 */
const ROUTES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'routes');
type Finding = { file: string; method: string; path: string };

function collectUnguarded(fixtures?: Record<string, string>): Finding[] {
  const sources = fixtures ?? Object.fromEntries(readdirSync(ROUTES_DIR)
    .filter((entry) => entry.endsWith('.ts') && !entry.includes('.test.'))
    .map((entry) => [entry, readFileSync(join(ROUTES_DIR, entry), 'utf8')]));
  const indexSource = fixtures ? '' : readFileSync(join(ROUTES_DIR, '..', 'index.ts'), 'utf8');
  const parentCalls = registrations(indexSource);
  const imports = importedRouters(indexSource);
  const findings: Finding[] = [];
  for (const [entry, source] of Object.entries(sources)) {
    const calls = registrations(source);
    const exports = exportedRouters(source);
    for (const route of calls.filter((call) => !['USE', 'ROUTE'].includes(call.method))) {
      if (isPublicApiBoundary(route.method, route.path)) continue;
      const mounts = parentCalls.filter((mount) => {
        if (mount.method !== 'ROUTE' || !mount.mountedRouter) return false;
        const imported = imports.get(mount.mountedRouter);
        return imported && basename(imported.module).replace(/\.js$/, '.ts') === entry
          && exports.get(imported.exported) === route.router;
      });
      const mountedPaths = mounts.map((mount) =>
        `${mount.path === '/' ? '' : mount.path.replace(/\/$/, '')}${route.path}`);
      // この検査は管理APIの共通認証を対象とする。LINE Proxy・更新エンジンの
      // 専用認証は各経路の実行試験で検証する（管理APIへ移すと必ずここで検出）。
      if (!route.path.startsWith('/api/') && !mountedPaths.some(path => path.startsWith('/api/'))) continue;
      if (route.guarded || hasPriorGuard(route, calls)) continue;
      const inherited = mounts.length > 0 && mounts.every((mount) => {
        const path = `${mount.path === '/' ? '' : mount.path.replace(/\/$/, '')}${route.path}`;
        // authMiddleware はAPI以外を通すため、親の一般認証だけでは保護済みにしない。
        return path.startsWith('/api/') && !isPublicApiBoundary(route.method, path)
          && hasPriorGuard({ ...route, router: mount.router, position: mount.position, path }, parentCalls);
      });
      if (!inherited) findings.push({ file: entry.replace(/\.ts$/, ''), method: route.method.toLowerCase(), path: route.path });
    }
  }
  return findings;
}

describe('更新系の権限ガードの網羅', () => {
  it('同じファイルの保護済みルートが未保護ルートを隠さない', () => {
    const source = `import { requireRole } from '../middleware/role-guard.js';
      router.post('/api/mixed/protected', requireRole('owner'), async c => c.json({ok:true}));
      router.put('/api/mixed/unprotected', async c => c.json({ok:true}));`;
    expect(collectUnguarded({ 'mixed.ts': source })).toEqual([
      { file: 'mixed', method: 'put', path: '/api/mixed/unprotected' },
    ]);
  });

  it('import・コメント・ハンドラ内の文字だけでは保護済みにしない', () => {
    const source = `import { requireRole } from '../middleware/role-guard.js';
      // requireRole('owner')
      router.post('/api/mixed/unprotected', async c => {
        const label = 'requireRole'; return c.json({label});
      });`;
    expect(collectUnguarded({ 'mixed.ts': source })).toEqual([
      { file: 'mixed', method: 'post', path: '/api/mixed/unprotected' },
    ]);
  });

  it('同じルーター・先に登録した一致するmiddlewareだけをガードとする', () => {
    const source = `import { requireRole as role } from '../middleware/role-guard.js';
      const owner = role('owner');
      other.use('*', owner);
      router.use('/api/safe/*', owner);
      router.post('/api/safe/update', async c => c.json({ok:true}));
      router.post('/api/unsafe/update', async c => c.json({ok:true}));
      router.use('/api/unsafe/*', owner);`;
    expect(collectUnguarded({ 'mixed.ts': source })).toEqual([
      { file: 'mixed', method: 'post', path: '/api/unsafe/update' },
    ]);
  });

  it('実際に登録した非公開更新APIは未認証・閲覧のみ・機能権限なしを拒否する', async () => {
    const routes = [...new Map(app.routes.filter(route =>
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method)
      && route.path.startsWith('/api/') && !isPublicApiBoundary(route.method, route.path)
    ).map(route => [`${route.method} ${route.path}`, route])).values()];
    expect(routes.length).toBeGreaterThan(100);
    let requestIndex = 0;
    for (const route of routes) {
      const authorization = `Bearer ${String(++requestIndex).padStart(16, '0')}`;
      const path = route.path.replace(/:[^/]+/g, 'coverage-target').replace(/\*/g, 'coverage-target');
      const env = { DB: {} as D1Database };
      const unauth = await app.request(path, { method: route.method,
        headers: { 'CF-Connecting-IP': `unauth-${route.method}-${path}` } }, env as never);
      expect(unauth.status, `${route.method} ${route.path}: unauthenticated`).toBe(401);
      authState.readOnly = true;
      const readOnly = await app.request(path, { method: route.method,
        headers: { Authorization: authorization, 'CF-Connecting-IP': `readonly-${path}` } }, env as never);
      expect(readOnly.status, `${route.method} ${route.path}: readonly`).toBe(403);
      authState.readOnly = false;
      // 本人系と明示許可は正当な契約。運営用は専用の登録・権限試験が守る。
      if (isStaffSelfRouteTemplate(route.method, route.path)
        || isStaffExplicitAllow(route.method, route.path) || path.startsWith('/api/ops/')) continue;
      const denied = await app.request(path, { method: route.method,
        headers: { Authorization: authorization, 'CF-Connecting-IP': `staff-${path}` } }, env as never);
      expect(denied.status, `${route.method} ${route.path}: no permission`).toBe(403);
    }
  });

  it('すべての管理更新APIはルート単位で保護されている', () => {
    const findings = collectUnguarded();
    expect(findings, findings.map(f => `${f.method.toUpperCase()} ${f.path} (${f.file})`).join('\n'))
      .toEqual([]);
  });
});

/**
 * N-423 (#670): staff 権限の deny-by-default の網羅。
 *
 * authMiddleware は staff に対して、公開境界・本人系・明示許可・権限表の
 * いずれにも入らない管理 API を 403 にする。新しい管理 API を足して
 * 権限の帰属を決め忘れると、下のテストが落ちて気づける。
 * 意図的な owner/admin 専用だけを SNAPSHOT に列挙する。
 * 追加・削除の際は権限の帰属を決めてから直す。追記で回避しないこと。
 */
const API_ROUTE_CALL = /\.(get|post|put|patch|delete|options|all)\(\s*['"](\/api\/[^'"]+)['"]/g;

function isStaffApiFailClosed(entry: string): boolean {
  const space = entry.indexOf(' ');
  const method = entry.slice(0, space);
  const path = entry.slice(space + 1);
  if (isPublicApiBoundary(method, path)) return false;
  if (isStaffSelfRouteTemplate(method, path)) return false;
  if (isStaffExplicitAllow(method, path)) return false;
  if (permissionForApiPath(path) !== null) return false;
  return true;
}

function collectStaffApiClassification(extraRoutes: string[] = []): { all: string[]; failClosed: string[] } {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  const files = readdirSync(join(srcDir, 'routes'))
    .filter((entry) => entry.endsWith('.ts') && !entry.includes('.test.'))
    .map((entry) => join(srcDir, 'routes', entry));
  files.push(join(srcDir, 'index.ts'));
  const seen = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(API_ROUTE_CALL)) {
      seen.add(`${match[1].toUpperCase()} ${match[2]}`);
    }
  }
  for (const route of extraRoutes) seen.add(route);
  const all = [...seen].sort();
  const failClosed = all.filter(isStaffApiFailClosed);
  return { all, failClosed };
}

/**
 * fail-closed (staff 403) が意図どおりの一覧。
 *
 * 新しい管理 API はここに入るとテストが落ちる。権限の帰属を決めて
 * auth.ts の対応表か本人系に足すか、owner/admin 専用が正しければ
 * この一覧へ足す。どちらも PR の差分に残る。
 */
const STAFF_FAIL_CLOSED_SNAPSHOT: string[] = [
    'DELETE /api/ad-platforms/:id',
    'DELETE /api/affiliates/:id',
    'DELETE /api/broadcast-message-assets/:id',
    'DELETE /api/hq/banners/images/:id',
    'DELETE /api/hq/templates/:id',
    'DELETE /api/hq/templates/folders/:id',
    'DELETE /api/hq/templates/media',
    'DELETE /api/images/:key',
    'DELETE /api/integrations/google-calendar/:id',
    'DELETE /api/line-account-folders/:id',
    'DELETE /api/line-account-tags/:id',
    'DELETE /api/line-accounts/:id',
    'DELETE /api/notifications/rules/:id',
    'DELETE /api/ops/announcements/:id',
    'DELETE /api/ops/support/tickets/:id/draft',
    'DELETE /api/restaurant-test/menus/:id',
    'DELETE /api/staff/:id',
    'DELETE /api/traffic-pools/:id',
    'DELETE /api/traffic-pools/:id/accounts/:accountId',
    'DELETE /api/users/:id',
    'GET /api/account-handovers/:id',
    'GET /api/account-settings/link-base-url',
    'GET /api/account-settings/test-recipient-login-users',
    'GET /api/account-settings/test-recipients',
    'GET /api/account-settings/tracked-link-base-url',
    'GET /api/accounts/migrations',
    'GET /api/accounts/migrations/:migrationId',
    'GET /api/ad-platforms',
    'GET /api/ad-platforms/:id/logs',
    'GET /api/ad-platforms/logs',
    'GET /api/admin/auto-reply-stats',
    'GET /api/admin/automations-summary',
    'GET /api/admin/friend-debug/:id',
    'GET /api/admin/recent-messages',
    'GET /api/affiliate-offers',
    'GET /api/affiliate-offers/:id',
    'GET /api/affiliate-offers/:id/cap-status',
    'GET /api/affiliate-offers/:id/versions',
    'GET /api/affiliate-payments',
    'GET /api/affiliate-payments/:id/preview',
    'GET /api/affiliate-payout-batches/:id/download',
    'GET /api/affiliate-settlements/current',
    'GET /api/affiliate-settlements/preview',
    'GET /api/affiliates',
    'GET /api/affiliates-report',
    'GET /api/affiliates/:id',
    'GET /api/affiliates/:id/archive-impact',
    'GET /api/affiliates/:id/journeys',
    'GET /api/affiliates/:id/links',
    'GET /api/affiliates/:id/report',
    'GET /api/broadcast-message-assets',
    'GET /api/broadcast-message-assets/:id/versions',
    'GET /api/broadcast-message-assets/counts',
    'GET /api/broadcast-message-assets/folders',
    'GET /api/duplicates/stats',
    'GET /api/field-migrations/:runId',
    'GET /api/friend-fields-stats',
    'GET /api/hq/banners/generations/:id',
    'GET /api/hq/banners/images',
    'GET /api/hq/banners/images/:id',
    'GET /api/hq/banners/presets',
    'GET /api/hq/banners/projects',
    'GET /api/hq/banners/projects/:id',
    'GET /api/hq/banners/stats',
    'GET /api/hq/banners/usage',
    'GET /api/hq/billing/invoices',
    'GET /api/hq/billing/preview',
    'GET /api/hq/billing/summary',
    'GET /api/hq/operator-history',
    'GET /api/hq/support/context',
    'GET /api/hq/support/kinds',
    'GET /api/hq/support/requests',
    'GET /api/hq/support/requests/:id',
    'GET /api/hq/templates',
    'GET /api/hq/templates/:id',
    'GET /api/hq/templates/:id/distributions/:runId',
    'GET /api/hq/templates/:id/received-versions',
    'GET /api/hq/templates/:id/versions',
    'GET /api/hq/templates/:id/versions/compare',
    'GET /api/hq/templates/accounts',
    'GET /api/hq/templates/attribute-kind-counts',
    'GET /api/hq/templates/folders',
    'GET /api/hq/templates/kind-counts',
    'GET /api/hq/templates/message-references',
    'GET /api/identity-candidates',
    'GET /api/identity-candidates/:id',
    'GET /api/integrations/codex-monitor/status',
    'GET /api/integrations/google-calendar',
    'GET /api/integrations/google-calendar/bookings',
    'GET /api/integrations/google-calendar/slots',
    'GET /api/integrations/google-sheets/connection',
    'GET /api/integrations/google-sheets/oauth/callback',
    'GET /api/integrations/google-sheets/runs',
    'GET /api/integrations/stripe/events',
    'GET /api/integrations/tiktok-pnl/status',
    'GET /api/line-account-tags',
    'GET /api/line-accounts/:id',
    'GET /api/line-accounts/:id/credential-health',
    'GET /api/line-accounts/:id/follower-import',
    'GET /api/line-accounts/:id/follower-insight',
    'GET /api/line-accounts/:id/handovers',
    'GET /api/line-accounts/:id/skipped-deliveries',
    'GET /api/line-webhook-events',
    'GET /api/list-stats',
    'GET /api/login-audit',
    'GET /api/manual-links',
    'GET /api/manual-links/lookup',
    'GET /api/notifications',
    'GET /api/notifications/center',
    'GET /api/notifications/operator-deliveries.csv',
    'GET /api/notifications/operator-event-types',
    'GET /api/notifications/operator-rules',
    'GET /api/notifications/rules',
    'GET /api/notifications/rules/:id',
    'GET /api/notifications/teams',
    'GET /api/operations/alerts',
    'GET /api/operations/control',
    'GET /api/operations/control/preview',
    'GET /api/operations/health',
    'GET /api/operations/history',
    'GET /api/operations/incidents/:id',
    'GET /api/operations/send-paths',
    'GET /api/ops/announcements',
    'GET /api/ops/audit',
    'GET /api/ops/dashboard',
    'GET /api/ops/dashboard/line-unregistered',
    'GET /api/ops/impersonation/current',
    'GET /api/ops/knowledge',
    'GET /api/ops/knowledge/:id',
    'GET /api/ops/me',
    'GET /api/ops/members',
    'GET /api/ops/notice-line-account',
    'GET /api/ops/support/summary',
    'GET /api/ops/support/tickets',
    'GET /api/ops/support/tickets/:id',
    'GET /api/ops/tenants',
    'GET /api/ops/tenants/:id',
    'GET /api/postal-code/search',
    'GET /api/recipes',
    'GET /api/recipes/:id',
    'GET /api/recipes/clone-runs/:runId',
    'GET /api/restaurant-test/google/oauth/callback',
    'GET /api/restaurant-test/inbound-emails',
    'GET /api/restaurant-test/intake-addresses',
    'GET /api/restaurant-test/login-members',
    'GET /api/search-console/performance',
    'GET /api/settings/features',
    'GET /api/site/pages',
    'GET /api/site/summary',
    'GET /api/site/tracking-key',
    'GET /api/staff/:id/login-summary',
    'GET /api/staff/last-logins',
    'GET /api/tenants',
    'GET /api/tenants/boundary-preview',
    'GET /api/tenants/me/company-contact',
    'GET /api/traffic-pools',
    'GET /api/traffic-pools/:id/accounts',
    'GET /api/traffic-pools/accounts',
    'GET /api/users',
    'GET /api/users-grouped',
    'GET /api/users/:id',
    'GET /api/users/:id/accounts',
    'PATCH /api/hq/banners/images/:id',
    'PATCH /api/hq/banners/projects/:id',
    'PATCH /api/hq/templates/:id',
    'PATCH /api/hq/templates/folders/:id',
    'PATCH /api/line-account-folders/:id',
    'PATCH /api/line-account-tags/:id',
    'PATCH /api/line-accounts/:id',
    'PATCH /api/line-accounts/hierarchy',
    'PATCH /api/line-accounts/order',
    'PATCH /api/ops/members/:staffId',
    'PATCH /api/ops/support/tickets/:id',
    'PATCH /api/ops/tenants/:id/feature-packs',
    'PATCH /api/ops/tenants/:id/status',
    'PATCH /api/restaurant-test/approvals/:id',
    'PATCH /api/restaurant-test/memberships/:id',
    'PATCH /api/restaurant-test/menu/:id',
    'PATCH /api/restaurant-test/menus/:id',
    'PATCH /api/restaurant-test/stores/:id',
    'PATCH /api/restaurant-test/tables/:id',
    'PATCH /api/tenants/:id/feature-packs',
    'PATCH /api/tenants/:id/status',
    'PATCH /api/tenants/me',
    'PATCH /api/tenants/me/company-contact',
    'POST /api/account-handovers',
    'POST /api/account-handovers/:id/cancel',
    'POST /api/account-handovers/:id/execute',
    'POST /api/account-handovers/:id/preview',
    'POST /api/account-handovers/:id/rollback',
    'POST /api/account-handovers/link',
    'POST /api/accounts/:id/migrate',
    'POST /api/ad-platforms',
    'POST /api/ad-platforms/:id/connect',
    'POST /api/ad-platforms/:id/cost-import',
    'POST /api/ad-platforms/logs/:id/retry',
    'POST /api/ad-platforms/test',
    'POST /api/admin/broadcast-coverage',
    'POST /api/admin/broadcasts/:id/reset-to-draft',
    'POST /api/admin/content-leak-check',
    'POST /api/admin/refresh-profiles',
    'POST /api/admin/tag-leak-check',
    'POST /api/admin/tag-remove-content-dups',
    'POST /api/affiliate-offers',
    'POST /api/affiliate-offers/:id/versions',
    'POST /api/affiliate-payments/:id/confirm',
    'POST /api/affiliate-payout-batches',
    'POST /api/affiliate-payout-batches/:id/export',
    'POST /api/affiliate-settlements',
    'POST /api/affiliate-statements',
    'POST /api/affiliates',
    'POST /api/affiliates/:id/archive',
    'POST /api/broadcast-message-assets',
    'POST /api/broadcast-message-assets/:id/publish',
    'POST /api/broadcast-message-assets/folders',
    'POST /api/broadcast-message-assets/upload',
    'POST /api/hq/banners/generations/:id/cancel',
    'POST /api/hq/banners/generations/:id/run',
    'POST /api/hq/banners/images/:id/deliver',
    'POST /api/hq/banners/projects',
    'POST /api/hq/banners/projects/:id/duplicate',
    'POST /api/hq/banners/projects/:id/generations',
    'POST /api/hq/banners/projects/:id/uploads',
    'POST /api/hq/billing/checkout',
    'POST /api/hq/billing/portal',
    'POST /api/hq/support/requests',
    'POST /api/hq/support/requests/:id/messages',
    'POST /api/hq/templates',
    'POST /api/hq/templates/:id/distribute',
    'POST /api/hq/templates/:id/duplicate',
    'POST /api/hq/templates/:id/preflight',
    'POST /api/hq/templates/:id/versions/:version/restore',
    'POST /api/hq/templates/folders',
    'POST /api/hq/templates/media',
    'POST /api/identity-candidates/:id/decide',
    'POST /api/identity-candidates/:id/undo',
    'POST /api/identity-candidates/detect',
    'POST /api/integrations/google-calendar/book',
    'POST /api/integrations/google-calendar/connect',
    'POST /api/integrations/google-sheets/connect/start',
    'POST /api/integrations/google-sheets/disconnect',
    'POST /api/integrations/google-sheets/sync',
    'POST /api/integrations/ig-harness/engagement',
    'POST /api/integrations/tiktok-pnl/sync',
    'POST /api/line-account-folders',
    'POST /api/line-account-tags',
    'POST /api/line-accounts',
    'POST /api/line-accounts/:id/activate',
    'POST /api/line-accounts/:id/archive',
    'POST /api/line-accounts/:id/connection-checks',
    'POST /api/line-accounts/:id/deactivate',
    'POST /api/line-accounts/:id/follower-import/detect',
    'POST /api/line-accounts/:id/follower-import/start',
    'POST /api/line-accounts/:id/follower-import/step',
    'POST /api/line-accounts/:id/restore',
    'POST /api/line-accounts/connect',
    'POST /api/line-accounts/connect/check',
    'POST /api/line-accounts/verify-connection',
    'POST /api/line-webhook-events/:id/retry',
    'POST /api/links/wrap',
    'POST /api/manual-links/check',
    'POST /api/notifications/center/:id/read',
    'POST /api/notifications/center/read-all',
    'POST /api/notifications/operator-events',
    'POST /api/notifications/operator-outbox/sweep',
    'POST /api/notifications/operator-rules/:id/publish',
    'POST /api/notifications/operator-rules/:id/test',
    'POST /api/notifications/operator-rules/recipients-preview',
    'POST /api/notifications/rules',
    'POST /api/operations/alerts/:id/acknowledge',
    'POST /api/operations/alerts/:id/notifications/retry',
    'POST /api/operations/health/runs',
    'POST /api/operations/incidents',
    'POST /api/operations/incidents/:id/restore',
    'POST /api/operations/incidents/:id/restore-preview',
    'POST /api/ops/announcements',
    'POST /api/ops/announcements/preview',
    'POST /api/ops/billing/sync',
    'POST /api/ops/impersonation/end',
    'POST /api/ops/impersonation/pii-reveal',
    'POST /api/ops/impersonation/read',
    'POST /api/ops/impersonation/start',
    'POST /api/ops/impersonation/write',
    'POST /api/ops/knowledge/:id/feedback',
    'POST /api/ops/knowledge/:id/review',
    'POST /api/ops/knowledge/tickets/:id/process',
    'POST /api/ops/knowledge/tickets/:id/retry',
    'POST /api/ops/members',
    'POST /api/ops/members/:staffId/resend-invite',
    'POST /api/ops/support/tickets',
    'POST /api/ops/support/tickets/:id/draft/ai',
    'POST /api/ops/support/tickets/:id/reply',
    'POST /api/recipes',
    'POST /api/recipes/:id/clone',
    'POST /api/restaurant-test/gbp/posts',
    'POST /api/restaurant-test/google/changes/:id/send',
    'POST /api/restaurant-test/google/connect/select-location',
    'POST /api/restaurant-test/google/connect/start',
    'POST /api/restaurant-test/google/disconnect',
    'POST /api/restaurant-test/google/posts/:id/publish',
    'POST /api/restaurant-test/google/posts/:id/remove',
    'POST /api/restaurant-test/google/reviews/:id/reply',
    'POST /api/restaurant-test/inbound-emails/:id/manual-import',
    'POST /api/restaurant-test/inbound/reservations',
    'POST /api/restaurant-test/intake-addresses',
    'POST /api/restaurant-test/inventory/generate',
    'POST /api/restaurant-test/memberships',
    'POST /api/restaurant-test/menu',
    'POST /api/restaurant-test/stores',
    'POST /api/restaurant-test/stores/connect',
    'POST /api/restaurant-test/tables',
    'POST /api/restaurant-test/terms-agreement',
    'POST /api/segments/count',
    'POST /api/settings/features/impact',
    'POST /api/site/link',
    'POST /api/staff',
    'POST /api/staff/:id/resend-invitation',
    'POST /api/staff/:id/resend-invite',
    'POST /api/tenants',
    'POST /api/traffic-pools',
    'POST /api/traffic-pools/:id/accounts',
    'POST /api/users',
    'POST /api/users/:id/link',
    'POST /api/users/match',
    'PUT /api/account-handovers/:id/decisions',
    'PUT /api/account-settings/link-base-url',
    'PUT /api/account-settings/test-recipients',
    'PUT /api/account-settings/tracked-link-base-url',
    'PUT /api/ad-platforms/:id',
    'PUT /api/affiliate-offers/:id',
    'PUT /api/affiliates/:id',
    'PUT /api/broadcast-message-assets/:id',
    'PUT /api/integrations/google-calendar/bookings/:id/status',
    'PUT /api/integrations/google-sheets/target',
    'PUT /api/line-accounts/:id',
    'PUT /api/line-accounts/:id/folder',
    'PUT /api/line-accounts/:id/tags',
    'PUT /api/line-accounts/default',
    'PUT /api/manual-links',
    'PUT /api/manual-links/:key',
    'PUT /api/notifications/rules/:id',
    'PUT /api/ops/announcements/:id',
    'PUT /api/ops/knowledge/:id',
    'PUT /api/ops/notice-line-account',
    'PUT /api/ops/support/tickets/:id/draft',
    'PUT /api/restaurant-test/gbp/reviews/:id/draft',
    'PUT /api/restaurant-test/inventory/:id',
    'PUT /api/restaurant-test/inventory/allocation',
    'PUT /api/restaurant-test/line-flows/:id',
    'PUT /api/restaurant-test/memberships/:id/login',
    'PUT /api/restaurant-test/opening-hours',
    'PUT /api/restaurant-test/tables/layout',
    'PUT /api/settings/company',
    'PUT /api/settings/features',
    'PUT /api/traffic-pools/:id',
    'PUT /api/traffic-pools/:id/accounts/:accountId',
    'PUT /api/users/:id',

];

describe('staff 権限の deny-by-default の網羅 (N-423 #670)', () => {
  it('新しい管理 API は公開・本人・権限表のいずれかに入るか fail-closed で止まること', () => {
    const { failClosed } = collectStaffApiClassification();
    expect(
      failClosed,
      '権限表に無い管理 API が増えています。' +
        '権限の帰属を決めて auth.ts の対応表か本人系に足すか、' +
        '意図的な owner/admin 専用なら SNAPSHOT へ足してください。',
    ).toEqual(STAFF_FAIL_CLOSED_SNAPSHOT);
  });

  it('fail-closed の一覧に残骸が無いこと', () => {
    const { all } = collectStaffApiClassification();
    const routes = new Set(all);
    const stale = STAFF_FAIL_CLOSED_SNAPSHOT.filter((entry) => !routes.has(entry));
    expect(
      stale,
      `消えた経路が SNAPSHOT に残っています: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('staff配下の固定1セグメント管理routeを本人用:idとして除外しないこと', () => {
    const fixedRoutes = ['GET /api/staff/export', 'PATCH /api/staff/policy'];
    const { failClosed } = collectStaffApiClassification(fixedRoutes);
    expect(failClosed).toEqual([...STAFF_FAIL_CLOSED_SNAPSHOT, ...fixedRoutes].sort());
    expect(failClosed).not.toEqual(STAFF_FAIL_CLOSED_SNAPSHOT);
  });
});
