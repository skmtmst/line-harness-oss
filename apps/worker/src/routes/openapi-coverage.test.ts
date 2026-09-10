import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { describe, expect, test } from 'vitest';
import { app } from '../index.js';
import { routeClassification } from '../middleware/feature-enforcement.js';

/**
 * OpenAPI（GET /openapi.json）と実装の同期ゲート。
 *
 * 目的: 仕様書だけ置き去りになる状態を防ぐ。route を足したのに OpenAPI へ
 * 記載も allowlist 登録もしていないと落ちる。API の実動作は変えない。
 *
 * 対象: `/api/*` と `/webhook`、認証なし公開メタデータ 2 件
 * （GET /admin/version、GET /admin/manifest）。
 * 対象外とその理由:
 * - `/api/restaurant-test/*` … 飲食店向けテスト機能（本番では無効）
 * - `/api/internal/*` … 内部サービス間経路（内部専用口）
 * - `/admin/update/*` … 管理キー必須の内部保守口
 * - `ALL` メソッド … ミドルウェア掛け（同じ path の具体メソッドが別にある）
 * - `OPTIONS`、`/*`、`/api/*` … プリフライトと全体ミドルウェア
 * - `/openapi.json`、`/docs` … 仕様書そのもの
 * - `/auth/*`、`/book`、`/setup`、`/t/*`、`/r/*` などのページ・転送 … 公開APIではない
 *
 * 運用: 新しい route を足したら OpenAPI（openapi.ts）へ記載する。
 * ALLOWLIST への追加は原則禁止。新 route は OpenAPI 記載が必要。
 * 後続票で記載を増やしたら ALLOWLIST から消し、DOCUMENTED_MIN・
 * ALLOWLIST_MAX・BASELINE_DOCUMENTED の基準値も同じ PR で更新する。
 * version は repo の package.json と一致させる（自動取得ではなく検査で同期）。
 * request/response の中身までは見ない。本文の parity は順次対応。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const ROOT_VERSION: string = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;

const HONO_PARAM_PATTERN = /:([A-Za-z0-9_]+)/g;
const toOpenApiPath = (honoPath: string): string => honoPath.replace(HONO_PARAM_PATTERN, '{$1}');

const INFRASTRUCTURE_PATHS = new Set(['/*', '/api/*', '/openapi.json', '/docs']);

function isCoveredRoute(method: string, path: string): boolean {
  if (method === 'ALL' || method === 'OPTIONS') return false;
  if (INFRASTRUCTURE_PATHS.has(path)) return false;
  if (path.startsWith('/api/restaurant-test')) return false;
  if (path.startsWith('/api/internal')) return false;
  if (path.startsWith('/admin/update')) return false;
  return (
    path.startsWith('/api/') ||
    path === '/webhook' ||
    path === '/admin/version' ||
    path === '/admin/manifest'
  );
}

type InventoryEntry = { key: string; method: string; openApiPath: string; honoPath: string };

function mountedInventory(): Map<string, InventoryEntry> {
  const inventory = new Map<string, InventoryEntry>();
  for (const route of app.routes) {
    if (!isCoveredRoute(route.method, route.path)) continue;
    const openApiPath = toOpenApiPath(route.path);
    const key = `${route.method} ${openApiPath}`;
    if (!inventory.has(key)) {
      inventory.set(key, { key, method: route.method, openApiPath, honoPath: route.path });
    }
  }
  return inventory;
}

type Operation = {
  parameters?: Array<{ name: string; in: string; required?: boolean }>;
  responses?: Record<string, { description?: string }>;
  security?: Array<Record<string, unknown>>;
};

type OpenApiSpec = {
  openapi: string;
  info: { title: string; version: string; description?: string };
  security?: Array<Record<string, unknown>>;
  paths: Record<string, Record<string, Operation>>;
  components?: { securitySchemes?: Record<string, unknown>; schemas?: Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [extra: string]: any;
};

async function loadSpec(): Promise<OpenApiSpec> {
  const res = await app.request('/openapi.json');
  expect(res.status).toBe(200);
  return (await res.json()) as OpenApiSpec;
}

const OPERATION_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);

function documentedKeys(spec: OpenApiSpec): Map<string, { method: string; path: string }> {
  const keys = new Map<string, { method: string; path: string }>();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(item ?? {})) {
      if (!OPERATION_METHODS.has(method) || operation == null) continue;
      keys.set(`${method.toUpperCase()} ${path}`, { method: method.toUpperCase(), path });
    }
  }
  return keys;
}

function formatKeys(keys: string[]): string {
  const shown = keys.slice(0, 30).join('\n  ');
  return keys.length > 30 ? `  ${shown}\n  ほか ${keys.length - 30} 件` : `  ${shown}`;
}

/**
 * 未記載負債の基準一覧（「例外」ではない）。OpenAPI 未記載の公開 API を
 * 理由ごとに見出しで分けている。理由は feature-enforcement の
 * route manifest の分類から付けた。
 * 追加は原則禁止。新 route は openapi.ts へ記載する。
 * 後続票で記載済みにした分はここから消す（残っているとテストが落とす）。
 */
/**
 * 網羅率の後退防止ゲートの基準値（PR #1456 時点の実測＋#1446 の予約3口）。
 * - DOCUMENTED_MIN: 記載済み operation 数はここ未満へ減らせない
 * - ALLOWLIST_MAX: 未記載負債はここより増やせない
 * 後続票で記載を増やしたら、実測に合わせて両方を同じ PR で更新する。
 */
// 本流の87件(先行PR合流分)に、この票の secret-backfill 1口を足して88件。
const DOCUMENTED_MIN = 88;
const ALLOWLIST_MAX = 777;

/**
 * PR #1456 時点の記載済み 83 件＋#630 の health-summary 1 件＋#1446 の予約3口の基準一覧。
 * 既存仕様を ALLOWLIST へ移して後退させる変更を落とすためのもの。
 * 件数が変わらなくても、ここにある1件が消えたら落ちる。
 * 後続票で記載を増やしたら、増えた分をここへ足す。
 */
