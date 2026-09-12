import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@line-crm/db', () => ({
  getStaffByAdminSession: async () => null,
  getStaffByApiKey: async () => null,
}));

import {
  isPublicApiBoundary,
  isStaffExplicitAllow,
  isStaffSelfRouteTemplate,
  permissionForApiPath,
} from './auth.js';

/**
 * 更新系の経路に、役割の指定が付いているかを機械的に確かめる。
 *
 * requireRole の仕組みは前からあったのに、3ファイルにしか使われていなかった。
 * 付け忘れても何も起きないので気づけなかった、というのが原因だと考えている。
 * このテストは「新しい更新系APIを足したのに権限を書き忘れた」ときに落ちる。
 *
 * まだ全経路にガードを付け終えていないため、いまは ALLOWLIST で未対応分を
 * 明示している。ガードを足すたびに ALLOWLIST から消していき、最後に空になる。
 * 逆に、ALLOWLIST に無い新しい経路が無防備だと即座に落ちる。
 */

const ROUTES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'routes');

/** 認証そのものを通さない公開経路。権限の対象外。 */
const PUBLIC_PREFIXES = [
  // /admin/update/* は x-admin-api-key での専用認証を router 自身が持つ。
  // 通常の認証を通らないので c.get('staff') が無く、requireRole は使えない。
  '/start',
  '/status/',
  '/stream/',
  '/api/liff/',
  '/api/integrations/',
  '/webhook',
  '/webhooks/xserver/',
  '/api/affiliates/click',
  '/auth/',
  '/api/auth/',
  '/setup',
  '/api/meet-callback',
  '/t/',
  '/r/',
  '/pool/',
  '/api/forms/',
  // サイトスクリプトの受け口。外のサイトのブラウザから直接叩かれるので
  // 認証が置けない（鍵を置いてもページのソースに出る）。
  // 代わりにレート制限を掛け、受け取る中身を絞り、何も返さない。
  '/api/site/',
];

/**
 * 役割ガードを付けていない更新系。
 *
 * 0.22.0 で全て潰し終えた。ここが空である限り、権限を決めずに更新系APIを
 * 足すとテストが落ちる。追記して回避してはいけない。追記が必要になったのは、
 * 権限を決めずにAPIを足したということ。
 *
 * admin-auth と meet-callback は認証そのものを通さない公開経路なので、
 * PUBLIC_PREFIXES 側で対象外になっている。
 */
const ALLOWLIST = new Set<string>([]);

const MUTATING = /\.(post|put|patch|delete)\(\s*'([^']+)'/g;

type Finding = { file: string; method: string; path: string };

