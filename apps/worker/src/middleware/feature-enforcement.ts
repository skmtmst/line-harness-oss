import type { Context, MiddlewareHandler } from 'hono';
import type { FeatureId } from '@line-crm/shared';
import type { Env } from '../index.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { dbFor } from '../services/db-router.js';
import { accountFeatureIsEnabled } from '../services/feature-enforcement.js';

export type RouteClassification =
  | { kind: 'feature'; featureId: FeatureId }
  | { kind: 'core' | 'public' | 'system'; reason: string };

export type FeatureRouteMetadata = {
  /** URL path の先頭。長いものを先に評価し、最初に一致した分類を使う。 */
  prefix: string;
  methods: '*';
  accountResolver: 'request-or-resource' | 'none';
  classification: RouteClassification;
};

export type FeatureRoutePatternMetadata = {
  pattern: RegExp;
  methods: readonly string[];
  accountResolver: 'request-or-resource' | 'none';
  classification: RouteClassification;
};

const feature = (prefix: string, featureId: FeatureId): FeatureRouteMetadata => ({
  prefix,
  methods: '*',
  accountResolver: 'request-or-resource',
  classification: { kind: 'feature', featureId },
});
const exempt = (
  prefix: string,
  kind: 'core' | 'public' | 'system',
  reason: string,
): FeatureRouteMetadata => ({
  prefix,
  methods: '*',
  accountResolver: 'none',
  classification: { kind, reason },
});

/**
 * Worker の route metadata 正本。固有経路を広い経路より前に置く。
 * `feature-route-manifest.test.ts` が実際に mount された全 route を照合する。
 */