const BASELINE_DOCUMENTED = new Set<string>([
  'DELETE /api/affiliates/{id}',
  'DELETE /api/broadcasts/{id}',
  'DELETE /api/conversions/points/{id}',
  'DELETE /api/friends/{id}/tags/{tagId}',
  'DELETE /api/line-accounts/{id}',
  'DELETE /api/mileage/rules/{id}',
  'DELETE /api/reminders/{id}/steps/{stepId}',
  'DELETE /api/scenarios/{id}',
  'DELETE /api/scenarios/{id}/steps/{stepId}',
  'DELETE /api/tags/{id}',
  'DELETE /api/users/{id}',
  'GET /api/accounts/health-summary',
  'GET /api/affiliates',
  'GET /api/affiliates/{id}',
  'GET /api/affiliates/{id}/report',
  'GET /api/auto-replies',
  'GET /api/broadcasts',
  'GET /api/broadcasts/{id}',
  'GET /api/common-actions/resources',
  'GET /api/conversions/events',
  'GET /api/conversions/points',
  'GET /api/conversions/report',
  'GET /api/friends',
  'GET /api/friends/{friendId}/reminders',
  'GET /api/friends/{id}',
  'GET /api/friends/{id}/fields',
  'GET /api/friends/count',
  'GET /api/line-accounts',
  'GET /api/line-accounts/{id}',
  'GET /api/mileage/redemptions',
  'GET /api/mileage/rules',
  'GET /api/nen-campaigns/deliveries',
  'GET /api/nen-campaigns/deliveries/{id}',
  'GET /api/nen-campaigns/metrics/columns',
  'GET /api/nen-campaigns/metrics/flows',
  'GET /api/nen-campaigns/metrics/pets',
  'GET /api/reminders',
  'GET /api/scenarios',
  'GET /api/scenarios/{id}',
  'GET /api/scenarios/{id}/actions',
  'GET /api/scenarios/{id}/preview',
  'GET /api/scenarios/{id}/runs',
  'GET /api/scenarios/{id}/stats',
  'GET /api/scenarios/{id}/triggers',
  'GET /api/tags',
  'GET /api/tags/{id}',
  'GET /api/tags/{id}/delete-impact',
  'GET /api/tags/{id}/dependencies',
  'GET /api/users',
  'GET /api/users/{id}',
  'GET /api/users/{id}/accounts',
  'PATCH /api/line-accounts/{id}',
  'PATCH /api/line-accounts/order',
  'PATCH /api/tags/{id}',
  'POST /api/affiliates',
  'POST /api/affiliates/click',
  'POST /api/broadcasts',
  'POST /api/broadcasts/{id}/send',
  'POST /api/broadcasts/dedup-preview',
  'POST /api/conversions/points',
  'POST /api/conversions/track',
  'POST /api/friends/{id}/tags',
  'POST /api/line-accounts',
  'POST /api/mileage/rules',
  'POST /api/nen-campaigns/deliveries/{id}/retry',
  'POST /api/scenarios',
  'POST /api/scenarios/{id}/enroll/{friendId}',
  'POST /api/scenarios/{id}/publish',
  'POST /api/scenarios/{id}/simulate',
  'POST /api/scenarios/{id}/steps',
  'POST /api/settings/features/impact',
  'POST /api/tags',
  'POST /api/tags/import',
  'POST /api/tags/import/preview',
  'POST /api/rich-menu-groups/{groupId}/schedule',
  'GET /api/rich-menu-groups/{groupId}/schedules',
  'POST /api/rich-menu-groups/{groupId}/schedules/{scheduleId}/cancel',
  'POST /api/users',
  'POST /api/users/{id}/link',
  'POST /api/users/match',
  'POST /api/webhooks/maintenance/secret-backfill',
  'POST /webhook',
  'PUT /api/affiliates/{id}',
  'PUT /api/broadcasts/{id}',
  'PUT /api/friends/{id}/fields',
  'PUT /api/line-accounts/{id}',
  'PUT /api/mileage/rules/{id}',
  'PUT /api/scenarios/{id}',
  'PUT /api/scenarios/{id}/draft',
  'PUT /api/scenarios/{id}/steps/{stepId}',
  'PUT /api/users/{id}',
]);

