import { issueTrackedLinkIdentity, verifyTrackedLinkIdentity, resolveTrackedLinkAccountId, trackedLinkSigningAccount } from '../services/tracked-link-identity.js';
import { tracedFetch } from '@line-crm/shared/server';
import { escapeHtml, scriptString } from '../lib/html-escape.js';
import { logger } from '@line-crm/shared/server';
import { sqlIdSet } from '@line-crm/db/id-queries';
import { inputError, inputJsonBoundary } from '../lib/input-errors.js';
import { extrasFromTrackedLink } from '../services/tap-extras.js';
import { recordTrackedClick, processTrackedClick } from '../services/tracked-click-steps.js';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  getTrackedLinks,
  getTrackedLinkById,
  getTrackedLinkByIdOrShortCode,
  createTrackedLink,
  updateTrackedLink,
  deleteTrackedLink,
  getLinkClicks,
  getFriendByLineUserIdForAccount,
  isLineAccountTenantActive,
} from '@line-crm/db';
import { getUrlReachConversionPoints } from '@line-crm/db';
import type { LineAccount, TrackedLink } from '@line-crm/db';
import type { Env } from '../worker-env.js';
import { requireRole } from '../middleware/role-guard.js';
import { isLinkPreviewBot } from '../lib/og-bot.js';
import { buildOgHtml } from '../lib/og-html.js';
import { resolveOgForTrackedLink } from '../lib/og-resolver.js';
import { resolveTrackedLinkBaseUrl } from '../lib/link-base-url.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';

const trackedLinks = new Hono<Env>();

async function adminAccountScope(c: Context<Env>) {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const where = scope.allowedAccountIds.length
    ? `(line_account_id IN (${sqlIdSet(scope.allowedAccountIds).sql})${scope.canSeeUnassigned ? ' OR line_account_id IS NULL' : ''})`
    : scope.canSeeUnassigned
      ? 'line_account_id IS NULL'
      : '1 = 0';
  return { scope, where };
}

const requireVisibleTrackedLink: MiddlewareHandler<Env> = async (c, next) => {
  const link = await getTrackedLinkById(c.env.DB, c.req.param('id') ?? '');
  const accountId = link ? await resolveTrackedLinkAccountId(c.env.DB, link) : undefined;
  if (!link || accountId === undefined || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Tracked link not found' }, 404);
  }
  await next();
};

