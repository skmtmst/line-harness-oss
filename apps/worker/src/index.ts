import { escapeHtml as escapeHtmlAttribute } from './lib/html-escape.js';
import { logger, resumeInvocation, withInvocation } from '@line-crm/shared/server';
import { setHolidayCoverageWarningHandler } from '@line-crm/shared';
import { stagingQa } from './routes/staging-qa.js';
import { qaEnabled, qaOutboundStopped, qaSafeBindings, withQaOutboundBoundary } from './services/staging-qa-safety.js';
import { scheduled } from './cron/scheduled.js';
import { apiContractMiddleware } from './middleware/api-contract.js';

import { accountAiFeatures } from './routes/account-ai-features.js';
import { broadcastSimulation } from './routes/broadcast-simulation.js';
import { bookingPassNotices } from './routes/booking-pass-notices.js';
import { bookingPassBilling } from './routes/booking-pass-billing.js';
import { deliveryPurposePreview } from './routes/delivery-purpose-preview.js';
import { mcpRpc } from './routes/mcp-rpc.js';
import { customerSegments } from './routes/customer-segments.js';
import { memberRanks } from './routes/member-ranks.js';
import { storeComparison } from './routes/store-comparison.js';
import { ecAutoLine } from './routes/ec-auto-line.js';
import { bookingPassPlans } from './routes/booking-pass-plans.js';
import { bookingGap3 } from './routes/booking-gap3.js';
import { aiAnswerLogs } from './routes/ai-answer-logs.js';
import { mcpConnections } from './routes/mcp-connections.js';

import { operatorPush } from './routes/operator-push.js';
import { aiDrafts } from './routes/ai-drafts.js';
import { broadcastAb } from './routes/broadcast-ab.js';

import { bookingMakeup } from './routes/booking-makeup.js';

import { formRouting } from './routes/form-routing.js';
import { bookingSeries } from './routes/booking-series.js';
import { bookingCalendarSettings } from './routes/booking-calendar-settings.js';
import { bookingCancellation } from './routes/booking-cancellation.js';
import { inboxSla } from './routes/inbox-sla.js';
import { lineSenders } from './routes/line-senders.js';
import { sensitiveOperationMiddleware } from './middleware/sensitive-step-up.js';
import type { Env } from './worker-env.js';

export type { Env } from './worker-env.js';import { liffNotificationPreferences } from './routes/liff-notification-preferences.js';
import { styles } from './routes/styles.js';
import { buildOgForLiffPath } from './liff-open-graph.js';

import { formDocuments } from './routes/form-documents.js';

import { autoReplyUnmatched } from './routes/auto-reply-unmatched.js';
import { instagram } from './routes/instagram.js';

import { restaurantCustomerBooking } from './routes/restaurant-customer-booking.js';

import { chatMessages } from './routes/chat-messages.js';
import { scenarioDrafts } from './routes/scenario-drafts.js';
import { broadcastMediaDirect } from './routes/broadcast-media-direct.js';
import { hqBroadcasts } from './routes/hq-broadcasts.js';
import { visitStamps } from './routes/visit-stamps.js';

import { Hono, type Context } from 'hono';
import { noindexHeaderMiddleware, robotsTxtHandler } from './lib/robots.js';
import { cors } from 'hono/cors';

import { getTrafficPoolBySlug, getTrafficPoolById, getRandomPoolAccount, getPoolAccounts, getEntryRouteByRefCode, getEntryRouteByRefCodeAny, getLineAccountById, getAffiliateLinkByRefCode, incrementAffiliateLinkClick } from '@line-crm/db';

import { authMiddleware } from './middleware/auth.js';
import { tenantScopeMiddleware } from './middleware/tenant-scope.js';
import { tenantPublicBoundaryMiddleware } from './middleware/tenant-public-boundary.js';
import { rateLimitMiddleware, authenticatedRateLimitMiddleware } from './middleware/rate-limit.js';

import { htmlSecurityMiddleware } from './middleware/html-security.js';
import { businessAuditMiddleware } from './middleware/business-audit.js';
import { featureEnforcementMiddleware } from './middleware/feature-enforcement.js';
import { webhook } from './routes/webhook.js';
import { friends } from './routes/friends.js';
import { friendBulkRuns } from './routes/friend-bulk-runs.js';
import { friendMigrations } from './routes/friend-migrations.js';
import { tags } from './routes/tags.js';
import { scenarios } from './routes/scenarios.js';
import { broadcasts } from './routes/broadcasts.js';
import { broadcastApprovals } from './routes/broadcast-approvals.js';
import { customerDownloads } from './routes/customer-downloads.js';
import { chatAttachments } from './routes/chat-attachments.js';
import { broadcastMessageAssets } from './routes/broadcast-message-assets.js';
import { users } from './routes/users.js';
import { lineAccountFolders } from './routes/line-account-folders.js';
import { lineAccountTags } from './routes/line-account-tags.js';
import { lineAccounts } from './routes/line-accounts.js';
import { gettingStarted } from './routes/getting-started.js';
import { recipes } from './routes/recipes.js';
import { hqTemplates } from './routes/hq-templates.js';
import { hqFormTests } from './routes/hq-form-tests.js';
import { manualLinks } from './routes/manual-links.js';
import { errorMessages } from './routes/error-messages.js';
import { accountHandovers } from './routes/account-handovers.js';
import { brand } from './routes/brand.js';
import { conversions } from './routes/conversions.js';
import { affiliates } from './routes/affiliates.js';
import { affiliateOffers } from './routes/affiliate-offers.js';
import { duplicates } from './routes/duplicates.js';
import { usersGrouped } from './routes/users-grouped.js';
import { inbox } from './routes/inbox.js';
import { openapi } from './routes/openapi.js';
import { liffRoutes } from './routes/liff.js';
import { affiliateSelfRoutes } from './routes/affiliate-self.js';
import { affiliatePayouts } from './routes/affiliate-payouts.js';
import { webhooks } from './routes/webhooks.js';
import { publicApi } from './routes/public-api.js';
import { calendar } from './routes/calendar.js';
import { meetConsultations } from './routes/meet-consultations.js';
import { reminders } from './routes/reminders.js';
import { scoring } from './routes/scoring.js';
import { actionScoreRules } from './routes/action-score-rules.js';
import { templates } from './routes/templates.js';
import { chats } from './routes/chats.js';
import { conversations } from './routes/conversations.js';
import { notificationCenter } from './routes/notification-center.js';
import { notifications } from './routes/notifications.js';
import { lineNotifications } from './routes/line-notifications.js';
import { stripe } from './routes/stripe.js';
import { health } from './routes/health.js';
import { automations } from './routes/automations.js';
import { commonActions } from './routes/common-actions.js';
import { richMenus } from './routes/rich-menus.js';
import { trackedLinks } from './routes/tracked-links.js';
import { entryRoutes } from './routes/entry-routes.js';
import { forms } from './routes/forms.js';
import { postalCode } from './routes/postal-code.js';
import { adPlatforms } from './routes/ad-platforms.js';
import { adCosts } from './routes/ad-costs.js';
import { webMeasurement } from './routes/web-measurement.js';
import { staff } from './routes/staff.js';
import { access } from './routes/access.js';
import { capabilities } from './routes/capabilities.js';
import { images } from './routes/images.js';
import { accountSettings } from './routes/account-settings.js';
import { companySettings } from './routes/company-settings.js';
import { setup } from './routes/setup.js';
import { autoReplies } from './routes/auto-replies.js';
import { autoReplyRuns } from './routes/auto-reply-runs.js';
import { adminAuth } from './routes/admin-auth.js';
import { resolveCorsOrigin } from './middleware/admin-auth-config.js';
import { timingHandler, timingMiddleware, timingStart } from './lib/server-timing.js';
import booking from './routes/booking.js';
import { bookingEntitlements } from './routes/booking-entitlements.js';
import { bookingPayments } from './routes/booking-payments.js';
import { bookingPaymentAdmin } from './routes/booking-payment-admin.js';
import { bookingPlus } from './routes/booking-plus.js';
import events from './routes/events.js';
import { trafficPools } from './routes/traffic-pools.js';
import { meetCallback } from './routes/meet-callback.js';
import { messageTemplates } from './routes/message-templates.js';
import dedupPreview from './routes/dedup-preview.js';
import { profileRefresh } from './routes/profile-refresh.js';
import { richMenuGroups } from './routes/rich-menu-groups.js';
import { lineProxy } from './routes/line-proxy.js';
import { research } from './routes/research.js';
import { webinarRoutes } from './routes/webinars.js';
import { instagramEngagement } from './routes/instagram-engagement.js';
import adminVersion from './routes/admin-version.js';
import adminUpdate from './routes/admin-update.js';
import { privateImageResponseMiddleware } from './services/image-access.js';
import { ecIntegrations } from './routes/ec-integrations.js';
import { ecCommerce } from './routes/ec-commerce.js';
import { ecOperations } from './routes/ec-operations.js';
import { nenCampaigns } from './routes/nen-campaigns.js';
import { nenMembers } from './routes/nen-members.js';
import { nenRanks } from './routes/nen-ranks.js';
import { nenPets } from './routes/nen-pets.js';
import { nenPhotoOperations } from './routes/nen-photo-operations.js';
import { supportInbox } from './routes/support-inbox.js';
import { searchConsole } from './routes/search-console.js';
import { friendFields } from './routes/friend-fields.js';
import { friendAttributes } from './routes/friend-attributes.js';
import { featureSettings } from './routes/feature-settings.js';
import { friendAddRules } from './routes/friend-add-rules.js';
import { contents } from './routes/contents.js';
import { fileScan } from './routes/file-scan.js';
import { commonVarExports } from './routes/common-var-exports.js';
import { analytics } from './routes/analytics.js';
import { analyticsExports } from './routes/analytics-exports.js';
import { dashboard } from './routes/dashboard.js';
import { siteTracking } from './routes/site-tracking.js';