export const FEATURE_ROUTE_MANIFEST: readonly FeatureRouteMetadata[] = [
  feature('/api/friends/support-mark', 'support_marks'),
  feature('/api/friends/saved-searches', 'saved_searches'),
  feature('/api/friends/fields', 'friend_fields'),
  feature('/api/friend-fields-stats', 'friend_fields'),
  feature('/api/field-migrations', 'friend_fields'),
  feature('/api/friend-fields', 'friend_fields'),
  feature('/api/friend-attributes', 'friend_fields'),
  feature('/api/support-mark-rules', 'support_marks'),
  feature('/api/support-marks', 'support_marks'),
  feature('/api/saved-searches', 'saved_searches'),
  feature('/api/scenarios', 'scenarios'),
  feature('/api/broadcasts', 'broadcasts'),
  feature('/api/broadcast-message-assets', 'broadcasts'),
  feature('/api/dedup-preview', 'broadcasts'),
  feature('/api/segments', 'broadcasts'),
  feature('/api/templates', 'templates'),
  feature('/api/message-templates', 'templates'),
  feature('/api/reminders', 'reminders'),
  feature('/api/friend-reminders', 'reminders'),
  feature('/api/reminder-runs', 'reminders'),
  feature('/api/auto-replies', 'auto_replies'),
  feature('/api/auto-reply-runs', 'auto_replies'),
  feature('/api/rich-menus', 'rich_menus'),
  feature('/api/rich-menu', 'rich_menus'),
  feature('/api/rich-menu-groups', 'rich_menus'),
  feature('/api/rich-menu-images', 'rich_menus'),
  feature('/api/tracked-links', 'inflow_tracking'),
  feature('/api/entry-routes', 'inflow_tracking'),
  feature('/api/entry-route-genres', 'inflow_tracking'),
  feature('/api/links', 'inflow_tracking'),
  feature('/api/forms', 'forms'),
  feature('/api/liff/webinars', 'webinars'),
  feature('/api/nen-members/photos', 'photo_review'),
  feature('/api/nen/photo', 'photo_review'),
  feature('/api/automations', 'automations'),
  feature('/api/automation-', 'automations'),
  feature('/api/common-actions', 'automations'),
  feature('/api/webhooks', 'external_integrations'),
  feature('/api/integrations/google-calendar', 'external_integrations'),
  feature('/api/ad-platforms', 'external_integrations'),
  feature('/api/instagram', 'external_integrations'),
  feature('/api/friend-add', 'friend_add_routing'),
  feature('/api/friend-add-routing', 'friend_add_routing'),
  feature('/api/friend-add-rules', 'friend_add_routing'),
  feature('/api/friend-add-runs', 'friend_add_routing'),
  feature('/api/traffic-pools', 'multi_store_hierarchy'),
  feature('/api/images', 'media'),
  feature('/api/media', 'media'),
  feature('/api/common-vars', 'common_vars'),
  feature('/api/contents', 'media'),
  feature('/api/analytics', 'analytics'),
  feature('/api/funnels', 'analytics'),
  feature('/api/search-console', 'analytics'),
  exempt('/api/site/collect', 'public', '公開サイトからの計測受信'),
  exempt('/api/site/script.js', 'public', '公開サイトへ配る計測スクリプト'),
  feature('/api/site', 'site_tracking'),
  feature('/api/webinars', 'webinars'),
  feature('/api/events', 'events'),
  feature('/api/booking', 'booking'),
  feature('/api/meet-consultations', 'booking'),
  feature('/api/conversions', 'affiliates'),
  feature('/api/affiliates', 'affiliates'),
  feature('/api/affiliate-', 'affiliates'),
  feature('/api/affiliates-report', 'affiliates'),
  feature('/api/mileage', 'mileage'),
  feature('/api/action-scores', 'mileage'),
  feature('/api/scoring-rules', 'mileage'),
  feature('/api/ec-commerce', 'ec_commerce'),
  feature('/api/ec-operations', 'ec_commerce'),
  feature('/api/line-notifications', 'line_notifications'),
  feature('/api/notifications/rules', 'line_notifications'),
  feature('/api/nen-campaigns', 'nen_campaigns'),
  feature('/api/nen-members', 'photo_review'),
  feature('/api/restaurant-test', 'restaurant_test'),

  exempt('/api/settings', 'core', '機能を再度オンにするため停止対象外'),
  exempt('/api/auth', 'core', 'ログインとセッション管理'),
  exempt('/api/staff', 'core', 'ログインユーザーと権限管理'),
  exempt('/api/access', 'core', '権限と監査の共通基盤'),
  exempt('/api/capabilities', 'core', '権限判定の共通基盤'),
  exempt('/api/line-accounts', 'core', 'LINEアカウント選択の共通基盤'),
  exempt('/api/friends', 'core', '友だち管理は必須機能'),
  exempt('/api/tags', 'core', 'タグは複数機能が参照する共通基盤'),
  exempt('/api/tag-groups', 'core', 'タグは複数機能が参照する共通基盤'),
  exempt('/api/inbox', 'core', '受信箱は必須機能'),
  exempt('/api/chats', 'core', '受信箱の会話基盤'),
  exempt('/api/conversations', 'core', '受信箱の会話基盤'),
  exempt('/api/dashboard', 'core', '管理画面の入口'),
  exempt('/api/notifications', 'core', '管理画面の共通通知'),
  exempt('/api/brand', 'core', '共通ブランド設定'),
  exempt('/api/public/brand', 'public', 'ログイン前の看板'),
  exempt('/api/health', 'system', '稼働確認'),
  exempt('/api/qr', 'public', '公開QR生成'),
  exempt('/api/liff', 'public', 'LIFF内で個別認証する公開経路'),
  exempt('/api/public', 'public', '公開表示専用経路'),
  exempt('/api/integrations', 'system', '署名検証する外部受信経路'),
  exempt('/api/internal', 'system', '内部サービス間経路'),
  exempt('/api/operations', 'system', '運用状態と監視'),
  exempt('/api/tenants', 'core', '統括管理'),
  exempt('/api/setup', 'core', '初期設定'),
  exempt('/api/getting-started', 'core', '初期設定'),
  exempt('/api/hq/templates', 'core', '統括ひな形。ルート内でtenantと統括編集権限を検証'),
  exempt('/api/recipes', 'core', '設定テンプレート'),
  exempt('/api/manual-links', 'core', 'ヘルプ導線設定'),
  exempt('/api/account-handovers', 'core', 'アカウント引継ぎ'),
  exempt('/api/friend-bulk-runs', 'core', '複数機能から使う友だち操作'),
  exempt('/api/friend-migrations', 'core', '友だち移行'),
  exempt('/api/users', 'core', '利用者の共通参照'),
  exempt('/api/users-grouped', 'core', '利用者の共通参照'),
  exempt('/api/operators', 'core', '受信箱の担当者管理'),
  exempt('/api/identity-candidates', 'core', '友だち本人統合の共通基盤'),
  exempt('/api/duplicates', 'core', '友だち重複確認'),
  exempt('/api/calendar', 'core', '複数予約機能の共通カレンダー'),
  exempt('/api/accounts', 'core', 'アカウント移行と状態確認'),
  exempt('/api/audit', 'core', '監査の共通基盤'),
  exempt('/api/login-audit', 'core', 'ログイン監査'),
  exempt('/api/folders', 'core', '複数機能から使う分類基盤'),
  exempt('/api/list-stats', 'core', '共通一覧の件数'),
  exempt('/api/account-settings', 'core', 'LINEアカウント共通設定'),
  exempt('/api/profile-refresh', 'system', 'LINEプロフィール同期'),
  exempt('/api/line-proxy', 'system', '監査付きLINE送信基盤'),
  exempt('/api/support', 'core', '運用問い合わせ'),
  exempt('/api/line-webhook-events', 'system', 'Webhook監視'),
  exempt('/api/client-errors', 'system', 'クライアント障害監視'),
  exempt('/api/stripe', 'system', '契約・課金基盤'),
  exempt('/api/admin', 'system', '保守診断と復旧'),
  exempt('/api/meet-callback', 'system', '署名済み外部完了通知'),

  exempt('/webhook', 'public', 'LINE署名で検証する受信経路'),
  exempt('/webhooks', 'public', '外部署名で検証する受信経路'),
  exempt('/openapi.json', 'public', '公開API仕様'),
  exempt('/docs', 'public', '公開API仕様'),
  exempt('/auth', 'public', 'ログイン開始とcallback'),
  exempt('/health', 'system', '稼働確認'),
  exempt('/t', 'public', '計測リンク'),
  exempt('/r', 'public', '公開流入リンク'),
  exempt('/o', 'public', '公開流入リンク'),
  exempt('/book', 'public', '公開予約導線'),
  exempt('/pool', 'public', '公開流入プール'),
  exempt('/images', 'public', '署名付き画像配信'),
  exempt('/setup', 'public', '初期設定画面'),
  exempt('/webinar-assets', 'public', '署名付きウェビナー素材'),
  exempt('/line-api', 'system', '監査付きLINE API proxy'),
  exempt('/line-api-data', 'system', '監査付きLINE data proxy'),
  exempt('/admin', 'system', '更新・版確認'),
];