function serializeTrackedLink(row: TrackedLink, baseUrl: string) {
  // Prefer the short code (baseUrl may be a branded short domain).
  const trackingUrl = `${baseUrl}/t/${row.short_code ?? row.id}`;
  return {
    id: row.id,
    name: row.name,
    originalUrl: row.original_url,
    trackingUrl,
    shortCode: row.short_code,
    tagId: row.tag_id,
    scenarioId: row.scenario_id,
    introTemplateId: row.intro_template_id,
    rewardTemplateId: row.reward_template_id,
    lineAccountId: row.line_account_id,
    isActive: Boolean(row.is_active),
    clickCount: row.click_count,
    ogTitle: row.og_title,
    ogDescription: row.og_description,
    ogImageUrl: row.og_image_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getBaseUrl(c: { req: { url: string } }): string {
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

/** Base for admin-facing trackingUrl: branded short domain or the request origin. */
async function resolveApiLinkBase(c: { env: { DB: D1Database }; req: { url: string } }): Promise<string> {
  return resolveTrackedLinkBaseUrl(c.env.DB, getBaseUrl(c));
}

/**
 * Resolve the LINE account that owns a tracked link.
 * Priority: tracked_links.line_account_id → scenario_id → scenarios.line_account_id.
 * Returns null for legacy/unowned links (callers fall back to env defaults).
 */
async function resolveLinkAccount(
  db: D1Database,
  link: TrackedLink,
): Promise<LineAccount | null> {
  const accountId = await resolveLinkAccountId(db, link);
  if (!accountId) return null;
  return db
    .prepare(`SELECT * FROM line_accounts WHERE id = ?`)
    .bind(accountId)
    .first<LineAccount>();
}

const resolveLinkAccountId = resolveTrackedLinkAccountId;

// GET /api/tracked-links — list all
trackedLinks.get('/api/tracked-links', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    if (lineAccountId && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    let items = await getTrackedLinks(c.env.DB);
    if (lineAccountId) {
      items = items.filter((item) => item.line_account_id === lineAccountId);
    } else {
      const { scope } = await adminAccountScope(c);
      items = items.filter((item) => item.line_account_id === null
        ? scope.canSeeUnassigned
        : scope.allowedAccountIds.includes(item.line_account_id));
    }
    const base = await resolveApiLinkBase(c);
    return c.json({ success: true, data: items.map((item) => serializeTrackedLink(item, base)) });
  } catch (err) {
    logger.error("routes_tracked_links_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/tracked-links/:id — get single with click details
trackedLinks.get('/api/tracked-links/:id', requireVisibleTrackedLink, async (c) => {
  try {
    const id = c.req.param('id');
    const link = await getTrackedLinkById(c.env.DB, id);
    if (!link) {
      return c.json({ success: false, error: 'Tracked link not found' }, 404);
    }
    const clicks = await getLinkClicks(c.env.DB, id);
    const base = await resolveApiLinkBase(c);
    return c.json({
      success: true,
      data: {
        ...serializeTrackedLink(link, base),
        clicks: clicks.map((click) => ({
          id: click.id,
          friendId: click.friend_id,
          friendDisplayName: click.friend_display_name,
          clickedAt: click.clicked_at,
        })),
      },
    });
  } catch (err) {
    logger.error("routes_tracked_links_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/tracked-links — create
trackedLinks.post('/api/tracked-links', requireRole('owner', 'admin'), inputJsonBoundary({"name":["string"],"originalUrl":["string"],"tagId":["null","string"],"scenarioId":["null","string"],"introTemplateId":["null","string"],"rewardTemplateId":["null","string"],"lineAccountId":["null","string"],"ogTitle":["null","string"],"ogDescription":["null","string"],"ogImageUrl":["null","string"]}), async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      originalUrl: string;
      tagId?: string | null;
      scenarioId?: string | null;
      introTemplateId?: string | null;
      rewardTemplateId?: string | null;
      lineAccountId?: string | null;
      ogTitle?: string | null;
      ogDescription?: string | null;
      ogImageUrl?: string | null;
    }>();

    if (!body.name || !body.originalUrl) {
      return inputError(c, { success: false, error: 'name and originalUrl are required' }, 400, ["name","originalUrl"]);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId ?? null])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }

    const link = await createTrackedLink(c.env.DB, {
      name: body.name,
      originalUrl: body.originalUrl,
      tagId: body.tagId ?? null,
      scenarioId: body.scenarioId ?? null,
      introTemplateId: body.introTemplateId ?? null,
      rewardTemplateId: body.rewardTemplateId ?? null,
      lineAccountId: body.lineAccountId ?? null,
      ogTitle: body.ogTitle ?? null,
      ogDescription: body.ogDescription ?? null,
      ogImageUrl: body.ogImageUrl ?? null,
    });

    const base = await resolveApiLinkBase(c);
    return c.json({ success: true, data: serializeTrackedLink(link, base) }, 201);
  } catch (err) {
    logger.error("routes_tracked_links_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/tracked-links/:id — update mutable fields
trackedLinks.patch('/api/tracked-links/:id', requireRole('owner', 'admin'), requireVisibleTrackedLink, inputJsonBoundary({"name":["string"],"tagId":["null","string"],"scenarioId":["null","string"],"introTemplateId":["null","string"],"rewardTemplateId":["null","string"],"lineAccountId":["null","string"],"isActive":["boolean"],"ogTitle":["null","string"],"ogDescription":["null","string"],"ogImageUrl":["null","string"]}), async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      tagId?: string | null;
      scenarioId?: string | null;
      introTemplateId?: string | null;
      rewardTemplateId?: string | null;
      lineAccountId?: string | null;
      isActive?: boolean;
      ogTitle?: string | null;
      ogDescription?: string | null;
      ogImageUrl?: string | null;
    }>();

    if ('lineAccountId' in body
      && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId ?? null])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }

    const link = await updateTrackedLink(c.env.DB, id, body);
    if (!link) {
      return c.json({ success: false, error: 'Tracked link not found' }, 404);
    }
    const base = await resolveApiLinkBase(c);
    return c.json({ success: true, data: serializeTrackedLink(link, base) });
  } catch (err) {
    logger.error("routes_tracked_links_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/tracked-links/:id
trackedLinks.delete('/api/tracked-links/:id', requireRole('owner', 'admin'), requireVisibleTrackedLink, async (c) => {
  try {
    const id = c.req.param('id');
    const link = await getTrackedLinkById(c.env.DB, id);
    if (!link) {
      return c.json({ success: false, error: 'Tracked link not found' }, 404);
    }
    await deleteTrackedLink(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    logger.error("routes_tracked_links_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// Domains where Universal Links should be used (JS redirect instead of 302)
const APP_LINK_DOMAINS = new Set([
  'x.com',
  'twitter.com',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'facebook.com',
  'github.com',
]);

function isAppLinkDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return APP_LINK_DOMAINS.has(hostname);
  } catch {
    return false;
  }
}

// Android app package names for intent:// deep links
const ANDROID_PACKAGES: Record<string, string> = {
  'x.com': 'com.twitter.android',
  'twitter.com': 'com.twitter.android',
  'instagram.com': 'com.instagram.android',
  'youtube.com': 'com.google.android.youtube',
  'youtu.be': 'com.google.android.youtube',
  'tiktok.com': 'com.zhiliaoapp.musically',
  'facebook.com': 'com.facebook.katana',
  'github.com': 'com.github.android',
};

function getAndroidPackage(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return ANDROID_PACKAGES[hostname] ?? null;
  } catch {
    return null;
  }
}

function buildAppRedirectHtml(destinationUrl: string): string {
  destinationUrl = new URL(destinationUrl).href;
  if (!/^https?:$/.test(new URL(destinationUrl).protocol)) throw new Error('unsafe_destination');
  const escaped = escapeHtml(destinationUrl);
  const androidPackage = getAndroidPackage(destinationUrl);
  // intent://path#Intent;scheme=https;package=com.xxx;S.browser_fallback_url=https://...;end
  const intentUrl = androidPackage
    ? `intent://${destinationUrl.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=${androidPackage};S.browser_fallback_url=${encodeURIComponent(destinationUrl)};end`
    : null;
  const destinationScript = scriptString(destinationUrl);
  const intentScript = scriptString(intentUrl ?? '');

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Redirecting...</title>
<style>body{display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui;color:#64748b;background:#f8fafc}p{font-size:14px}</style>
</head><body>
<p>Opening app...</p>
<script>
(function(){
  var isAndroid = /Android/i.test(navigator.userAgent);
  if(isAndroid && ${intentScript}){
    window.location.href=${intentScript};
  } else {
    window.location.href=${destinationScript};
  }
})();
</script>
<noscript><meta http-equiv="refresh" content="0;url=${escaped}"></noscript>
</body></html>`;
}

// 本人のID tokenを検証し、遷移先へ生のtokenやLINE IDを載せずに引き継ぐ。
trackedLinks.post('/api/liff/tracked-link-identity', inputJsonBoundary({ linkId: ['string'], idToken: ['string'] }), async (c) => {
  const { linkId, idToken } = await c.req.json<{ linkId: string; idToken: string }>();
  if (!linkId || !idToken) return c.json({ success: false, error: 'Identity required' }, 401);
  const link = await getTrackedLinkByIdOrShortCode(c.env.DB, linkId);
  if (!link?.is_active) return c.json({ success: false, error: 'Link not found' }, 404);
  const accountId = await resolveLinkAccountId(c.env.DB, link);
  if (accountId === undefined) return c.json({ success: false, error: 'Link not found' }, 404);
  const account = await trackedLinkSigningAccount(c.env.DB, accountId);
  if (!account?.is_active || account.archived_at || !await isLineAccountTenantActive(c.env.DB, account.id)) {
    return c.json({ success: false, error: 'Account unavailable' }, 503);
  }
  const channelId = account.login_channel_id || (accountId === null ? c.env.LINE_LOGIN_CHANNEL_ID : '');
  if (!channelId) return c.json({ success: false, error: 'Identity unavailable' }, 401);
  const response = await tracedFetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  if (!response.ok) return c.json({ success: false, error: 'Invalid ID token' }, 401);
  const identity = await response.json() as { sub?: unknown };
  if (typeof identity.sub !== 'string' || !identity.sub) return c.json({ success: false, error: 'Invalid ID token' }, 401);
  const friend = await getFriendByLineUserIdForAccount(c.env.DB, identity.sub, accountId);
  const token = friend ? await issueTrackedLinkIdentity(c.env.DB, link, friend.id, 5 * 60) : null;
  if (!token) return c.json({ success: false, error: 'Friend not found' }, 404);
  c.header('Cache-Control', 'no-store');
  return c.json({ success: true, data: { token } });
});

// GET /t/:linkId — click tracking redirect (no auth, fast redirect)
// :linkId accepts both the legacy UUID and the 7-char short code.
trackedLinks.get('/t/:linkId', async (c) => {
  const linkId = c.req.param('linkId');
  let friendId: string | null = null;
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Cache-Control', 'no-store');

  // Look up the link first
  const link = await getTrackedLinkByIdOrShortCode(c.env.DB, linkId);

  if (!link || !link.is_active) {
    return c.json({ success: false, error: 'Link not found' }, 404);
  }

  // Bot UA (LINE/X/Facebook 等のリンクプレビュー) → OGP HTML を返して終了。
  // クリック記録もスキップ（bot のアクセスは CV ではない）。
  const ua = c.req.header('user-agent') || '';
  if (isLinkPreviewBot(ua)) {
    const canonical = `${c.env.WORKER_URL || new URL(c.req.url).origin}/t/${linkId}`;
    // link.line_account_id 優先、無ければ scenario 経由でアカウントを解決する。
    // どちらも無いリンクは account=null（og:site_name='LINE' フォールバック）。
    const account = await resolveLinkAccount(c.env.DB, link);
    const og = resolveOgForTrackedLink(link, account, canonical);
    return c.html(buildOgHtml(og));
  }

  const useAppRedirect = isAppLinkDomain(link.original_url);
  const identityToken = c.req.query('identity');
  if (identityToken) friendId = await verifyTrackedLinkIdentity(c.env.DB, link, identityToken);

  // If no user ID yet, check if this is LINE's in-app browser → redirect to LIFF for identification
  // Skip LIFF redirect for app-link domains (they'll come from Safari via externalBrowser)
  //
  // LIFF はリンクを所有するアカウントのものを使う。グローバル env.LIFF_URL 固定だと
  // 他アカウントの友だちに①の同意画面が出る（未同意チャネルの LIFF に飛ぶため）。
  const isLineApp = /\bLine\b/i.test(ua);
  if (!useAppRedirect && !friendId && identityToken === undefined && !c.req.query('lu') && !c.req.query('f') && isLineApp) {
    let liffBase: string | null = null;
    const account = await resolveLinkAccount(c.env.DB, link);
    const liffId = (account?.liff_id as string | null | undefined) ?? null;
    if (liffId) liffBase = `https://liff.line.me/${liffId}`;
    if (!liffBase && c.env.LIFF_URL) liffBase = c.env.LIFF_URL;
    if (liffBase) {
      const directUrl = `${c.env.WORKER_URL || new URL(c.req.url).origin}/t/${linkId}`;
      const liffRedirect = `${liffBase}?redirect=${encodeURIComponent(directUrl)}`;
      return c.redirect(liffRedirect, 302);
    }
  }

  // Record the click and its fixed work plan before returning the redirect. Cron owns continuation.
  const accountId=(await resolveLinkAccountId(c.env.DB,link)) ?? null;
  const points=friendId ? await getUrlReachConversionPoints(c.env.DB,link.original_url,accountId) : [];
  const click=await recordTrackedClick(c.env.DB,{linkId:link.id,friendId,accountId,tagId:link.tag_id,scenarioId:link.scenario_id,
    linkName:link.name,identityVerified:friendId ? true : undefined,conversionPointIds:points.map(point=>point.id),tapExtras:extrasFromTrackedLink(link)});
  c.executionCtx.waitUntil(processTrackedClick(c.env,click.id,click.plan).catch(()=>{
    logger.error("tracked_click_work_pending");
  }));

  // App-link domains: return HTML with JS redirect for Universal Link support
  if (useAppRedirect) {
    return c.html(buildAppRedirectHtml(link.original_url));
  }

  return c.redirect(link.original_url, 302);
});

export { trackedLinks };