const ALLOWLIST = new Set<string>([
  // 機能「booking」の管理画面用API（OpenAPI未記載・順次記載）（42件）
  'DELETE /api/booking/admin/menus/{id}',
  'DELETE /api/booking/admin/staff/{id}',
  'DELETE /api/booking/admin/staff/{id}/google-calendar',
  'DELETE /api/booking/admin/staff/{id}/shifts/{shiftId}',
  'DELETE /api/meet-consultations/{externalEventId}',
  'GET /api/booking/admin/alternatives',
  'GET /api/booking/admin/availability',
  'GET /api/booking/admin/bookings/{id}',
  'GET /api/booking/admin/customer-context',
  'GET /api/booking/admin/customers',
  'GET /api/booking/admin/customers/{id}',
  'GET /api/booking/admin/exceptions',
  'GET /api/booking/admin/menus',
  'GET /api/booking/admin/menus/{id}/staff',
  'GET /api/booking/admin/pending-count',
  'GET /api/booking/admin/reminder-preview',
  'GET /api/booking/admin/requests',
  'GET /api/booking/admin/requests-summary',
  'GET /api/booking/admin/resources',
  'GET /api/booking/admin/settings',
  'GET /api/booking/admin/staff',
  'GET /api/booking/admin/staff/{id}/availability-rules',
  'GET /api/booking/admin/staff/{id}/google-calendar',
  'GET /api/booking/admin/staff/{id}/menus',
  'GET /api/booking/admin/staff/{id}/shifts',
  'GET /api/meet-consultations',
  'PATCH /api/booking/admin/exceptions/{id}',
  'PATCH /api/booking/admin/menus/{id}',
  'PATCH /api/booking/admin/requests/{id}',
  'POST /api/booking/admin/bookings',
  'POST /api/booking/admin/customers',
  'POST /api/booking/admin/exceptions',
  'POST /api/booking/admin/menus',
  'POST /api/booking/admin/staff',
  'POST /api/booking/admin/staff/{id}/shifts/generate',
  'POST /api/meet-consultations',
  'PUT /api/booking/admin/menus/{id}',
  'PUT /api/booking/admin/staff/{id}',
  'PUT /api/booking/admin/staff/{id}/availability-rules',
  'PUT /api/booking/admin/staff/{id}/google-calendar',
  'PUT /api/booking/admin/staff/{id}/menus',
  'PUT /api/booking/admin/staff/{id}/shifts',

  // 機能「mileage」の管理画面用API（OpenAPI未記載・順次記載）（39件）
  'DELETE /api/scoring-rules/{id}',
  'GET /api/action-scores/bands',
  'GET /api/action-scores/friends',
  'GET /api/action-scores/rules',
  'GET /api/friends/{id}/mileage',
  'GET /api/friends/{id}/score',
  'GET /api/mileage/adjustment-policy',
  'GET /api/mileage/earning-rules',
  'GET /api/mileage/friends',
  'GET /api/mileage/history',
  'GET /api/mileage/overview',
  'GET /api/mileage/redemptions/{id}',
  'GET /api/mileage/rewards',
  'GET /api/mileage/rewards/{id}',
  'GET /api/scoring-rules',
  'GET /api/scoring-rules/{id}',
  'PATCH /api/action-scores/rules/draft',
  'PATCH /api/mileage/earning-rules/{id}/draft',
  'PATCH /api/mileage/rewards/{id}/draft',
  'POST /api/action-scores/rules/publish',
  'POST /api/action-scores/rules/stop',
  'POST /api/action-scores/rules/test',
  'POST /api/friends/{id}/score',
  'POST /api/mileage/adjustments',
  'POST /api/mileage/events',
  'POST /api/mileage/redemptions',
  'POST /api/mileage/redemptions/{id}/retry-fulfillment',
  'POST /api/mileage/rewards',
  'POST /api/mileage/rewards/{id}/codes',
  'POST /api/mileage/rewards/{id}/draft',
  'POST /api/mileage/rewards/{id}/publish',
  'POST /api/mileage/rewards/{id}/status',
  'POST /api/mileage/rewards/{id}/stop',
  'POST /api/mileage/rewards/{id}/test',
  'POST /api/scoring-rules',
  'PUT /api/mileage/adjustment-policy',
  'PUT /api/mileage/rewards-order',
  'PUT /api/mileage/rewards/{id}/draft',
  'PUT /api/scoring-rules/{id}',

  // core：友だち管理は必須機能（OpenAPI未記載・順次記載）（36件）
  'DELETE /api/friends/people/{id}/links/{friendId}',
  'DELETE /api/friends/{friendId}/rich-menu',
  'GET /api/friends/add-breakdown',
  'GET /api/friends/bulk-runs/{id}',
  'GET /api/friends/duplicates/{id}',
  'GET /api/friends/exports/{id}/download',
  'GET /api/friends/migration-jobs',
  'GET /api/friends/migrations',
  'GET /api/friends/migrations/{id}',
  'GET /api/friends/people',
  'GET /api/friends/people/{id}',
  'GET /api/friends/ref-stats',
  'GET /api/friends/saved-views',
  'GET /api/friends/stats',
  'GET /api/friends/{friendId}/rich-menu',
  'GET /api/friends/{id}/messages',
  'GET /api/friends/{id}/timeline',
  'PATCH /api/friends/duplicates/{id}',
  'PATCH /api/friends/migrations/{id}/items/{itemId}',
  'PATCH /api/friends/people/{id}',
  'PATCH /api/friends/people/{id}/delivery-priorities',
  'PATCH /api/friends/people/{id}/profile-values',
  'POST /api/friends/bulk-runs',
  'POST /api/friends/bulk-runs/preview',
  'POST /api/friends/bulk-runs/{id}/retry',
  'POST /api/friends/bulk-runs/{id}/undo',
  'POST /api/friends/exports',
  'POST /api/friends/imports',
  'POST /api/friends/imports/{id}/execute',
  'POST /api/friends/migrations',
  'POST /api/friends/migrations/{id}/execute',
  'POST /api/friends/migrations/{id}/rollback',
  'POST /api/friends/saved-views',
  'POST /api/friends/{friendId}/rich-menu',
  'POST /api/friends/{id}/messages',
  'PUT /api/friends/{id}/metadata',

  // public：LIFF内で個別認証する公開経路（OpenAPI未記載・順次記載）（36件）
  'GET /api/liff/affiliate/bank',
  'GET /api/liff/affiliate/me',
  'GET /api/liff/affiliate/offers',
  'GET /api/liff/affiliate/statements',
  'GET /api/liff/affiliate/statements/{id}/download',
  'GET /api/liff/booking/availability',
  'GET /api/liff/booking/me',
  'GET /api/liff/booking/menus',
  'GET /api/liff/booking/menus/{id}/staff',
  'GET /api/liff/config',
  'GET /api/liff/events/me',
  'GET /api/liff/events/me/{bookingId}',
  'GET /api/liff/events/{id}',
  'GET /api/liff/events/{id}/slots',
  'GET /api/liff/mileage/me',
  'GET /api/liff/mileage/rewards',
  'GET /api/liff/nen/health-logs',
  'GET /api/liff/nen/member',
  'POST /api/liff/affiliate/links',
  'POST /api/liff/affiliate/offers/{id}/enroll',
  'POST /api/liff/affiliate/register',
  'POST /api/liff/booking/requests',
  'POST /api/liff/events/me/{bookingId}/cancel',
  'POST /api/liff/events/{id}/bookings',
  'POST /api/liff/friend-add-intent',
  'POST /api/liff/link',
  'POST /api/liff/mileage/rewards/{id}/redeem',
  'POST /api/liff/nen/consultations',
  'POST /api/liff/nen/health-logs',
  'POST /api/liff/nen/pets',
  'POST /api/liff/nen/pets/{id}/photo',
  'POST /api/liff/nen/photos',
  'POST /api/liff/profile',
  'POST /api/liff/send-form-link',
  'PUT /api/liff/affiliate/bank',
  'PUT /api/liff/nen/photos/{id}/publication-consent',

  // 機能「webinars」の管理画面用API（OpenAPI未記載・順次記載）（33件）
  'DELETE /api/webinars/{id}',
  'GET /api/liff/webinars/{slug}',
  'GET /api/webinars',
  'GET /api/webinars/overview',
  'GET /api/webinars/{id}',
  'GET /api/webinars/{id}/actions',
  'GET /api/webinars/{id}/analytics',
  'GET /api/webinars/{id}/comments',
  'GET /api/webinars/{id}/ctas',
  'GET /api/webinars/{id}/editor',
  'GET /api/webinars/{id}/notifications',
  'GET /api/webinars/{id}/participants',
  'GET /api/webinars/{id}/participants.csv',
  'GET /api/webinars/{id}/publish-validation',
  'GET /api/webinars/{id}/user-comments',
  'POST /api/liff/webinars/{slug}/comments',
  'POST /api/liff/webinars/{slug}/cta-click',
  'POST /api/liff/webinars/{slug}/funnel-event',
  'POST /api/liff/webinars/{slug}/heartbeat',
  'POST /api/liff/webinars/{slug}/register',
  'POST /api/webinars',
  'POST /api/webinars/{id}/archive',
  'POST /api/webinars/{id}/duplicate',
  'POST /api/webinars/{id}/notifications/test',
  'POST /api/webinars/{id}/pause',
  'POST /api/webinars/{id}/public-page/test',
  'POST /api/webinars/{id}/publish',
  'PUT /api/webinars/{id}',
  'PUT /api/webinars/{id}/actions',
  'PUT /api/webinars/{id}/comments',
  'PUT /api/webinars/{id}/ctas',
  'PUT /api/webinars/{id}/editor',
  'PUT /api/webinars/{id}/notifications',

  // 機能「affiliates」の管理画面用API（OpenAPI未記載・順次記載）（32件）
  'DELETE /api/conversions/definitions/{id}',
  'GET /api/affiliate-offers',
  'GET /api/affiliate-offers/{id}',
  'GET /api/affiliate-payments',
  'GET /api/affiliate-payments/{id}/preview',
  'GET /api/affiliate-payout-batches/{id}/download',
  'GET /api/affiliate-settlements/preview',
  'GET /api/affiliates-report',
  'GET /api/affiliates/{id}/archive-impact',
  'GET /api/affiliates/{id}/journeys',
  'GET /api/affiliates/{id}/links',
  'GET /api/conversions/approvals',
  'GET /api/conversions/definitions',
  'GET /api/conversions/definitions/{id}',
  'GET /api/conversions/definitions/{id}/delete-impact',
  'GET /api/conversions/export',
  'GET /api/friends/{id}/journey',
  'PATCH /api/conversions/events/{id}/approval',
  'POST /api/affiliate-offers',
  'POST /api/affiliate-payments/{id}/confirm',
  'POST /api/affiliate-payout-batches',
  'POST /api/affiliate-payout-batches/{id}/export',
  'POST /api/affiliate-settlements',
  'POST /api/affiliate-statements',
  'POST /api/affiliates/{id}/archive',
  'POST /api/conversions/definitions',
  'POST /api/conversions/definitions/preview',
  'POST /api/conversions/definitions/{id}/replace',
  'POST /api/conversions/definitions/{id}/stop',
  'POST /api/conversions/definitions/{id}/usages',
  'PUT /api/affiliate-offers/{id}',
  'PUT /api/conversions/points/{id}',

  // 機能「external_integrations」の管理画面用API（OpenAPI未記載・順次記載）（29件）
  'DELETE /api/ad-platforms/{id}',
  'DELETE /api/integrations/google-calendar/{id}',
  'DELETE /api/webhooks/incoming/{id}',
  'DELETE /api/webhooks/outgoing/{id}',
  'GET /api/ad-platforms',
  'GET /api/ad-platforms/logs',
  'GET /api/ad-platforms/{id}/logs',
  'GET /api/integrations/google-calendar',
  'GET /api/integrations/google-calendar/bookings',
  'GET /api/integrations/google-calendar/slots',
  'GET /api/webhooks/incoming',
  'GET /api/webhooks/incoming/{id}',
  'GET /api/webhooks/interactions',
  'GET /api/webhooks/outgoing',
  'PATCH /api/webhooks/incoming/{id}/config',
  'POST /api/ad-platforms',
  'POST /api/ad-platforms/test',
  'POST /api/integrations/google-calendar/book',
  'POST /api/integrations/google-calendar/connect',
  'POST /api/webhooks/incoming',
  'POST /api/webhooks/incoming/{id}/receive',
  'POST /api/webhooks/interactions/retry-failed',
  'POST /api/webhooks/interactions/{id}/retry',
  'POST /api/webhooks/outgoing',
  'POST /api/webhooks/outgoing/{id}/test',
  'PUT /api/ad-platforms/{id}',
  'PUT /api/integrations/google-calendar/bookings/{id}/status',
  'PUT /api/webhooks/incoming/{id}',
  'PUT /api/webhooks/outgoing/{id}',

  // 機能「analytics」の管理画面用API（OpenAPI未記載・順次記載）（29件）
  'DELETE /api/funnels/{id}',
  'GET /api/analytics/broadcasts',
  'GET /api/analytics/cross/results/{id}',
  'GET /api/analytics/friends',
  'GET /api/analytics/funnels',
  'GET /api/analytics/funnels/{id}/runs/latest',
  'GET /api/analytics/link-clicks',
  'GET /api/analytics/messages',
  'GET /api/analytics/reactions',
  'GET /api/analytics/ref-summary',
  'GET /api/analytics/ref/{refCode}',
  'GET /api/analytics/report-schedules',
  'GET /api/analytics/routes',
  'GET /api/analytics/saved',
  'GET /api/analytics/saved/{id}/snapshots',
  'GET /api/analytics/tracked-links',
  'GET /api/analytics/url-clicks',
  'GET /api/analytics/usage',
  'GET /api/funnels',
  'GET /api/funnels/{id}/result',
  'GET /api/search-console/performance',
  'POST /api/analytics/cross/query',
  'POST /api/analytics/funnels',
  'POST /api/analytics/funnels/{id}/run',
  'POST /api/analytics/funnels/{id}/versions',
  'POST /api/analytics/report-schedules',
  'POST /api/analytics/results/{id}/audiences',
  'POST /api/analytics/saved',
  'POST /api/funnels',

  // 機能「rich_menus」の管理画面用API（OpenAPI未記載・順次記載）（25件）
  'DELETE /api/rich-menu-groups/external/{richMenuId}',
  'DELETE /api/rich-menu-groups/{groupId}',
  'DELETE /api/rich-menus/{id}',
  'GET /api/rich-menu-groups',
  'GET /api/rich-menu-groups/external',
  'GET /api/rich-menu-groups/external/{richMenuId}/image',
  'GET /api/rich-menu-groups/tap-stats',
  'GET /api/rich-menu-groups/{groupId}',
  'GET /api/rich-menu-groups/{groupId}/delete-impact',
  'GET /api/rich-menu-groups/{groupId}/usages',
  'GET /api/rich-menu-images/{key}{.+}',
  'GET /api/rich-menus',
  'PATCH /api/rich-menu-groups/{groupId}',
  'POST /api/rich-menu-groups',
  'POST /api/rich-menu-groups/import',
  'POST /api/rich-menu-groups/reorder-priorities',
  'POST /api/rich-menu-groups/{groupId}/apply-to-tag',
  'POST /api/rich-menu-groups/{groupId}/pages/{pageId}/image',
  'POST /api/rich-menu-groups/{groupId}/preview-targets',
  'POST /api/rich-menu-groups/{groupId}/publish',
  'POST /api/rich-menu-groups/{groupId}/unpublish',
  'POST /api/rich-menus',
  'POST /api/rich-menus/{id}/default',
  'POST /api/rich-menus/{id}/image',

  // 機能「automations」の管理画面用API（OpenAPI未記載・順次記載）（23件）
  'DELETE /api/automations/{id}',
  'GET /api/automation-draft-resources',
  'GET /api/automation-drafts/{id}',
  'GET /api/automation-runs',
  'GET /api/automation-templates',
  'GET /api/automations',
  'GET /api/automations/{id}',
  'GET /api/automations/{id}/logs',
  'GET /api/common-actions',
  'GET /api/common-actions/{id}',
  'POST /api/automation-drafts/{id}/publish',
  'POST /api/automation-runs/{id}/retry',
  'POST /api/automation-templates/{key}/drafts',
  'POST /api/automations/{id}/audience-preview',
  'POST /api/automations/{id}/test',
  'POST /api/common-actions',
  'POST /api/common-actions/{id}/bindings/{bindingId}/version',
  'POST /api/common-actions/{id}/duplicate',
  'POST /api/common-actions/{id}/versions',
  'POST /api/common-actions/{id}/versions/{versionId}/publish',
  'PUT /api/automation-drafts/{id}',
  'PUT /api/automations/{id}',
  'PUT /api/common-actions/{id}/draft',

  // 機能「photo_review」の管理画面用API（OpenAPI未記載・順次記載）（23件）
  'GET /api/nen-members/care-flags',
  'GET /api/nen-members/consultations',
  'GET /api/nen-members/friends/{friendId}',
  'GET /api/nen-members/overview',
  'GET /api/nen-members/photos',
  'GET /api/nen-members/photos/original-download/{token}',
  'GET /api/nen-members/photos/publications',
  'GET /api/nen-members/photos/review-metrics',
  'GET /api/nen-members/photos/{id}',
  'GET /api/nen-members/photos/{id}/assets/derivatives',
  'GET /api/nen-members/photos/{id}/assets/status',
  'GET /api/nen-members/ranks',
  'POST /api/nen-members/photos/decisions/bulk',
  'POST /api/nen-members/photos/{id}/assessments/re-evaluate',
  'POST /api/nen-members/photos/{id}/assets/process',
  'POST /api/nen-members/photos/{id}/notification/retry',
  'POST /api/nen-members/photos/{id}/original-download',
  'POST /api/nen-members/rich-menu/install',
  'POST /api/nen-members/tags/resync',
  'PUT /api/nen-members/care-flags/{id}',
  'PUT /api/nen-members/photos/publications/{id}/placements',
  'PUT /api/nen-members/photos/publications/{id}/withdraw',
  'PUT /api/nen-members/photos/{id}/review',

  // 機能「broadcasts」の管理画面用API（OpenAPI未記載・順次記載）（20件）
  'DELETE /api/broadcast-message-assets/{id}',
  'GET /api/broadcast-message-assets',
  'GET /api/broadcasts/notification-settings',
  'GET /api/broadcasts/saved-views',
  'GET /api/broadcasts/stats',
  'GET /api/broadcasts/{id}/insight',
  'GET /api/broadcasts/{id}/per-account-stats',
  'GET /api/broadcasts/{id}/preview-count',
  'GET /api/broadcasts/{id}/progress',
  'POST /api/broadcast-message-assets',
  'POST /api/broadcast-message-assets/upload',
  'POST /api/broadcasts/preflight',
  'POST /api/broadcasts/saved-views',
  'POST /api/broadcasts/{id}/cancel',
  'POST /api/broadcasts/{id}/fetch-insight',
  'POST /api/broadcasts/{id}/send-segment',
  'POST /api/broadcasts/{id}/test-send',
  'POST /api/segments/count',
  'PUT /api/broadcast-message-assets/{id}',
  'PUT /api/broadcasts/notification-settings',

  // 機能「nen_campaigns」の管理画面用API（OpenAPI未記載・順次記載）（21件）
  'DELETE /api/nen-campaigns/pets/{id}',
  'GET /api/nen-campaigns/birthday-coupon',
  'GET /api/nen-campaigns/columns',
  'GET /api/nen-campaigns/columns-preview',
  'GET /api/nen-campaigns/jobs',
  'GET /api/nen-campaigns/overview',
  'GET /api/nen-campaigns/pets',
  'GET /api/nen-campaigns/settings',
  'POST /api/nen-campaigns/columns',
  'POST /api/nen-campaigns/columns/{id}/deliver',
  'POST /api/nen-campaigns/columns/{id}/duplicate',
  'POST /api/nen-campaigns/columns/{id}/read-events',
  'POST /api/nen-campaigns/columns/{id}/test-send',
  'POST /api/nen-campaigns/deliveries/pending-now',
  'POST /api/nen-campaigns/pets',
  'POST /api/nen-campaigns/test-send',
  'PUT /api/nen-campaigns/birthday-coupon',
  'PUT /api/nen-campaigns/columns/{id}/message',
  'PUT /api/nen-campaigns/pets/{id}',
  'PUT /api/nen-campaigns/settings/{campaignKey}',
  'PUT /api/nen-campaigns/settings/{campaignKey}/enabled',

  // 機能「events」の管理画面用API（OpenAPI未記載・順次記載）（18件）
  'DELETE /api/events/admin/events/{id}',
  'DELETE /api/events/admin/events/{id}/slots/{slotId}',
  'GET /api/events/admin/events',
  'GET /api/events/admin/events/notifications/pending',
  'GET /api/events/admin/events/{id}',
  'GET /api/events/admin/events/{id}/bookings',
  'GET /api/events/admin/events/{id}/bookings/summary',
  'GET /api/events/admin/events/{id}/slots',
  'GET /api/events/admin/events/{id}/waitlist',
  'GET /api/events/admin/occurrences/{id}/applicants',
  'POST /api/events/admin/events',
  'POST /api/events/admin/events/{id}/bookings/{bookingId}/cancel',
  'POST /api/events/admin/events/{id}/bookings/{bookingId}/decide',
  'POST /api/events/admin/events/{id}/slots',
  'POST /api/events/admin/occurrences/{id}/waitlist/promote',
  'PUT /api/events/admin/events/{id}',
  'PUT /api/events/admin/events/{id}/bookings/{bookingId}',
  'PUT /api/events/admin/events/{id}/slots/{slotId}',

  // 機能「reminders」の管理画面用API（OpenAPI未記載・順次記載）（17件）
  'DELETE /api/friend-reminders/{id}',
  'DELETE /api/reminders/{id}',
  'GET /api/reminders/{id}',
  'GET /api/reminders/{id}/draft',
  'GET /api/reminders/{id}/runs',
  'PATCH /api/reminders/reorder',
  'POST /api/reminder-runs/{runId}/retry',
  'POST /api/reminders',
  'POST /api/reminders/drafts',
  'POST /api/reminders/{id}/enroll/{friendId}',
  'POST /api/reminders/{id}/preview',
  'POST /api/reminders/{id}/publish',
  'POST /api/reminders/{id}/steps',
  'POST /api/reminders/{id}/test-send',
  'POST /api/reminders/{id}/validate',
  'PUT /api/reminders/{id}',
  'PUT /api/reminders/{id}/draft',

  // 機能「inflow_tracking」の管理画面用API（OpenAPI未記載・順次記載）（16件）
  'DELETE /api/entry-routes/{id}',
  'DELETE /api/tracked-links/{id}',
  'GET /api/entry-route-genres',
  'GET /api/entry-routes',
  'GET /api/entry-routes/{id}',
  'GET /api/entry-routes/{id}/funnel',
  'GET /api/entry-routes/{id}/sources',
  'GET /api/tracked-links',
  'GET /api/tracked-links/{id}',
  'PATCH /api/entry-route-genres/{id}',
  'PATCH /api/entry-routes/{id}',
  'PATCH /api/tracked-links/{id}',
  'POST /api/entry-route-genres',
  'POST /api/entry-routes',
  'POST /api/links/wrap',
  'POST /api/tracked-links',

  // 機能「friend_add_routing」の管理画面用API（OpenAPI未記載・順次記載）（14件）
  'DELETE /api/friend-add-rules/{id}',
  'GET /api/friend-add-rules',
  'GET /api/friend-add-rules/conflicts',
  'GET /api/friend-add-rules/{id}',
  'GET /api/friend-add-runs',
  'GET /api/friend-add-runs/{id}',
  'POST /api/friend-add-rules/drafts',
  'POST /api/friend-add-rules/folders',
  'POST /api/friend-add-rules/test',
  'POST /api/friend-add-rules/{id}/publish',
  'POST /api/friend-add-rules/{id}/stop',
  'POST /api/friend-add-rules/{id}/test',
  'POST /api/friend-add-rules/{id}/validate',
  'PUT /api/friend-add-rules/{id}/draft',

  // 機能「line_notifications」の管理画面用API（OpenAPI未記載・順次記載）（14件）
  'DELETE /api/notifications/rules/{id}',
  'GET /api/line-notifications/customer-definitions',
  'GET /api/line-notifications/customer-definitions/{id}',
  'GET /api/line-notifications/deliveries',
  'GET /api/line-notifications/metrics',
  'GET /api/notifications/rules',
  'GET /api/notifications/rules/{id}',
  'PATCH /api/line-notifications/customer-definitions/{id}/draft',
  'POST /api/line-notifications/customer-definitions',
  'POST /api/line-notifications/customer-definitions/{id}/publish',
  'POST /api/line-notifications/customer-definitions/{id}/stop',
  'POST /api/line-notifications/deliveries/{id}/retry',
  'POST /api/notifications/rules',
  'PUT /api/notifications/rules/{id}',

  // 機能「ec_commerce」の管理画面用API（OpenAPI未記載・順次記載）（14件）
  'GET /api/ec-commerce/action-executions',
  'GET /api/ec-commerce/connector',
  'GET /api/ec-commerce/events',
  'GET /api/ec-commerce/identity-candidates',
  'GET /api/ec-commerce/notification-runs',
  'GET /api/ec-commerce/orders',
  'GET /api/ec-commerce/overview',
  'GET /api/ec-commerce/settings',
  'GET /api/ec-commerce/shipments',
  'GET /api/ec-commerce/subscriptions',
  'POST /api/ec-commerce/action-executions/{id}/retry',
  'POST /api/ec-commerce/test-send',
  'PUT /api/ec-commerce/connector',
  'PUT /api/ec-commerce/settings/{eventType}',

  // core：LINEアカウント選択の共通基盤（OpenAPI未記載・順次記載）（14件）
  'GET /api/line-accounts/summary',
  'GET /api/line-accounts/{id}/credential-health',
  'GET /api/line-accounts/{id}/follower-import',
  'GET /api/line-accounts/{id}/follower-insight',
  'GET /api/line-accounts/{id}/handovers',
  'PATCH /api/line-accounts/hierarchy',
  'POST /api/line-accounts/verify-connection',
  'POST /api/line-accounts/{id}/archive',
  'POST /api/line-accounts/{id}/connection-checks',
  'POST /api/line-accounts/{id}/follower-import/detect',
  'POST /api/line-accounts/{id}/follower-import/start',
  'POST /api/line-accounts/{id}/follower-import/step',
  'POST /api/line-accounts/{id}/restore',
  'PUT /api/line-accounts/default',

  // 機能「auto_replies」の管理画面用API（OpenAPI未記載・順次記載）（13件）
  'DELETE /api/auto-replies/{id}',
  'GET /api/auto-replies/conflicts',
  'GET /api/auto-replies/{id}',
  'GET /api/auto-replies/{id}/conflicts',
  'GET /api/auto-replies/{id}/draft',
  'GET /api/auto-reply-runs',
  'POST /api/auto-replies',
  'POST /api/auto-replies/drafts',
  'POST /api/auto-replies/{id}/publish',
  'POST /api/auto-replies/{id}/test',
  'POST /api/auto-replies/{id}/validate',
  'PUT /api/auto-replies/{id}',
  'PUT /api/auto-replies/{id}/draft',

  // 機能「media」の管理画面用API（OpenAPI未記載・順次記載）（13件）
  'DELETE /api/images/{key}',
  'DELETE /api/media/{id}',
  'GET /api/media',
  'GET /api/media/quota',
  'GET /api/media/{id}/delete-impact',
  'GET /api/media/{id}/replacement-impact',
  'PATCH /api/media/{id}',
  'POST /api/images',
  'POST /api/media/upload-sessions',
  'POST /api/media/upload-sessions/{id}/complete',
  'POST /api/media/{id}/replace-usages',
  'POST /api/media/{id}/replacement-preview',
  'POST /api/media/{id}/versions',

  // core：ログインユーザーと権限管理（OpenAPI未記載・順次記載）（12件）
  'DELETE /api/staff/{id}',
  'DELETE /api/staff/{id}/two-factor',
  'GET /api/staff',
  'GET /api/staff/invitations/{token}/verify',
  'GET /api/staff/me',
  'GET /api/staff/{id}',
  'GET /api/staff/{id}/login-summary',
  'PATCH /api/staff/{id}',
  'POST /api/staff',
  'POST /api/staff/invitations/confirm/verify',
  'POST /api/staff/{id}/two-factor/confirm',
  'POST /api/staff/{id}/two-factor/setup',

  // 機能「support_marks」の管理画面用API（OpenAPI未記載・順次記載）（12件）
  'DELETE /api/support-mark-rules/{ruleId}',
  'DELETE /api/support-marks/{id}',
  'GET /api/support-marks',
  'GET /api/support-marks/{id}/archive-impact',
  'GET /api/support-marks/{id}/automation-rules',
  'PATCH /api/friends/{id}/support-mark',
  'PATCH /api/support-mark-rules/{ruleId}',
  'PATCH /api/support-marks/{id}',
  'POST /api/friends/support-mark/bulk',
  'POST /api/support-marks',
  'POST /api/support-marks/{id}/archive',
  'POST /api/support-marks/{id}/automation-rules',

  // core：受信箱の会話基盤（OpenAPI未記載・順次記載）（12件）
  'GET /api/chats',
  'GET /api/chats/stats',
  'GET /api/chats/{id}',
  'GET /api/chats/{id}/events',
  'GET /api/conversations',
  'GET /api/conversations/{friendId}',
  'POST /api/chats',
  'POST /api/chats/read-all',
  'POST /api/chats/{id}/loading',
  'POST /api/chats/{id}/read',
  'POST /api/chats/{id}/send',
  'PUT /api/chats/{id}',

  // 機能「common_vars」の管理画面用API（OpenAPI未記載・順次記載）（11件）
  'DELETE /api/common-vars/{id}',
  'DELETE /api/common-vars/{id}/schedules/{scheduleId}',
  'GET /api/common-vars',
  'GET /api/common-vars/{id}',
  'GET /api/common-vars/{id}/delete-impact',
  'GET /api/common-vars/{id}/schedules',
  'PATCH /api/common-vars/{id}',
  'POST /api/common-vars',
  'POST /api/common-vars/{id}/impact-preview',
  'POST /api/common-vars/{id}/replace',
  'POST /api/common-vars/{id}/schedules',

  // 機能「templates」の管理画面用API（OpenAPI未記載・順次記載）（11件）
  'DELETE /api/message-templates/{id}',
  'DELETE /api/templates/{id}',
  'GET /api/message-templates',
  'GET /api/message-templates/{id}',
  'GET /api/templates',
  'GET /api/templates/{id}',
  'GET /api/templates/{id}/usages',
  'POST /api/message-templates',
  'POST /api/templates',
  'PUT /api/message-templates/{id}',
  'PUT /api/templates/{id}',

  // 機能「forms」の管理画面用API（OpenAPI未記載・順次記載）（10件）
  'DELETE /api/forms/{id}',
  'GET /api/forms',
  'GET /api/forms/{id}/delete-impact',
  'GET /api/forms/{id}/my-latest',
  'GET /api/forms/{id}/submissions',
  'POST /api/forms',
  'POST /api/forms/drafts',
  'POST /api/forms/{id}/archive',
  'POST /api/forms/{id}/files',
  'PUT /api/forms/{id}',

  // 機能「scenarios」の管理画面用API（OpenAPI未記載・順次記載）（10件）
  'DELETE /api/scenarios/{id}/actions/{actionId}',
  'DELETE /api/scenarios/{id}/triggers/{triggerId}',
  'GET /api/scenarios/{id}/draft',
  'PATCH /api/scenarios/reorder',
  'POST /api/scenarios/{id}/actions',
  'POST /api/scenarios/{id}/steps/reorder',
  'POST /api/scenarios/{id}/steps/{stepId}/test-send',
  'POST /api/scenarios/{id}/test-send',
  'POST /api/scenarios/{id}/triggers',
  'PUT /api/scenarios/{id}/actions/{actionId}',

  // system：保守診断と復旧（OpenAPI未記載・順次記載）（10件）
  'GET /api/admin/auto-reply-stats',
  'GET /api/admin/automations-summary',
  'GET /api/admin/friend-debug/{id}',
  'GET /api/admin/recent-messages',
  'POST /api/admin/broadcast-coverage',
  'POST /api/admin/broadcasts/{id}/reset-to-draft',
  'POST /api/admin/content-leak-check',
  'POST /api/admin/refresh-profiles',
  'POST /api/admin/tag-leak-check',
  'POST /api/admin/tag-remove-content-dups',

  // core：管理画面の共通通知（OpenAPI未記載・順次記載）（10件）
  'GET /api/notifications',
  'GET /api/notifications/center',
  'GET /api/notifications/operator-deliveries.csv',
  'GET /api/notifications/operator-rules',
  'POST /api/notifications/center/read-all',
  'POST /api/notifications/center/{id}/read',
  'POST /api/notifications/operator-events',
  'POST /api/notifications/operator-rules/recipients-preview',
  'POST /api/notifications/operator-rules/{id}/publish',
  'POST /api/notifications/operator-rules/{id}/test',

  // core：運用問い合わせ（OpenAPI未記載・順次記載）（10件）
  'GET /api/support/email/threads/{id}',
  'GET /api/support/email/threads/{id}/events',
  'GET /api/support/inbox',
  'GET /api/support/summary',
  'PATCH /api/support/email/threads/{id}/assignee',
  'PATCH /api/support/email/threads/{id}/notes',
  'PATCH /api/support/email/threads/{id}/status',
  'POST /api/support/email/read-all',
  'POST /api/support/email/threads/{id}/read',
  'POST /api/support/email/threads/{id}/reply',

  // 機能「friend_fields」の管理画面用API（OpenAPI未記載・順次記載）（9件）
  'DELETE /api/friend-fields/{id}',
  'GET /api/field-migrations/{runId}',
  'GET /api/friend-fields',
  'GET /api/friend-fields-stats',
  'PATCH /api/friend-fields/{id}',
  'POST /api/friend-fields',
  'POST /api/friend-fields/bulk',
  'POST /api/friend-fields/{id}/migration-preview',
  'POST /api/friend-fields/{id}/migrations',

  // 機能「multi_store_hierarchy」の管理画面用API（OpenAPI未記載・順次記載）（9件）
  'DELETE /api/traffic-pools/{id}',
  'DELETE /api/traffic-pools/{id}/accounts/{accountId}',
  'GET /api/traffic-pools',
  'GET /api/traffic-pools/accounts',
  'GET /api/traffic-pools/{id}/accounts',
  'POST /api/traffic-pools',
  'POST /api/traffic-pools/{id}/accounts',
  'PUT /api/traffic-pools/{id}',
  'PUT /api/traffic-pools/{id}/accounts/{accountId}',

  // system：署名検証する外部受信経路（OpenAPI未記載・順次記載）（9件）
  'GET /api/integrations/codex-monitor/status',
  'GET /api/integrations/stripe/events',
  'POST /api/integrations/codex-slack/events',
  'POST /api/integrations/eccube/columns',
  'POST /api/integrations/eccube/events',
  'POST /api/integrations/ig-harness/engagement',
  'POST /api/integrations/slack/actions',
  'POST /api/integrations/slack/events',
  'POST /api/integrations/stripe/webhook',

  // core：タグは複数機能が参照する共通基盤（OpenAPI未記載・順次記載）（8件）
  'DELETE /api/tag-groups/{id}',
  'GET /api/tag-groups',
  'PATCH /api/tag-groups/{id}',
  'PATCH /api/tags/reorder',
  'PATCH /api/tags/{id}/group',
  'PATCH /api/tags/{id}/mileage',
  'POST /api/tag-groups',
  'POST /api/tags/{id}/archive',

  // system：運用状態と監視（OpenAPI未記載・順次記載）（8件）
  'GET /api/operations/control',
  'GET /api/operations/control/preview',
  'GET /api/operations/health',
  'GET /api/operations/history',
  'GET /api/operations/incidents/{id}',
  'POST /api/operations/health/runs',
  'POST /api/operations/incidents',
  'POST /api/operations/incidents/{id}/restore',

  // core：受信箱は必須機能（OpenAPI未記載・順次記載）（7件）
  'DELETE /api/inbox/saved-views/{id}',
  'GET /api/inbox/activity-digest',
  'GET /api/inbox/saved-views',
  'GET /api/inbox/unanswered',
  'GET /api/inbox/unanswered/count',
  'PATCH /api/inbox/saved-views/{id}',
  'POST /api/inbox/saved-views',

  // core：アカウント引継ぎ（OpenAPI未記載・順次記載）（7件）
  'GET /api/account-handovers/{id}',
  'POST /api/account-handovers',
  'POST /api/account-handovers/link',
  'POST /api/account-handovers/{id}/cancel',
  'POST /api/account-handovers/{id}/execute',
  'POST /api/account-handovers/{id}/preview',
  'PUT /api/account-handovers/{id}/decisions',

  // core：LINEアカウント共通設定（OpenAPI未記載・順次記載）（7件）
  'GET /api/account-settings/link-base-url',
  'GET /api/account-settings/test-recipient-login-users',
  'GET /api/account-settings/test-recipients',
  'GET /api/account-settings/tracked-link-base-url',
  'PUT /api/account-settings/link-base-url',
  'PUT /api/account-settings/test-recipients',
  'PUT /api/account-settings/tracked-link-base-url',

  // core：ログインとセッション管理（OpenAPI未記載・順次記載）（7件）
  'GET /api/auth/line',
  'GET /api/auth/line/callback',
  'GET /api/auth/session',
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'POST /api/auth/step-up',
  'POST /api/auth/two-factor/verify',

  // core：統括管理（OpenAPI未記載・順次記載）（7件）
  'GET /api/tenants',
  'GET /api/tenants/boundary-preview',
  'GET /api/tenants/me',
  'PATCH /api/tenants/me',
  'PATCH /api/tenants/{id}/feature-packs',
  'PATCH /api/tenants/{id}/status',
  'POST /api/tenants',

  // core：管理画面の入口（OpenAPI未記載・順次記載）（6件）
  'DELETE /api/dashboard/preferences',
  'GET /api/dashboard/organization-overview',
  'GET /api/dashboard/overview',
  'GET /api/dashboard/preferences',
  'PUT /api/dashboard/preferences',
  'PUT /api/dashboard/preferences/default',

  // 機能「saved_searches」の管理画面用API（OpenAPI未記載・順次記載）（6件）
  'DELETE /api/saved-searches/{id}',
  'GET /api/saved-searches',
  'GET /api/saved-searches/{id}',
  'PATCH /api/saved-searches/{id}',
  'POST /api/saved-searches',
  'POST /api/saved-searches/preview',

  // 機能「site_tracking」の管理画面用API（OpenAPI未記載・順次記載）（5件）
  'GET /api/friends/{id}/site-events',
  'GET /api/site/pages',
  'GET /api/site/summary',
  'GET /api/site/tracking-key',
  'POST /api/site/link',

  // core：友だち本人統合の共通基盤（OpenAPI未記載・順次記載）（5件）
  'GET /api/identity-candidates',
  'GET /api/identity-candidates/{id}',
  'POST /api/identity-candidates/detect',
  'POST /api/identity-candidates/{id}/decide',
  'POST /api/identity-candidates/{id}/undo',

  // core：ヘルプ導線設定（OpenAPI未記載・順次記載）（5件）
  'GET /api/manual-links',
  'GET /api/manual-links/lookup',
  'POST /api/manual-links/check',
  'PUT /api/manual-links',
  'PUT /api/manual-links/{key}',

  // core：複数機能から使う分類基盤（OpenAPI未記載・順次記載）（4件）
  'DELETE /api/folders/{id}',
  'GET /api/folders',
  'PATCH /api/folders/{id}',
  'POST /api/folders',

  // core：受信箱の担当者管理（OpenAPI未記載・順次記載）（4件）
  'DELETE /api/operators/{id}',
  'GET /api/operators',
  'POST /api/operators',
  'PUT /api/operators/{id}',

  // core：アカウント移行と状態確認（OpenAPI未記載・順次記載）（4件）
  'GET /api/accounts/migrations',
  'GET /api/accounts/migrations/{migrationId}',
  'GET /api/accounts/{id}/health',
  'POST /api/accounts/{id}/migrate',

  // core：設定テンプレート（OpenAPI未記載・順次記載）（4件）
  'GET /api/recipes',
  'GET /api/recipes/clone-runs/{runId}',
  'GET /api/recipes/{id}',
  'POST /api/recipes/{id}/clone',

  // public：LINE利用者が行う公開フォーム操作（OpenAPI未記載・順次記載）（3件）
  'POST /api/forms/{id}/opened',
  'POST /api/forms/{id}/partial',
  'POST /api/forms/{id}/submit',

  // system：更新・版確認（OpenAPI未記載・順次記載）（2件）
  'GET /admin/manifest',
  'GET /admin/version',

  // core：権限と監査の共通基盤（OpenAPI未記載・順次記載）（2件）
  'GET /api/access/roles',
  'GET /api/access/users',

  // system：Webhook監視（OpenAPI未記載・順次記載）（2件）
  'GET /api/line-webhook-events',
  'POST /api/line-webhook-events/{id}/retry',

  // public：公開表示専用経路（OpenAPI未記載・順次記載）（2件）
  'GET /api/public/nen/adopted-photos',
  'GET /api/public/nen/gallery-preview',

  // core：機能を再度オンにするため停止対象外（OpenAPI未記載・順次記載）（2件）
  'GET /api/settings/features',
  'PUT /api/settings/features',

  // core：監査の共通基盤（OpenAPI未記載・順次記載）（1件）
  'GET /api/audit/events',

  // core：権限判定の共通基盤（OpenAPI未記載・順次記載）（1件）
  'GET /api/capabilities',

  // core：友だち重複確認（OpenAPI未記載・順次記載）（1件）
  'GET /api/duplicates/stats',

  // public：回答前に表示する公開フォーム（OpenAPI未記載・順次記載）（1件）
  'GET /api/forms/{id}',

  // core：初期設定（OpenAPI未記載・順次記載）（1件）
  'GET /api/getting-started',

  // system：稼働確認（OpenAPI未記載・順次記載）（1件）
  'GET /api/health',

  // core：共通一覧の件数（OpenAPI未記載・順次記載）（1件）
  'GET /api/list-stats',

  // core：ログイン監査（OpenAPI未記載・順次記載）（1件）
  'GET /api/login-audit',

  // public：ログイン前の看板（OpenAPI未記載・順次記載）（1件）
  'GET /api/public/brand',

  // public：公開QR生成（OpenAPI未記載・順次記載）（1件）
  'GET /api/qr',

  // public：公開サイトへ配る計測スクリプト（OpenAPI未記載・順次記載）（1件）
  'GET /api/site/script.js',

  // core：利用者の共通参照（OpenAPI未記載・順次記載）（1件）
  'GET /api/users-grouped',

  // system：クライアント障害監視（OpenAPI未記載・順次記載）（1件）
  'POST /api/client-errors',

  // system：署名済み外部完了通知（OpenAPI未記載・順次記載）（1件）
  'POST /api/meet-callback',

  // public：公開サイトからの計測受信（OpenAPI未記載・順次記載）（1件）
  'POST /api/site/collect',
]);