/** 同じ prefix 内で公開経路と管理経路が分かれる例外。 */
export const FEATURE_ROUTE_PATTERN_MANIFEST: readonly FeatureRoutePatternMetadata[] = [
  {
    pattern: /^\/api\/integrations\/ai-loop\/reports$/,
    methods: ['POST'],
    accountResolver: 'none',
    classification: { kind: 'public', reason: 'HMAC署名で検証するAI開発状況の一方向報告' },
  },
  {
    pattern: /^\/api\/affiliates\/click$/,
    methods: ['POST'],
    accountResolver: 'none',
    classification: { kind: 'public', reason: '紹介コードからの公開クリック記録' },
  },
  {
    pattern: /^\/api\/friends\/[^/]+\/fields(?:\/|$)/,
    methods: ['GET', 'PUT'],
    accountResolver: 'request-or-resource',
    classification: { kind: 'feature', featureId: 'friend_fields' },
  },
  {
    pattern: /^\/api\/friends\/(?:[^/]+\/support-mark|support-mark\/bulk)(?:\/|$)/,
    methods: ['PATCH', 'POST'],
    accountResolver: 'request-or-resource',
    classification: { kind: 'feature', featureId: 'support_marks' },
  },
  {
    pattern: /^\/api\/friends\/[^/]+\/(?:mileage|score)(?:\/|$)/,
    methods: ['GET', 'POST'],
    accountResolver: 'request-or-resource',
    classification: { kind: 'feature', featureId: 'mileage' },
  },
  {
    pattern: /^\/api\/friends\/[^/]+\/site-events(?:\/|$)/,
    methods: ['GET'],
    accountResolver: 'request-or-resource',
    classification: { kind: 'feature', featureId: 'site_tracking' },
  },
  {
    pattern: /^\/api\/friends\/[^/]+\/journey(?:\/|$)/,
    methods: ['GET'],
    accountResolver: 'request-or-resource',
    classification: { kind: 'feature', featureId: 'affiliates' },
  },
  {
    pattern: /^\/api\/forms\/[^/]+$/,
    methods: ['GET'],
    accountResolver: 'none',
    classification: { kind: 'public', reason: '回答前に表示する公開フォーム' },
  },
  {
    pattern: /^\/api\/forms\/[^/]+\/(?:submit|opened|partial)$/,
    methods: ['POST'],
    accountResolver: 'none',
    classification: { kind: 'public', reason: 'LINE利用者が行う公開フォーム操作' },
  },
];