import { restaurantTest } from './routes/restaurant-test.js';
import { restaurantExternalLinks } from './routes/restaurant-external-links.js';
import { restaurantGoogle } from './routes/restaurant-google.js';
import { googleSheets } from './routes/google-sheets.js';
import { tiktokPnl } from './routes/tiktok-pnl.js';
import { restaurantGoogleProfile } from './routes/restaurant-google-profile.js';
import { restaurantGooglePosts } from './routes/restaurant-google-posts.js';
import { restaurantGooglePerformance } from './routes/restaurant-google-performance.js';
import { restaurantDelivery } from './routes/restaurant-delivery.js';
import { tenants } from './routes/tenants.js';
import { ops } from './routes/ops.js';
import { piiMaskMiddleware } from './middleware/impersonation.js';
import { outputAuditMiddleware } from './middleware/output-audit.js';
import { hqBanners } from './routes/hq-banners.js';
import { hqSupport } from './routes/hq-support.js';
import { hqBilling } from './routes/hq-billing.js';
import { authEmail } from './routes/auth-email.js';
import { opsInvite } from './routes/ops-invite.js';
import { opsSupport } from './routes/ops-support.js';
import { opsKnowledge } from './routes/ops-knowledge.js';
import { opsDashboard } from './routes/ops-dashboard.js';
import { opsBilling } from './routes/ops-billing.js';
import { opsAnnouncements } from './routes/ops-announcements.js';
import { hqNotices } from './routes/hq-notices.js';
import { codexSlackEvents } from './routes/codex-slack-events.js';
import { aiLoopSlackReports } from './routes/ai-loop-slack-reports.js';
import { clientErrors } from './routes/client-errors.js';
import { lineWebhookEvents } from './routes/line-webhook-events.js';
import { operations } from './routes/operations.js';
import { securityAlerts } from './routes/security-alerts.js';

import { unhandledWorkerError } from './lib/unhandled-error.js';
import { routeInboundEmail } from './services/inbound-email-router.js';

import { classifyCodexMonitorError, markCodexMentionFailed, processCodexMentionMessage, shouldStopCodexQueueRetry } from './services/codex-cloud-monitor.js';
import { type CodexMentionQueueMessage } from './services/codex-cloud-types.js';
import { createQrImage, isQrDataAllowed, normalizeQrFormat, normalizeQrSize, qrResponseHeaders, QrInputError, QR_MAX_RESPONSE_BYTES } from './lib/qr-response.js';
import { storedRedirectTarget } from './lib/safe-redirect.js';
import { isLinkPreviewBot } from './lib/og-bot.js';

export const app = new Hono<Env>();

/**
 * 管理画面から送られてくるヘッダ。
 *
 * ここに無いヘッダを1つでも付けると、ブラウザは**preflight の段階で**
 * 止める。サーバーには何も届かないので worker のログにも残らず、
 * 画面には「保存できませんでした」とだけ出る。
 *
 * 実際に起きた: 一斉配信の作成が `Idempotency-Key` を送るのに、ここに
 * 無かった。下書き保存・テスト送信・配信予約はすべてこの1本の POST を
 * 通るので、**管理画面から一斉配信を1つも作れない**状態だった。
 *
 * 追加するときは `cors-headers.test.ts` の一覧にも足す。
 */
export const ADMIN_REQUEST_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-CSRF-Token',
  'X-Line-Account-Id',
  'x-admin-api-key',
  'X-Filename',
  'Idempotency-Key',
  'X-Confirm-Irreversible',
  'X-Line-Harness-Source',
  'X-Impersonation-Reason',
  'x-step-up-token',
] as const;

// CORS — credentialed cookie auth cannot use a wildcard origin. Reflect only
// same-origin requests and origins on the ADMIN_ORIGIN allowlist; everything
// else gets no Access-Control-Allow-Origin header (browser blocks it). Bearer
// SDK/MCP callers send no Origin header and are unaffected.
// 検索に出さない：本物の robots.txt と、全部の応答に X-Robots-Tag（リリース前点検 2026-10-07）。
setHolidayCoverageWarningHandler(() => logger.warn('src_japanese_holidays_warn'));
app.use('*', timingStart());
app.use('*', apiContractMiddleware);
app.use('*', noindexHeaderMiddleware);
// Establish an invocation-local outbound boundary before any auth or error reporting.
app.use('*', async (c, next) => {
  if ((c.req.path === '/api/ops/staging-qa' || c.req.path.startsWith('/api/ops/staging-qa/')) && !qaEnabled(c.env)) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const env = c.env;
  c.env = qaSafeBindings(env);
  return withQaOutboundBoundary(env, next);
});
app.get('/robots.txt', robotsTxtHandler);