describe('OpenAPIと公開APIの同期', () => {
  test('versionはrepoのpackage.jsonと一致する', async () => {
    const spec = await loadSpec();
    expect(
      spec.info.version,
      `openapi.ts の version を ${ROOT_VERSION} に上げてください`,
    ).toBe(ROOT_VERSION);
  });

  test('仕様書の基本構造が壊れていない', async () => {
    const spec = await loadSpec();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title.length).toBeGreaterThan(0);
    expect(typeof spec.paths).toBe('object');
    expect(spec.components?.securitySchemes?.bearerAuth).toBeDefined();
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
  });

  test('公開APIは記載済みかallowlistのどちらかに入っている', async () => {
    const spec = await loadSpec();
    const documented = documentedKeys(spec);
    const missing = [...mountedInventory().keys()]
      .filter((key) => !documented.has(key) && !ALLOWLIST.has(key))
      .sort();
    expect(
      missing,
      `OpenAPI未記載の公開APIが ${missing.length} 件あります:\n${formatKeys(missing)}\n` +
        'openapi.ts へ記載するか、ALLOWLIST へ理由付きで登録してください。',
    ).toEqual([]);
  });

  test('記載済みだが実装に無いpathは無い（陳腐化の検出）', async () => {
    const spec = await loadSpec();
    const documented = documentedKeys(spec);
    const inventory = mountedInventory();
    const orphans = [...documented.keys()].filter((key) => !inventory.has(key)).sort();
    expect(
      orphans,
      `実装に無い記載が ${orphans.length} 件あります:\n${formatKeys(orphans)}\n` +
        'route が消えたなら openapi.ts からも消してください。',
    ).toEqual([]);
  });

  test('記載済み・廃止済みはALLOWLISTに残っていない', async () => {
    const spec = await loadSpec();
    const documented = documentedKeys(spec);
    const inventory = mountedInventory();
    const stale = [...ALLOWLIST].filter((key) => documented.has(key) || !inventory.has(key)).sort();
    expect(
      stale,
      `ALLOWLISTのうち ${stale.length} 件は記載済みか廃止済みです:\n${formatKeys(stale)}\n` +
        'ALLOWLISTから消してください。残っていると次の追加漏れを見逃します。',
    ).toEqual([]);
  });

  test('記載済みoperation数は87以上（後退禁止）', async () => {
    const spec = await loadSpec();
    const count = documentedKeys(spec).size;
    expect(
      count >= DOCUMENTED_MIN,
      `記載済みが ${count} 件で基準 ${DOCUMENTED_MIN} 件を下回っています。` +
        '既存仕様を消す・ALLOWLISTへ移す変更は禁止です。後続票で記載を増やした場合は基準値を同じPRで更新してください。',
    ).toBe(true);
  });

  test('暫定allowlistは777件以下（増加禁止）', async () => {
    expect(
      ALLOWLIST.size <= ALLOWLIST_MAX,
      `ALLOWLISTが ${ALLOWLIST.size} 件で基準 ${ALLOWLIST_MAX} 件を超えています。` +
        'ALLOWLISTへの追加は原則禁止です。新routeはopenapi.tsへ記載してください。',
    ).toBe(true);
  });

  test('基準の記載87件が残っている（allowlistへの移し替え検出）', async () => {
    const spec = await loadSpec();
    const documented = documentedKeys(spec);
    const lost = [...BASELINE_DOCUMENTED].filter((key) => !documented.has(key)).sort();
    expect(
      lost,
      `基準の記載 ${BASELINE_DOCUMENTED.size} 件のうち ${lost.length} 件が消えています:\n${formatKeys(lost)}\n` +
        '既存仕様をALLOWLISTへ移す変更は禁止です。routeが本当に消えた場合は基準一覧も同じPRで更新してください。',
    ).toEqual([]);
  });

  test('path parameterは名前まで実装と一致して宣言されている', async () => {
    const spec = await loadSpec();
    const problems: string[] = [];
    for (const [path, item] of Object.entries(spec.paths ?? {})) {
      const expected = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      for (const [method, operation] of Object.entries(item ?? {})) {
        if (!OPERATION_METHODS.has(method) || operation == null) continue;
        const declared = (operation.parameters ?? []).filter((p) => p.in === 'path');
        for (const name of expected) {
          const hit = declared.find((p) => p.name === name);
          if (!hit) problems.push(`${method.toUpperCase()} ${path}: {${name}} の宣言が無い`);
          else if (hit.required !== true) problems.push(`${method.toUpperCase()} ${path}: {${name}} に required: true が無い`);
        }
        for (const p of declared) {
          if (!expected.includes(p.name)) problems.push(`${method.toUpperCase()} ${path}: path に無い {${p.name}} を宣言している`);
        }
      }
    }
    expect(problems, `path parameterの不一致が ${problems.length} 件あります:\n${formatKeys(problems)}`).toEqual([]);
  });

  test('pathの重複・名前違いの衝突が無い', async () => {
    const spec = await loadSpec();
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const path of Object.keys(spec.paths ?? {})) {
      // 名前を消した形（/api/friends/{}/tags）で衝突を見つける
      const shape = path.replace(/\{[^}]+\}/g, '{}');
      const prev = seen.get(shape);
      if (prev !== undefined && prev !== path) collisions.push(`${prev} と ${path}`);
      else seen.set(shape, path);
    }
    expect(collisions, `pathの衝突が ${collisions.length} 件あります:\n${formatKeys(collisions)}`).toEqual([]);
  });

  test('認証の表示が実装と一致する（公開口だけsecurity空）', async () => {
    const spec = await loadSpec();
    const inventory = mountedInventory();
    const problems: string[] = [];
    for (const [key, { method, path }] of documentedKeys(spec)) {
      const entry = inventory.get(key);
      // 実装に無い記載は陳腐化テストが落とすので、ここでは飛ばす
      if (!entry) continue;
      const classification = routeClassification(entry.honoPath, method);
      const operation = spec.paths[path]?.[method.toLowerCase() as 'get'];
      if (classification?.kind === 'public') {
        if (JSON.stringify(operation?.security ?? null) !== '[]') {
          problems.push(`${key}: 認証なし公開口なのに security: [] が無い`);
        }
      } else if (operation?.security !== undefined && operation.security.length === 0) {
        problems.push(`${key}: 認証が必要なのに security: [] になっている`);
      }
    }
    expect(problems, `認証表示の不一致が ${problems.length} 件あります:\n${formatKeys(problems)}`).toEqual([]);
  });

  test('主要responseの形がある（2xxと説明文）', async () => {
    const spec = await loadSpec();
    const problems: string[] = [];
    for (const [path, item] of Object.entries(spec.paths ?? {})) {
      for (const [method, operation] of Object.entries(item ?? {})) {
        if (!OPERATION_METHODS.has(method) || operation == null) continue;
        const key = `${method.toUpperCase()} ${path}`;
        const responses = operation.responses ?? {};
        const codes = Object.keys(responses);
        if (codes.length === 0) {
          problems.push(`${key}: responses が空`);
          continue;
        }
        if (!codes.some((code) => code.startsWith('2') || code === 'default')) {
          problems.push(`${key}: 成功時（2xx）の response が無い`);
        }
        for (const code of codes) {
          if (!responses[code]?.description) problems.push(`${key} [${code}]: description が無い`);
        }
      }
    }
    expect(problems, `responseの不足が ${problems.length} 件あります:\n${formatKeys(problems)}`).toEqual([]);
  });

  test('$refの指す先がすべて存在する', async () => {
    const spec = await loadSpec();
    const broken: string[] = [];
    const resolve = (pointer: string): unknown => {
      if (!pointer.startsWith('#/')) return 'external';
      let node: unknown = spec;
      for (const raw of pointer.slice(2).split('/')) {
        // JSON Pointer (RFC 6901) のエスケープを戻す
        const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~');
        if (typeof node !== 'object' || node === null || !(segment in node)) return undefined;
        node = (node as Record<string, unknown>)[segment];
      }
      return node;
    };
    const walk = (node: unknown, at: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${at}[${index}]`));
        return;
      }
      if (typeof node !== 'object' || node === null) return;
      for (const [k, v] of Object.entries(node)) {
        if (k === '$ref' && typeof v === 'string') {
          if (resolve(v) === undefined) broken.push(`${at}: ${v}`);
        } else walk(v, `${at}.${k}`);
      }
    };
    walk(spec, '$');
    expect(broken, `参照切れが ${broken.length} 件あります:\n${formatKeys(broken)}`).toEqual([]);
  });
});