function prefixMatches(path: string, prefix: string): boolean {
  if (path === prefix) return true;
  if (prefix.endsWith('-')) return path.startsWith(prefix);
  return path.startsWith(`${prefix}/`);
}

export function routeClassification(path: string, method = 'GET'): RouteClassification | null {
  const pattern = FEATURE_ROUTE_PATTERN_MANIFEST.find(
    (item) => item.methods.includes(method.toUpperCase()) && item.pattern.test(path),
  );
  if (pattern) return pattern.classification;
  return FEATURE_ROUTE_MANIFEST.find((item) => prefixMatches(path, item.prefix))?.classification ?? null;
}

const ACCOUNT_KEYS = ['account_id', 'accountId', 'line_account_id', 'lineAccountId'] as const;

async function bodyAccountIds(c: Context<Env>): Promise<string[]> {
  if (!c.req.header('content-type')?.toLowerCase().includes('application/json')) return [];
  try {
    const body = await c.req.raw.clone().json() as Record<string, unknown>;
    for (const key of ACCOUNT_KEYS) {
      const value = body[key];
      if (typeof value === 'string' && value.trim()) return [value.trim()];
    }
    for (const key of ['accountIds', 'lineAccountIds'] as const) {
      const values = body[key];
      if (Array.isArray(values)) {
        return [...new Set(values.filter(
          (value): value is string => typeof value === 'string' && Boolean(value.trim()),
        ).map((value) => value.trim()))];
      }
    }
  } catch {
    // 入力契約のエラーは route handler に任せる。
  }
  return [];
}

async function requestAccountIds(c: Context<Env>): Promise<string[]> {
  for (const key of ACCOUNT_KEYS) {
    const value = c.req.query(key);
    if (value?.trim()) return [value.trim()];
  }
  const fromBody = await bodyAccountIds(c);
  if (fromBody.length > 0) return fromBody;
  const webinar = /^\/api\/liff\/webinars\/([^/]+)/.exec(c.req.path);
  if (webinar) {
    const row = await dbFor(c.env).prepare(
      'SELECT account_id FROM webinars WHERE slug = ?',
    ).bind(decodeURIComponent(webinar[1]!)).first<{ account_id: string | null }>();
    if (row?.account_id) return [row.account_id];
  }
  const webinarAdmin = /^\/api\/webinars\/([^/]+)/.exec(c.req.path);
  if (webinarAdmin && !['overview'].includes(webinarAdmin[1]!)) {
    const row = await dbFor(c.env).prepare(
      'SELECT account_id FROM webinars WHERE id = ?',
    ).bind(decodeURIComponent(webinarAdmin[1]!)).first<{ account_id: string | null }>();
    if (row?.account_id) return [row.account_id];
  }
  const friend = /^\/api\/friends\/([^/]+)/.exec(c.req.path);
  if (friend && !['support-mark'].includes(friend[1]!)) {
    const row = await dbFor(c.env).prepare(
      'SELECT line_account_id FROM friends WHERE id = ?',
    ).bind(decodeURIComponent(friend[1]!)).first<{ line_account_id: string | null }>();
    if (row?.line_account_id) return [row.line_account_id];
  }
  const staff = c.get('staff');
  if (staff?.assignedLineAccountId) return [staff.assignedLineAccountId];
  return [];
}