// 段とD1の待ちを、認証前の拒否・公開応答も含めて数値だけで返す。
app.use('*', timingMiddleware('cors', cors({
  origin: (origin, c) => resolveCorsOrigin(c.env, origin, c.req.url),
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: [...ADMIN_REQUEST_HEADERS],
  exposeHeaders: ['Content-Disposition', 'X-Exported-By', 'X-Exported-At', 'X-Csv-Total-Count', 'X-Csv-Returned-Count', 'X-Csv-Truncated', 'X-Request-ID', 'Server-Timing'],
  maxAge: 600,
})));

// Rate limiting — runs before auth to block abuse early
app.use('*', htmlSecurityMiddleware);
app.use('*', timingMiddleware('rate', rateLimitMiddleware));

// LIFF/public routes skip staff auth. Apply their tenant wall before auth and
// before any route handler can persist a form/booking/member write.
app.use('/api/liff/*', timingMiddleware('tenant', tenantPublicBoundaryMiddleware));
app.use('/api/events/liff/*', timingMiddleware('tenant', tenantPublicBoundaryMiddleware));

// Auth middleware — skips /webhook and /docs automatically
app.use('*', authMiddleware);
app.use('*', timingMiddleware('rate', authenticatedRateLimitMiddleware));
app.use('/api/*', timingMiddleware('audit', outputAuditMiddleware));

// Tenant boundary — authenticated admin APIs may only select LINE accounts
// that belong to the signed-in staff member's tenant.
app.use('*', timingMiddleware('tenant', tenantScopeMiddleware));
// 代理ログイン中の個人情報の伏せ字。認証の後ろ、各ルートの前。
app.use('/api/*', timingMiddleware('pii', piiMaskMiddleware));
app.use('/api/*', timingMiddleware('pii', privateImageResponseMiddleware));

// 認証済み管理APIの変更を共通監査へ残す。route固有の監査がある場合は重複させない。
app.use('/api/*', timingMiddleware('audit', businessAuditMiddleware));

// 機能設定は認証・tenant scope の後、各 route handler の前で強制する。
// manifest と実 route の全件照合を必須テストにした上で、未分類も fail closed にする。
app.use('/api/*', timingMiddleware('feature', featureEnforcementMiddleware));
app.use('/api/*', timingMiddleware('sensitive', sensitiveOperationMiddleware));

app.use('*', timingHandler());

// Mount route groups — MVP & Round 2
app.route('/', webhook);
app.route('/', stagingQa);
app.route('/', gettingStarted);
app.route('/', recipes);
app.route('/', hqTemplates);
app.route('/', hqFormTests);
app.route('/', hqBroadcasts);
app.route('/', ops);
app.route('/', manualLinks);
app.route('/', errorMessages);
app.route('/', accountHandovers);
app.route('/', friendBulkRuns);
app.route('/', friendMigrations);
// NOTE: R393 — /api/friends/people 等の固定名は :id より先に載せる。
// duplicates（本人候補・統合ユーザー）は friends の GET /:id より先でないと
// people を友だちIDと読んで404になる。broadcastApprovals と同じ考え方。
app.route('/', duplicates);
app.route('/', friends);
app.route('/', tags);
app.route('/', scenarios);
app.route('/', scenarioDrafts);
// NOTE: 承認の口（approval-threshold 等の固定名）は :id より先に載せる。
// broadcasts の PUT /:id が先だと approval-threshold を id と読んで404になる。
app.route('/', broadcastApprovals);
app.route('/', broadcastAb);
app.route('/', broadcastSimulation);
app.route('/', broadcasts);
app.route('/', customerDownloads);
app.route('/', chatAttachments);
app.route('/', broadcastMessageAssets);
app.route('/', broadcastMediaDirect);
app.route('/', users);
app.route('/', lineAccountFolders);
app.route('/', lineAccountTags);
app.route('/', lineAccounts);
app.route('/', brand);
app.route('/', conversions);
app.route('/', affiliates);
app.route('/', affiliateOffers);
app.route('/', usersGrouped);
app.route('/', inbox);
app.route('/', openapi);
app.route('/', liffRoutes);
app.route('/', liffNotificationPreferences);
app.route('/', affiliateSelfRoutes);
app.route('/', affiliatePayouts);

app.use('*', timingHandler());

// Mount route groups — Round 3
app.route('/', webhooks);
app.route('/', publicApi);
app.route('/', calendar);
app.route('/', meetConsultations);
app.route('/', reminders);
app.route('/', scoring);
app.route('/', actionScoreRules);
app.route('/', templates);
app.route('/', inboxSla);
app.route('/', lineSenders);
app.route('/', aiDrafts);
app.route('/', accountAiFeatures);
app.route('/', customerSegments);
app.route('/', memberRanks);
app.route('/', bookingPassBilling);
app.route('/', storeComparison);
app.route('/', ecAutoLine);
app.route('/', bookingPassPlans);
app.route('/', bookingPassNotices);
app.route('/', aiAnswerLogs);
app.route('/', deliveryPurposePreview);
app.route('/', mcpConnections);
app.route('/', mcpRpc);
app.route('/', operatorPush);
app.route('/', chats);
app.route('/', chatMessages);
app.route('/', conversations);
app.route('/', notificationCenter);
// 運用者通知ルール(/api/notifications/rules)。2026-08-29 の下書き画面がこの経路を呼ぶが、
// 2026-05 に外したまま mount されていなかった。
app.route('/', notifications);
app.route('/', lineNotifications);
app.route('/', stripe);
app.route('/', health);
app.route('/', automations);
app.route('/', commonActions);
app.route('/', richMenus);
app.route('/', trackedLinks);
app.route('/', entryRoutes);
app.route('/', formDocuments);
app.route('/', formRouting);
app.route('/', forms);
app.route('/', postalCode);
app.route('/', adPlatforms);
app.route('/', adCosts);
// Web計測の公開口と計測サイトの管理(#819)。
app.route('/', webMeasurement);
app.route('/', staff);
app.route('/', access);
app.route('/', capabilities);
app.route('/', images);
app.route('/', setup);
app.route('/', autoReplyUnmatched);
app.route('/', autoReplies);
app.route('/', autoReplyRuns);
app.route('/', adminAuth);
app.route('/', trafficPools);
app.route('/', bookingSeries);
app.route('/', booking);
app.route('/', bookingCalendarSettings);
app.route('/', bookingGap3);
app.route('/', bookingCancellation);
app.route('/', bookingPayments);
app.route('/', bookingPaymentAdmin);
app.route('/', bookingEntitlements);
app.route('/', bookingPlus);
app.route('/', bookingMakeup);
app.route('/', events);
app.route('/', accountSettings);
app.route('/', companySettings);
app.route('/', meetCallback);
app.route('/', messageTemplates);
app.route('/', dedupPreview);
app.route('/', profileRefresh);
app.route('/', richMenuGroups);
app.route('/', webinarRoutes);
app.route('/', research);
app.route('/', instagramEngagement);
app.route('/', instagram);
// LINE Messaging API 互換プロキシ — 外部エージェントの直接送信を messages_log に残す
app.route('/', lineProxy);
// EC-CUBEの取引イベント。管理者認証ではなく署名・時刻・重複IDで検証する。
app.route('/', ecIntegrations);
// NEN EC連携の管理画面API（通常の管理者認証・CSRF保護対象）。
app.route('/', ecCommerce);
app.route('/', ecOperations);
app.route('/', nenCampaigns);
app.route('/', nenPhotoOperations);
app.route('/', nenMembers);
app.route('/', nenRanks);
app.route('/', nenPets);
app.route('/', supportInbox);
app.route('/', searchConsole);
app.route('/', friendFields);
app.route('/', friendAttributes);
app.route('/', featureSettings);
app.route('/', friendAddRules);
// /api/common-vars/exports は contents の /api/common-vars/:id より先に
// 登録しないと、静的な 'exports' が :id に取られて届かない。
app.route('/', commonVarExports);
app.route('/', contents);
app.route('/', fileScan);
app.route('/', analytics);
app.route('/', analyticsExports);
app.route('/', dashboard);
app.route('/', styles);
app.route('/', siteTracking);
// 飲食店向けの検証専用領域。既存NEN機能とはAPI/DB名前空間を分離する。
app.route('/', visitStamps);
app.route('/', restaurantExternalLinks);
app.route('/', restaurantTest);
app.route('/', restaurantCustomerBooking);
app.route('/', restaurantGoogle);
app.route('/', restaurantGoogleProfile);
app.route('/', restaurantGooglePosts);
app.route('/', restaurantGooglePerformance);
app.route('/', restaurantDelivery);
app.route('/', googleSheets);
app.route('/', tiktokPnl);
app.route('/', tenants);
app.route('/', hqBanners);
app.route('/', hqSupport);
app.route('/', hqBilling);
app.route('/', authEmail);
app.route('/', opsInvite);
app.route('/', opsSupport);
app.route('/', opsKnowledge);
app.route('/', opsDashboard);
app.route('/', opsBilling);
app.route('/', opsAnnouncements);
app.route('/', hqNotices);
app.route('/', codexSlackEvents);
app.route('/', aiLoopSlackReports);
app.route('/', clientErrors);
app.route('/', lineWebhookEvents);
app.route('/', operations);
app.route('/', securityAlerts);