function collectUnguarded(): Finding[] {
  const findings: Finding[] = [];
  for (const entry of readdirSync(ROUTES_DIR)) {
    if (!entry.endsWith('.ts') || entry.includes('.test.')) continue;
    const source = readFileSync(join(ROUTES_DIR, entry), 'utf8');
    const guarded = source.includes('requireRole');
    if (guarded) continue;
    for (const match of source.matchAll(MUTATING)) {
      const [, method, path] = match;
      if (PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;
      findings.push({ file: entry.replace(/\.ts$/, ''), method, path });
    }
  }
  return findings;
}

describe('更新系の権限ガードの網羅', () => {
  it('役割ガードの無い更新系は、既知の未対応分だけであること', () => {
    const unexpected = [...new Set(collectUnguarded().map((f) => f.file))]
      .filter((file) => !ALLOWLIST.has(file))
      .sort();
    expect(
      unexpected,
      `役割ガードの無い更新系APIが増えています: ${unexpected.join(', ')}\n` +
        '権限対応表に沿って requireRole を付けてください。ALLOWLIST への追記で回避しないこと。',
    ).toEqual([]);
  });

  it('ガード済みのファイルは ALLOWLIST に残っていないこと', () => {
    // 付け終わったのに ALLOWLIST に残っていると、次の付け忘れを見逃す。
    const stillListed: string[] = [];
    for (const entry of readdirSync(ROUTES_DIR)) {
      if (!entry.endsWith('.ts') || entry.includes('.test.')) continue;
      const name = entry.replace(/\.ts$/, '');
      if (!ALLOWLIST.has(name)) continue;
      const source = readFileSync(join(ROUTES_DIR, entry), 'utf8');
      if (source.includes('requireRole')) stillListed.push(name);
    }
    expect(
      stillListed,
      `ガードを付け終えたので ALLOWLIST から消してください: ${stillListed.join(', ')}`,
    ).toEqual([]);
  });

  it('未対応の残数を可視化する（減っていくことを確認するため）', () => {
    const remaining = new Set(collectUnguarded().map((f) => f.file)).size;
    // 0 になったら ALLOWLIST ごと削除してよい。
    expect(remaining).toBeLessThanOrEqual(ALLOWLIST.size);
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
    'DELETE /api/hq/templates/:id',
    'DELETE /api/images/:key',
    'DELETE /api/integrations/google-calendar/:id',
    'DELETE /api/line-accounts/:id',
    'DELETE /api/notifications/rules/:id',
    'DELETE /api/staff/:id',
    'DELETE /api/traffic-pools/:id',
    'DELETE /api/traffic-pools/:id/accounts/:accountId',
    'DELETE /api/users/:id',
    'GET /api/access/roles',
    'GET /api/access/users',
    'GET /api/account-handovers/:id',
    'GET /api/account-settings/link-base-url',
    'GET /api/account-settings/test-recipient-login-users',
    'GET /api/account-settings/test-recipients',
    'GET /api/account-settings/tracked-link-base-url',
    'GET /api/accounts/:id/health',
    // サイドバーの警告数をまとめて返す口。個別の
    // `GET /api/accounts/:id/health` と同じ扱い(owner/admin 専用)。
    // N+1 を1回にしただけで、見える範囲は広げていない(#630)。
    'GET /api/accounts/health-summary',
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
    'GET /api/affiliate-payments',
    'GET /api/affiliate-payments/:id/preview',
    'GET /api/affiliate-payout-batches/:id/download',
    'GET /api/affiliate-settlements/preview',
    'GET /api/affiliates',
    'GET /api/affiliates-report',
    'GET /api/affiliates/:id',
    'GET /api/affiliates/:id/archive-impact',
    'GET /api/affiliates/:id/journeys',
    'GET /api/affiliates/:id/links',
    'GET /api/affiliates/:id/report',
    'GET /api/audit/events',
    'GET /api/broadcast-message-assets',
    'GET /api/duplicates/stats',
    'GET /api/field-migrations/:runId',
    'GET /api/friend-fields-stats',
    'GET /api/hq/templates',
    'GET /api/hq/templates/:id',
    'GET /api/hq/templates/:id/distributions/:runId',
    'GET /api/hq/templates/accounts',
    'GET /api/identity-candidates',
    'GET /api/identity-candidates/:id',
    'GET /api/integrations/codex-monitor/status',
    'GET /api/integrations/google-calendar',
    'GET /api/integrations/google-calendar/bookings',
    'GET /api/integrations/google-calendar/slots',
    'GET /api/integrations/stripe/events',
    'GET /api/line-accounts/:id',
    'GET /api/line-accounts/:id/credential-health',
    'GET /api/line-accounts/:id/follower-import',
    'GET /api/line-accounts/:id/follower-insight',
    'GET /api/line-accounts/:id/handovers',
    'GET /api/line-webhook-events',
    'GET /api/list-stats',
    'GET /api/login-audit',
    'GET /api/manual-links',
    'GET /api/manual-links/lookup',
    'GET /api/notifications',
    'GET /api/notifications/center',
    'GET /api/notifications/operator-deliveries.csv',
    'GET /api/notifications/operator-rules',
    'GET /api/notifications/rules',
    'GET /api/notifications/rules/:id',
    'GET /api/operations/control',
    'GET /api/operations/control/preview',
    'GET /api/operations/health',
    'GET /api/operations/history',
    'GET /api/operations/incidents/:id',
    'GET /api/recipes',
    'GET /api/recipes/:id',
    'GET /api/recipes/clone-runs/:runId',
    'GET /api/restaurant-test/intake-addresses',
    'GET /api/search-console/performance',
    'GET /api/site/pages',
    'GET /api/site/summary',
    'GET /api/site/tracking-key',
    'GET /api/staff/:id/login-summary',
    'GET /api/tenants',
    'GET /api/tenants/boundary-preview',
    'GET /api/traffic-pools',
    'GET /api/traffic-pools/:id/accounts',
    'GET /api/traffic-pools/accounts',
    'GET /api/users',
    'GET /api/users-grouped',
    'GET /api/users/:id',
    'GET /api/users/:id/accounts',
    'PATCH /api/hq/templates/:id',
    'PATCH /api/line-accounts/:id',
    'PATCH /api/line-accounts/hierarchy',
    'PATCH /api/line-accounts/order',
    'PATCH /api/restaurant-test/approvals/:id',
    'PATCH /api/restaurant-test/stores/:id',
    'PATCH /api/tenants/:id/feature-packs',
    'PATCH /api/tenants/:id/status',
    'PATCH /api/tenants/me',
    'POST /api/account-handovers',
    'POST /api/account-handovers/:id/cancel',
    'POST /api/account-handovers/:id/execute',
    'POST /api/account-handovers/:id/preview',
    'POST /api/account-handovers/link',
    'POST /api/accounts/:id/migrate',
    'POST /api/ad-platforms',
    'POST /api/ad-platforms/test',
    'POST /api/admin/broadcast-coverage',
    'POST /api/admin/broadcasts/:id/reset-to-draft',
    'POST /api/admin/content-leak-check',
    'POST /api/admin/refresh-profiles',
    'POST /api/admin/tag-leak-check',
    'POST /api/admin/tag-remove-content-dups',
    'POST /api/affiliate-offers',
    'POST /api/affiliate-payments/:id/confirm',
    'POST /api/affiliate-payout-batches',
    'POST /api/affiliate-payout-batches/:id/export',
    'POST /api/affiliate-settlements',
    'POST /api/affiliate-statements',
    'POST /api/affiliates',
    'POST /api/affiliates/:id/archive',
    'POST /api/broadcast-message-assets',
    'POST /api/broadcast-message-assets/upload',
    'POST /api/hq/templates',
    'POST /api/hq/templates/:id/distribute',
    'POST /api/hq/templates/:id/preflight',
    'POST /api/identity-candidates/:id/decide',
    'POST /api/identity-candidates/:id/undo',
    'POST /api/identity-candidates/detect',
    'POST /api/integrations/google-calendar/book',
    'POST /api/integrations/google-calendar/connect',
    'POST /api/integrations/ig-harness/engagement',
    'POST /api/line-accounts',
    'POST /api/line-accounts/:id/archive',
    'POST /api/line-accounts/:id/connection-checks',
    'POST /api/line-accounts/:id/follower-import/detect',
    'POST /api/line-accounts/:id/follower-import/start',
    'POST /api/line-accounts/:id/follower-import/step',
    'POST /api/line-accounts/:id/restore',
    'POST /api/line-accounts/verify-connection',
    'POST /api/line-webhook-events/:id/retry',
    'POST /api/links/wrap',
    'POST /api/manual-links/check',
    'POST /api/notifications/center/:id/read',
    'POST /api/notifications/center/read-all',
    'POST /api/notifications/operator-events',
    'POST /api/notifications/operator-rules/:id/publish',
    'POST /api/notifications/operator-rules/:id/test',
    'POST /api/notifications/operator-rules/recipients-preview',
    'POST /api/notifications/rules',
    'POST /api/operations/health/runs',
    'POST /api/operations/incidents',
    'POST /api/operations/incidents/:id/restore',
    'POST /api/recipes/:id/clone',
    'POST /api/restaurant-test/gbp/posts',
    'POST /api/restaurant-test/inbound/reservations',
    'POST /api/restaurant-test/intake-addresses',
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
    'PUT /api/line-accounts/:id',
    'PUT /api/line-accounts/default',
    'PUT /api/manual-links',
    'PUT /api/manual-links/:key',
    'PUT /api/notifications/rules/:id',
    'PUT /api/restaurant-test/gbp/reviews/:id/draft',
    'PUT /api/restaurant-test/inventory/:id',
    'PUT /api/restaurant-test/line-flows/:id',
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