async function appendFeatureScopeMeta(c: Context<Env>, excluded: number): Promise<void> {
  if (excluded < 1 || !c.res.headers.get('content-type')?.includes('application/json')) return;
  try {
    const body = await c.res.clone().json() as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return;
    const meta = body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)
      ? body.meta as Record<string, unknown>
      : {};
    const headers = new Headers(c.res.headers);
    headers.delete('content-length');
    c.res = new Response(JSON.stringify({
      ...body,
      meta: { ...meta, featureDisabledAccounts: excluded },
    }), { status: c.res.status, headers });
  } catch {
    // JSONでない特殊応答は元のまま返す。
  }
}

/**
 * 認証・tenant scope の後、handler の前で会社の機能設定を強制する。
 * manifest は CI で全 route 分類済みのため、未知の管理 API は fail closed にする。
 */
export const featureEnforcementMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  if (c.req.method === 'OPTIONS' || !c.req.path.startsWith('/api/')) return next();
  let classification = routeClassification(c.req.path, c.req.method);
  // GET /api/forms/:id は公開表示と管理編集が同居する。認証済みなら管理APIとして
  // 機能設定を強制し、未認証の公開表示だけ既存契約を保つ。
  if (
    classification?.kind === 'public'
    && c.get('staff')
    && /^\/api\/forms\/[^/]+$/.test(c.req.path)
  ) {
    classification = { kind: 'feature', featureId: 'forms' };
  }
  if (!classification) {
    console.error(JSON.stringify({ event: 'route.feature.unclassified', method: c.req.method, path: c.req.path }));
    return c.json({
      success: false,
      error: 'APIの機能分類が未設定です',
      code: 'ROUTE_FEATURE_UNCLASSIFIED',
    }, 500);
  }
  if (classification.kind !== 'feature') return next();

  const accountIds = await requestAccountIds(c);
  const staff = c.get('staff');
  const db = dbFor(c.env);
  if (accountIds.length === 0 && c.req.method === 'GET' && staff) {
    const scope = await getVisibleLineAccountScope(db, staff);
    const states = await Promise.all(scope.ids.map(async (accountId) => ({
      accountId,
      enabled: await accountFeatureIsEnabled(db, accountId, classification.featureId),
    })));
    const enabledIds = states.filter(({ enabled }) => enabled).map(({ accountId }) => accountId);
    const excluded = states.length - enabledIds.length;
    if (enabledIds.length === 0) {
      return c.json({
        success: false,
        error: 'この機能は設定でオフになっています',
        code: 'FEATURE_DISABLED',
        featureId: classification.featureId,
      }, 403);
    }
    c.set('staff', { ...staff, featureEnabledLineAccountIds: enabledIds });
    await next();
    await appendFeatureScopeMeta(c, excluded);
    return;
  }
  if (accountIds.length === 0) {
    return c.json({
      success: false,
      error: 'LINEアカウントを指定してください',
      code: 'LINE_ACCOUNT_REQUIRED',
    }, 400);
  }
  if (staff) {
    const scope = await getVisibleLineAccountScope(db, staff);
    if (accountIds.some((accountId) => !scope.ids.includes(accountId))) {
      return c.json({
        success: false,
        error: 'このLINEアカウントを操作する権限がありません',
      }, 403);
    }
  }
  const enabled = await Promise.all(accountIds.map(
    (accountId) => accountFeatureIsEnabled(db, accountId, classification.featureId),
  ));
  if (enabled.every(Boolean)) return next();
  return c.json({
    success: false,
    error: 'この機能は設定でオフになっています',
    code: 'FEATURE_DISABLED',
    featureId: classification.featureId,
  }, 403);
};