// Phase 5 (upgrade flow) — public build metadata endpoint. Mounted under
// /admin/ but intentionally unauthenticated: the dashboard fetches /admin/version
// before login to render the upgrade banner, and the returned hashes are
// derivable from the deployed bundle. /admin/update/* (Task 18) layers
// ADMIN_API_KEY middleware on subpaths.
app.route('/admin', adminVersion);
// Phase 5 Task 18 — self-update endpoints guarded by x-admin-api-key.
// HTTP self-update is retired; the router returns 404 for every request.
app.route('/admin/update', adminUpdate);

// QR は Worker の中だけで作る。流入 ref や LIFF URL は計測の識別子で、
// 第三者の生成サービスへ渡す理由がない。以前は data をそのまま
// api.qrserver.com へ送っていたので、説明と実装が食い違っていた。
export const qrHandler: (c: Context<Env>) => Promise<Response> = async (c) => {
  const data = c.req.query('data');
  if (!data) return c.text('Missing data param', 400);
  if (!isQrDataAllowed(data)) return c.text('Data param too long', 400);
  const size = normalizeQrSize(c.req.query('size'));
  if (!size) return c.text('Invalid size', 400);
  // 印刷に使うので svg も出せる。知らない値は png に丸める。
  const format = normalizeQrFormat(c.req.query('format'));
  let image: Awaited<ReturnType<typeof createQrImage>>;
  try {
    image = await createQrImage(data, size, format);
  } catch (error) {
    // 指定を直せば通る失敗（小さすぎる・長すぎる）は理由を返す。
    if (error instanceof QrInputError) return c.text(error.message, 400);
    return c.text('QR generation failed', 500);
  }
  if (image.bytes.byteLength > QR_MAX_RESPONSE_BYTES) return c.text('QR response too large', 500);
  return new Response(image.bytes, {
    headers: qrResponseHeaders(
      image.contentType,
      c.req.query('download') === '1',
      c.req.query('filename') || 'referral-link-qr',
      format,
    ),
  });
};

app.get('/api/qr', qrHandler);

// N-244: 停止した流入経路の公開URLは、active・停止・不存在の区別や
// 転送先を漏らさない同一の終了応答で止める。ref の echo もしない。
const ENTRY_ROUTE_STOPPED_HTML =
  '<!doctype html><html lang="ja"><meta charset="utf-8"><title>このページは利用できません</title><body><main><h1>このページは利用できません</h1><p>公開が終わっているか、アドレスが正しくありません。運用者へ、新しいリンクをご確認ください。</p></main></body></html>';

// Short link: /r/:ref → universal landing page with LINE open button
// Supports query params: ?form=FORM_ID (auto-push form after friend add)
// Mobile: single CTA → LIFF URL (Universal Link). No UA detection.
// Desktop: QR code encodes LIFF URL.
// Stuck users opt into /r/:ref/help for Safari escape instructions.
app.get('/r/:ref', async (c) => {
  const ref = c.req.param('ref');
  const formId = c.req.query('form') || '';

  // Resolve LIFF URL — priority:
  //   1. entry_route.pool_id (if ref maps to a referral link)
  //   2. URL query ?pool=
  //   3. 'main' fallback
  let liffUrl = c.env.LIFF_URL;
  let pool: Awaited<ReturnType<typeof getTrafficPoolBySlug>> | null = null;

  // 1. entry_route lookup. getTrafficPoolById (unlike getTrafficPoolBySlug)
  // does not filter on is_active, so we ignore disabled pools explicitly to
  // honor the operator's pause action.
  //
  // NOTE: we intentionally do NOT record a ref_tracking row here. The
  // /auth/callback + /api/liff/link path already writes a tracking row when
  // OAuth/LIFF completes, and writing a second landing-page row would
  // double-count every successful click in getEntryRouteFunnel. Landing-page
  // drop-off (clicks that never reach OAuth) is therefore not visible in the
  // funnel; that limitation is intentional pending a dedicated click table.
  const route = await getEntryRouteByRefCode(c.env.DB, ref);
  // N-244: 停止した経路は active と同じ受付をしない。転送先があっても
  // 送らず、紹介リンクやプールの後段にも落とさず、同一の終了応答で止める。
  // ref が entry_routes の名前空間に属さないときだけ従来の後段へ進む。
  if (!route) {
    const anyRoute = await getEntryRouteByRefCodeAny(c.env.DB, ref);
    if (anyRoute && anyRoute.is_active !== 1) {
      return c.html(ENTRY_ROUTE_STOPPED_HTML, 410);
    }
  }
  // クーポンの所属アカウントを固定する。main poolへ落とすと別の店へ着地する。
  const couponRoute = route?.coupon_enabled === 1 && Boolean(route.coupon_asset_id);
  if (couponRoute) {
    const account = route?.line_account_id ? await getLineAccountById(c.env.DB, route.line_account_id) : null;
    if (!account?.liff_id || !/^\d+-[A-Za-z0-9]+$/.test(account.liff_id)) return c.html('<!doctype html><html lang="ja"><meta charset="utf-8"><title>このリンクは現在利用できません</title><p>お店へお問い合わせください。</p></html>', 503);
    liffUrl = `https://liff.line.me/${account.liff_id}`;
  }
  // 転送先が設定された経路はそちらへ送る（#514 重大4）。保存はするのに
  // 読まないままだった。危険な形式は safe-redirect が弾き、そのときは
  // 従来どおり友だち追加の着地画面へ進む。
  if (!couponRoute && route?.redirect_url) {
    const target = storedRedirectTarget(route.redirect_url);
    if (target) return c.redirect(target, 302);
  }
  if (!couponRoute && route?.pool_id) {
    const candidate = await getTrafficPoolById(c.env.DB, route.pool_id);
    if (candidate?.is_active) pool = candidate;
  }

  // 1b. affiliate_links fallback (ASP). Only when the ref is NOT a known
  // entry_route: entry_routes owns the ref namespace, so an existing route
  // (even one whose pool is paused) keeps its behavior unchanged. An affiliate
  // ref resolves its LINE account directly (no pool) and lands on that
  // account's LIFF. Stopped links do not redirect or count a new click.
  // The click is counted here (the landing page hit), and `ref` still rides
  // through to LIFF state below so the existing ref_tracking flow attributes
  // the eventual friend-add via /auth/callback + /api/liff/link.
  let affiliateResolved = false;
  if (!route) {
    const affiliateLink = await getAffiliateLinkByRefCode(c.env.DB, ref);
    if (affiliateLink && (
      affiliateLink.is_active !== 1 || affiliateLink.affiliate_is_active === 0
    )) {
      return c.html(
        '<!doctype html><html lang="ja"><meta charset="utf-8"><title>この紹介リンクは停止しています</title><body><main><h1>この紹介リンクは停止しています</h1><p>紹介元の運用者へ、新しいリンクをご確認ください。</p></main></body></html>',
        410,
      );
    }
    if (affiliateLink?.is_active === 1) {
      await incrementAffiliateLinkClick(c.env.DB, ref);
      affiliateResolved = true;
      if (affiliateLink.line_account_id) {
        const account = await getLineAccountById(c.env.DB, affiliateLink.line_account_id);
        if (account?.liff_id && /^\d+-[A-Za-z0-9]+$/.test(account.liff_id)) liffUrl = `https://liff.line.me/${account.liff_id}`;
      }
      // line_account_id === null → keep the default LIFF_URL (既定アカウント).
    }
  }

  // 2 / 3. fallback to URL query or 'main'. Skipped for affiliate refs, whose
  // account is already resolved above; falling through to the 'main' pool would
  // override the affiliate's chosen account.
  if (!pool && !affiliateResolved && !couponRoute) {
    const poolSlug = c.req.query('pool') || 'main';
    pool = await getTrafficPoolBySlug(c.env.DB, poolSlug);
  }

  if (pool) {
    const account = await getRandomPoolAccount(c.env.DB, pool.id);
    if (account) {
      if (account.liff_id && /^\d+-[A-Za-z0-9]+$/.test(account.liff_id)) liffUrl = `https://liff.line.me/${account.liff_id}`;
    } else {
      const allAccounts = await getPoolAccounts(c.env.DB, pool.id);
      if (allAccounts.length === 0) {
        if (pool.liff_id && /^\d+-[A-Za-z0-9]+$/.test(pool.liff_id)) liffUrl = `https://liff.line.me/${pool.liff_id}`;
      }
    }
  }

  // Build LIFF URL with params (direct link for Universal Link)
  const liffIdMatch = liffUrl.match(/liff\.line\.me\/([0-9]+-[A-Za-z0-9]+)/);
  const liffParams = new URLSearchParams();
  if (liffIdMatch) liffParams.set('liffId', liffIdMatch[1]);
  if (ref) liffParams.set('ref', ref);
  if (couponRoute) liffParams.set('couponRef', ref);
  if (formId) liffParams.set('form', formId);
  const gate = c.req.query('gate');
  if (gate) liffParams.set('gate', gate);
  const xh = c.req.query('xh');
  if (xh) liffParams.set('xh', xh);
  const ig = c.req.query('ig');
  if (ig) liffParams.set('ig', ig);
  const iga = c.req.query('iga');
  if (iga) liffParams.set('iga', iga);
  const igan = c.req.query('igan');
  if (igan) liffParams.set('igan', igan);
  // LIFF in-app navigation passthrough — OpenChat strips raw liff.line.me
  // URLs, so we accept `page` / `id` here and forward them to the resolved
  // LIFF target. Limited to pages whose client initializer enforces the
  // friend-add gate (initSalonBooking, initEventBooking); page=book/form
  // would bypass that gate and bypass ref-based attribution, so they are
  // intentionally excluded until those initializers are unified.
  const PAGE_PASSTHROUGH_ALLOWED = new Set(['salon-book', 'event', 'event-me', 'webinar', 'research', 'visit-stamps']);
  const page = c.req.query('page');
  if (page && PAGE_PASSTHROUGH_ALLOWED.has(page)) liffParams.set('page', page);
  if (page === 'research' && c.req.query('researchId')) liffParams.set('researchId', c.req.query('researchId')!);
  const id = c.req.query('id');
  if (id) liffParams.set('id', id);
  const slug = c.req.query('slug');
  if (slug) liffParams.set('slug', slug);
  if (page === 'salon-book') {
    const menuId = c.req.query('menu_id');
    if (menuId && /^[A-Za-z0-9_-]{1,128}$/.test(menuId)) liffParams.set('menu_id', menuId);
    if (c.req.query('view') === 'history') liffParams.set('view', 'history');
  }
  if (page === 'visit-stamps') {
    const card = c.req.query('card');
    if (card && /^[A-Za-z0-9_-]{1,128}$/.test(card)) liffParams.set('card', card);
  }

  // Ad click IDs + UTM passthrough. /auth/line forwards its full query string
  // to /r/:ref, but rebuilding liffParams here without these keys silently
  // drops ad attribution for the primary mobile path. Keep this list in sync
  // with the params /auth/line reads.
  for (const key of ['gclid', 'fbclid', 'twclid', 'ttclid', 'utm_source', 'utm_medium', 'utm_campaign']) {
    const value = c.req.query(key);
    if (value) liffParams.set(key, value);
  }
  const liffTarget = liffParams.toString() ? `${liffUrl}?${liffParams.toString()}` : liffUrl;

  // Help link carries the *resolved* liff target as `t=` so the help page
  // displays the exact URL the user should paste into a real browser. Without
  // this, pooled refs would re-roll the random pool account on each /r/:ref
  // visit and the help-page paste URL could end up at a different LINE
  // account than the one originally chosen for this user.
  const helpUrl = `/r/${encodeURIComponent(ref)}/help?t=${encodeURIComponent(liffTarget)}`;

  const ua = (c.req.header('user-agent') || '').toLowerCase();
  const isMobile = /iphone|ipad|android|mobile/.test(ua);
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);

  if (isMobile) {
    // OS-aware mobile UI. Per-browser detection (X / IG / FB) intentionally avoided —
    // we only branch on iOS vs Android because the recovery primitives differ:
    //   iOS: long-press the link → iOS context menu shows "LINEで開く" even inside
    //        WKWebView in-app browsers that block tap-driven Universal Links.
    //   Android: intent:// URL launches LINE directly via Android's intent system,
    //        which works even when in-app browsers swallow https links.
    // The same liff.line.me URL still drives Universal Link on the iOS button —
    // long-press is a recovery hint, not a replacement.

    // Build Android intent URL — strips the https:// prefix and appends the intent
    // metadata so Chrome / in-app browsers hand off to the LINE app package.
    // L-Step uses the same shape: jp.naver.line.android with browsable category.
    // S.browser_fallback_url makes Chrome fall back to plain HTTPS when LINE
    // isn't installed or the WebView refuses the intent, so Android users
    // never hit a dead end (they at least land on liff.line.me web).
    const liffPath = liffTarget.replace(/^https:\/\//, '');
    const intentFallback = encodeURIComponent(liffTarget);
    const androidIntent = `intent://${liffPath}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=jp.naver.line.android;S.browser_fallback_url=${intentFallback};end`;
    const buttonHref = isAndroid ? androidIntent : liffTarget;
    // iOS shows long-press hint; Android relies on intent URL alone (long-press
    // on Android opens "Open with…" which is noisier than the intent route).
    const longPressHint = isIOS
      ? '<p class="hint">※開かない場合はボタンを<strong>長押し</strong>して「LINEで開く」を選択</p>'
      : '';

    return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LINE で開く</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans','Helvetica Neue',system-ui,sans-serif;background:#f5f7f5;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#fff;border-radius:20px;box-shadow:0 2px 20px rgba(0,0,0,0.06);text-align:center;max-width:360px;width:90%;padding:40px 28px 32px;border:1px solid rgba(0,0,0,0.04)}
.line-icon{width:48px;height:48px;margin:0 auto 20px}
.line-icon svg{width:48px;height:48px}
.msg{font-size:15px;color:#444;font-weight:500;margin-bottom:28px;line-height:1.6}
.btn{display:block;width:100%;padding:16px;border:none;border-radius:12px;font-size:16px;font-weight:700;text-decoration:none;text-align:center;color:#fff;background:#06C755;box-shadow:0 2px 12px rgba(6,199,85,0.2);transition:all .15s}
.btn:active{transform:scale(0.98);opacity:.9}
.hint{font-size:11px;color:#888;margin-top:10px;line-height:1.6}
.hint strong{color:#06C755;font-weight:700}
.help{font-size:12px;color:#999;margin-top:18px;line-height:1.5}
.help a{color:#999;text-decoration:underline}
</style>
</head>
<body>
<div class="card">
<div class="line-icon">
<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#06C755"/><path d="M24 12C17.37 12 12 16.58 12 22.2c0 3.54 2.35 6.65 5.86 8.47-.2.74-.76 2.75-.87 3.17-.14.55.2.54.42.39.18-.12 2.84-1.88 4-2.65.84.13 1.7.22 2.59.22 6.63 0 12-4.58 12-10.2S30.63 12 24 12z" fill="#fff"/></svg>
</div>
<p class="msg">友達追加して始める</p>
<a href="${escapeHtmlAttribute(buttonHref)}" class="btn">LINEで開く</a>
${longPressHint}
<p class="help">うまく開けない方は <a href="${helpUrl}">こちら</a></p>
</div>
</body>
</html>`);
  }

  // PC: show QR code page — QR encodes LIFF URL directly
  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LINE で開く</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans','Helvetica Neue',system-ui,sans-serif;background:#f5f7f5;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#fff;border-radius:20px;box-shadow:0 2px 20px rgba(0,0,0,0.06);text-align:center;max-width:480px;width:90%;padding:48px;border:1px solid rgba(0,0,0,0.04)}
.line-icon{width:48px;height:48px;margin:0 auto 20px}
.line-icon svg{width:48px;height:48px}
.msg{font-size:15px;color:#444;font-weight:500;margin-bottom:32px;line-height:1.6}
.qr{background:#f9f9f9;border-radius:16px;padding:24px;display:inline-block;margin-bottom:24px;border:1px solid rgba(0,0,0,0.04)}
.qr img{display:block;width:240px;height:240px}
.hint{font-size:13px;color:#999;line-height:1.6}
.footer{font-size:11px;color:#bbb;margin-top:24px;line-height:1.5}
</style>
</head>
<body>
<div class="card">
<div class="line-icon">
<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#06C755"/><path d="M24 12C17.37 12 12 16.58 12 22.2c0 3.54 2.35 6.65 5.86 8.47-.2.74-.76 2.75-.87 3.17-.14.55.2.54.42.39.18-.12 2.84-1.88 4-2.65.84.13 1.7.22 2.59.22 6.63 0 12-4.58 12-10.2S30.63 12 24 12z" fill="#fff"/></svg>
</div>
<p class="msg">スマートフォンで QR コードを読み取ってください</p>
<div class="qr">
<img src="/api/qr?size=240x240&data=${encodeURIComponent(liffTarget)}" alt="QR Code">
</div>
<p class="hint">LINE アプリのカメラまたは<br>スマートフォンのカメラで読み取れます</p>
<p class="footer">友だち追加で全機能を無料体験できます</p>
</div>
</body>
</html>`);
});

// /r/:ref/help — opt-in recovery page when "LINEで開く" didn't launch the app.
// Method 1 (long-press) is iOS's escape hatch — works inside X / IG / FB
// in-app browsers because iOS's context menu is system-level UI floating
// above the WKWebView, so it surfaces "LINEで開く" even when tap-driven
// Universal Links are blocked. This is the L-Step approach.
// Method 2 (URL copy → external browser) is the universal fallback.
// No LINE-Login-web fallback exposed — friction kills conversion.
app.get('/r/:ref/help', async (c) => {
  const ref = c.req.param('ref');
  // N-244: 停止した経路の回復ページも同じ終了応答で止める。直接開かれても
  // 受付へ戻さない。属さない ref は従来どおり回復ページを出す。
  const helpRoute = await getEntryRouteByRefCode(c.env.DB, ref);
  if (!helpRoute) {
    const anyRoute = await getEntryRouteByRefCodeAny(c.env.DB, ref);
    if (anyRoute && anyRoute.is_active !== 1) {
      return c.html(ENTRY_ROUTE_STOPPED_HTML, 410);
    }
  }
  const reqUrl = new URL(c.req.url);
  // Prefer the resolved liff target passed by /r/:ref via ?t= so pooled refs
  // do not re-roll on retry. Fall back to the short /r/:ref URL only when
  // ?t= is missing (e.g. direct navigation to /help without coming from /r/).
  // Reject anything that is not an https://liff.line.me/* URL — never trust
  // user-supplied open redirects.
  const tParam = c.req.query('t') || '';
  let displayUrl: string;
  if (tParam && /^https:\/\/liff\.line\.me\//.test(tParam)) {
    displayUrl = tParam;
  } else {
    // Strip ?t= if it sneaks in unvalidated, but keep other query params
    // (form, gate, xh, ig, pool) for the /r/:ref re-entry.
    const safeParams = new URLSearchParams(reqUrl.search);
    safeParams.delete('t');
    const qs = safeParams.toString();
    displayUrl = `${reqUrl.origin}/r/${encodeURIComponent(ref)}${qs ? '?' + qs : ''}`;
  }
  // Escape URL for safe embedding in HTML attributes and a visible <code>-style block.
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const urlForHtml = escapeHtml(displayUrl);

  const ua = (c.req.header('user-agent') || '').toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);
  const browserName = isIOS ? 'Safari' : isAndroid ? 'Chrome' : 'ブラウザ（iPhoneは Safari／Androidは Chrome）';

  // Long-press recovery is iOS-only. On Android the intent:// URL on the
  // main page already handles the equivalent recovery without help-page UI.
  const longPressBlock = isIOS ? `<div class="method">
<div class="method-num">1</div>
<div class="method-body">
<div class="method-title">長押しで開く（最も簡単）</div>
<div class="method-desc">前のページに戻り、緑の「LINEで開く」ボタンを<strong>長押し</strong>。表示されたメニューから「<strong>LINEで開く</strong>」を選択してください。</div>
</div>
</div>` : '';
  const copyMethodNum = isIOS ? '2' : '1';

  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LINEを開く方法</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans','Helvetica Neue',system-ui,sans-serif;background:#f5f7f5;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:16px}
.card{background:#fff;border-radius:20px;box-shadow:0 2px 20px rgba(0,0,0,0.06);max-width:400px;width:100%;padding:28px 24px;border:1px solid rgba(0,0,0,0.04)}
.title{font-size:17px;color:#333;font-weight:700;margin-bottom:20px;text-align:center;line-height:1.5}
.method{display:flex;gap:12px;margin-bottom:20px;align-items:flex-start}
.method-num{flex-shrink:0;width:28px;height:28px;border-radius:50%;background:#06C755;color:#fff;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;margin-top:1px}
.method-body{flex:1}
.method-title{font-size:14px;font-weight:700;color:#333;margin-bottom:6px}
.method-desc{font-size:13px;color:#666;line-height:1.7}
.method-desc strong{color:#06C755;font-weight:700}
.copy-section{background:#f9f9f9;border-radius:12px;padding:16px;margin-top:8px}
.url-box{background:#fff;border:1px solid #e5e7e5;border-radius:8px;padding:10px 12px;margin-bottom:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#333;word-break:break-all;line-height:1.5;user-select:all;-webkit-user-select:all}
.copy-btn{display:block;width:100%;padding:12px;border:none;border-radius:10px;font-size:13px;font-weight:600;text-align:center;color:#fff;background:#06C755;cursor:pointer;margin-bottom:10px;transition:all .15s;font-family:inherit}
.copy-btn:active{transform:scale(0.98);opacity:.9}
.copy-btn.copied{background:#999}
.copy-hint{font-size:11px;color:#aaa;text-align:center;margin-bottom:8px;line-height:1.5}
.steps{font-size:12px;color:#666;line-height:1.8;padding-left:18px;margin-top:6px}
.steps li::marker{color:#06C755;font-weight:700}
</style>
</head>
<body>
<div class="card">
<p class="title">LINEを開く方法</p>
${longPressBlock}
<div class="method">
<div class="method-num">${copyMethodNum}</div>
<div class="method-body">
<div class="method-title">${browserName}で開く</div>
<div class="method-desc">URLをコピーして${browserName}のアドレスバーに貼り付け</div>
<div class="copy-section">
<div class="url-box" id="urlBox">${urlForHtml}</div>
<button class="copy-btn" id="copyBtn" type="button" data-url="${urlForHtml}">URLをコピー</button>
<p class="copy-hint">うまくコピーできない場合は上のURLを長押しで選択</p>
<ol class="steps">
<li>ホームに戻る</li>
<li>${browserName}を開く</li>
<li>アドレスバーに貼り付け</li>
<li>「LINEで開く」をタップ</li>
</ol>
</div>
</div>
</div>
</div>
<script>
(function(){
  var btn = document.getElementById('copyBtn');
  var url = btn.getAttribute('data-url');
  function showCopied(){
    btn.textContent = '✓ コピーしました';
    btn.classList.add('copied');
    setTimeout(function(){
      btn.textContent = 'URLをコピー';
      btn.classList.remove('copied');
    }, 2000);
  }
  function showFailed(){
    btn.textContent = '上のURLを長押しでコピー';
    btn.classList.add('copied');
    setTimeout(function(){
      btn.textContent = 'URLをコピー';
      btn.classList.remove('copied');
    }, 3000);
  }
  function execFallback(text){
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }
  btn.addEventListener('click', function(){
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(showCopied, function(){
        if (execFallback(url)) { showCopied(); } else { showFailed(); }
      });
    } else if (execFallback(url)) {
      showCopied();
    } else {
      showFailed();
    }
  });
})();
</script>
</body>
</html>`);
});

// /o — `/r/:ref` の ref 解決・追跡を一切行わない明示 liffId 版の open page。
// admin UI が OpenChat / IG DM 等で `liff.line.me` を弾かれるチャネル向けに
// 配布するラップ URL のためのルート。`/r/main` を使うと (a) traffic_pool の
// ランダム pool account に再解決されて選択中アカウントから外れる、
// (b) `ref=main` として ref_tracking / friends.ref_code に書き込まれて
// attribution を汚染する、という 2 つの問題があるため別ルートに分けている。
// 仕様:
// - クエリ: liffId (必須, `<digits>-<id>` 形式) / page / id
// - page は `/r/:ref` と同じ allowlist (salon-book / event / event-me / webinar / visit-stamps)
// - mobile UA は「LINEで開く」ボタン、desktop は QR を返す (`/r/:ref` 同等)
app.get('/o', async (c) => {
  if (isLinkPreviewBot(c.req.header('user-agent') || '')) {
    return c.html(await buildOgForLiffPath(c.env.DB, new URL(c.req.url)));
  }

  const liffId = c.req.query('liffId') || '';
  if (!/^[0-9]+-[A-Za-z0-9]+$/.test(liffId)) {
    return c.text('Invalid liffId', 400);
  }

  const liffParams = new URLSearchParams();
  liffParams.set('liffId', liffId);
  const PAGE_PASSTHROUGH_ALLOWED = new Set(['salon-book', 'event', 'event-me', 'webinar', 'research', 'visit-stamps']);
  const page = c.req.query('page');
  if (page && PAGE_PASSTHROUGH_ALLOWED.has(page)) liffParams.set('page', page);
  if (page === 'research' && c.req.query('researchId')) liffParams.set('researchId', c.req.query('researchId')!);
  const id = c.req.query('id');
  if (id) liffParams.set('id', id);
  const slug = c.req.query('slug');
  if (slug) liffParams.set('slug', slug);
  if (page === 'salon-book') {
    const menuId = c.req.query('menu_id');
    if (menuId && /^[A-Za-z0-9_-]{1,128}$/.test(menuId)) liffParams.set('menu_id', menuId);
  }
  if (page === 'visit-stamps') {
    const card = c.req.query('card');
    if (card && /^[A-Za-z0-9_-]{1,128}$/.test(card)) liffParams.set('card', card);
  }
  // N-396: 管理画面が発行する「予約履歴URL」は salon-book の view=history を
  // 指す。任意の view を通すと未定義画面へ誘導できてしまうので、履歴だけを通す。
  const view = c.req.query('view');
  if (page === 'salon-book' && view === 'history') liffParams.set('view', view);
  const liffTarget = `https://liff.line.me/${liffId}?${liffParams.toString()}`;

  const ua = (c.req.header('user-agent') || '').toLowerCase();
  const isMobile = /iphone|ipad|android|mobile/.test(ua);
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);

  if (isMobile) {
    const liffPath = liffTarget.replace(/^https:\/\//, '');
    const intentFallback = encodeURIComponent(liffTarget);
    const androidIntent = `intent://${liffPath}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=jp.naver.line.android;S.browser_fallback_url=${intentFallback};end`;
    const buttonHref = isAndroid ? androidIntent : liffTarget;
    const longPressHint = isIOS
      ? '<p class="hint">※開かない場合はボタンを<strong>長押し</strong>して「LINEで開く」を選択</p>'
      : '';
    return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LINE で開く</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans','Helvetica Neue',system-ui,sans-serif;background:#f5f7f5;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#fff;border-radius:20px;box-shadow:0 2px 20px rgba(0,0,0,0.06);text-align:center;max-width:360px;width:90%;padding:40px 28px 32px;border:1px solid rgba(0,0,0,0.04)}
.line-icon{width:48px;height:48px;margin:0 auto 20px}
.line-icon svg{width:48px;height:48px}
.msg{font-size:15px;color:#444;font-weight:500;margin-bottom:28px;line-height:1.6}
.btn{display:block;width:100%;padding:16px;border:none;border-radius:12px;font-size:16px;font-weight:700;text-decoration:none;text-align:center;color:#fff;background:#06C755;box-shadow:0 2px 12px rgba(6,199,85,0.2);transition:all .15s}
.btn:active{transform:scale(0.98);opacity:.9}
.hint{font-size:11px;color:#888;margin-top:10px;line-height:1.6}
.hint strong{color:#06C755;font-weight:700}
</style>
</head>
<body>
<div class="card">
<div class="line-icon">
<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#06C755"/><path d="M24 12C17.37 12 12 16.58 12 22.2c0 3.54 2.35 6.65 5.86 8.47-.2.74-.76 2.75-.87 3.17-.14.55.2.54.42.39.18-.12 2.84-1.88 4-2.65.84.13 1.7.22 2.59.22 6.63 0 12-4.58 12-10.2S30.63 12 24 12z" fill="#fff"/></svg>
</div>
<p class="msg">LINE で開く</p>
<a href="${escapeHtmlAttribute(buttonHref)}" class="btn">LINEで開く</a>
${longPressHint}
</div>
</body>
</html>`);
  }

  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LINE で開く</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans','Helvetica Neue',system-ui,sans-serif;background:#f5f7f5;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#fff;border-radius:20px;box-shadow:0 2px 20px rgba(0,0,0,0.06);text-align:center;max-width:480px;width:90%;padding:48px;border:1px solid rgba(0,0,0,0.04)}
.line-icon{width:48px;height:48px;margin:0 auto 20px}
.line-icon svg{width:48px;height:48px}
.msg{font-size:15px;color:#444;font-weight:500;margin-bottom:32px;line-height:1.6}
.qr{background:#f9f9f9;border-radius:16px;padding:24px;display:inline-block;margin-bottom:24px;border:1px solid rgba(0,0,0,0.04)}
.qr img{display:block;width:240px;height:240px}
.hint{font-size:13px;color:#999;line-height:1.6}
</style>
</head>
<body>
<div class="card">
<div class="line-icon">
<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#06C755"/><path d="M24 12C17.37 12 12 16.58 12 22.2c0 3.54 2.35 6.65 5.86 8.47-.2.74-.76 2.75-.87 3.17-.14.55.2.54.42.39.18-.12 2.84-1.88 4-2.65.84.13 1.7.22 2.59.22 6.63 0 12-4.58 12-10.2S30.63 12 24 12z" fill="#fff"/></svg>
</div>
<p class="msg">スマートフォンで QR コードを読み取ってください</p>
<div class="qr">
<img src="/api/qr?size=240x240&data=${encodeURIComponent(liffTarget)}" alt="QR Code">
</div>
<p class="hint">LINE アプリのカメラまたは<br>スマートフォンのカメラで読み取れます</p>
</div>
</body>
</html>`);
});

// Convenience redirect for /book path
app.get('/book', (c) => c.redirect('/?page=book'));

// 404 fallback — API paths return JSON 404, everything else serves from static assets (LIFF/admin)
export async function notFoundHandler(
  c: import('hono').Context<Env>,
): Promise<Response> {
  const url = new URL(c.req.url);
  const path = url.pathname;
  if (path.startsWith('/api/') || path === '/webhook' || path.startsWith('/webhook/') || path === '/docs' || path === '/openapi.json') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }

  // Bot UA (LINE/X/Facebook 等のリンクプレビュー) → OGP HTML を返す
  const ua = c.req.header('user-agent') || '';
  if (isLinkPreviewBot(ua)) {
    const html = await buildOgForLiffPath(c.env.DB, url);
    return c.html(html);
  }

  // Serve static assets (admin dashboard, LIFF pages).
  // ASSETS binding is missing when wrangler runs without a built `dist/client`
  // (fresh clone, vitest, or a deploy where the assets directive was stripped).
  // Without this guard every GET / surfaces as
  // "TypeError: Cannot read properties of undefined (reading 'fetch')".
  if (!c.env.ASSETS || typeof c.env.ASSETS.fetch !== 'function') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const assetRes = await c.env.ASSETS.fetch(c.req.raw);
  if (assetRes.status !== 404) return assetRes;

  // SPA fallback: LIFF deep links (/webinar/:slug, /events/:id など) は
  // アセットストアに実ファイルが無く 404 で返る。HTML を要求する GET
  // ナビゲーションに限り index.html を返してクライアントルーターに任せる。
  // それ以外 (存在しない .js/.png への参照など) は 404 のまま透過する。
  const accept = c.req.header('accept') ?? '';
  if (c.req.method === 'GET' && accept.includes('text/html')) {
    return c.env.ASSETS.fetch(
      new Request(new URL('/', c.req.url).toString(), { headers: c.req.raw.headers }),
    );
  }
  return assetRes;
}
app.onError(unhandledWorkerError);

app.notFound(notFoundHandler);

export default {
  fetch: (...args: Parameters<typeof app.fetch>) => withInvocation('http', () => app.fetch(...args)),
  async scheduled(event: ScheduledEvent, env: Env['Bindings'], ctx: ExecutionContext): Promise<void> {
    if (qaOutboundStopped(env)) return;
    return withInvocation('cron', () => scheduled(event, env, ctx));
  },
  async queue(
    batch: MessageBatch<CodexMentionQueueMessage>,
    env: Env['Bindings'],
  ): Promise<void> {
    if (qaOutboundStopped(env)) {
      for (const message of batch.messages) message.retry({ delaySeconds: 60 });
      return;
    }
    for (const message of batch.messages) {
      await withInvocation('queue', () => resumeInvocation(message.body?.requestId, async () => {
        try {
          await processCodexMentionMessage(env, message.body);
          message.ack();
        } catch (error) {
          const reason = classifyCodexMonitorError(error);
          const stopped = shouldStopCodexQueueRetry(
            message.attempts,
            env.CODEX_QUEUE_MAX_ATTEMPTS,
          );
          logger.error("src_index_failed");
          if (stopped) {
            try {
              if (message.body.kind !== 'auto_merge') {
                await markCodexMentionFailed(env.DB, message.body.slackEventId);
              }
            } catch {
              logger.error("codex_cloud_monitor_queue_ledger_failed");
            }
            message.ack();
          } else {
            message.retry({ delaySeconds: 60 });
          }
        }
      }));
    }
  },
  async email(
    message: ForwardableEmailMessage,
    env: Env['Bindings'],
    _ctx: ExecutionContext,
  ): Promise<void> {
    if (qaOutboundStopped(env)) {
      message.setReject('Staging QA outbound stop is active');
      return;
    }
    await withInvocation('email', () => routeInboundEmail(message, env));
  },
};
// redeploy trigger
