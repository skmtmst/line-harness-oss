import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  getTrackedLinks,
  getTrackedLinkById,
  getTrackedLinkByIdOrShortCode,
  createTrackedLink,
  updateTrackedLink,
  deleteTrackedLink,
  recordLinkClick,
  getLinkClicks,
  getFriendByLineUserIdForAccount,
} from '@line-crm/db';
import { enrollFriendInScenario, getUrlReachConversionPoints, trackConversion } from '@line-crm/db';
import { attachTagAndFireSideEffects } from '../services/friend-tag-attach.js';
import type { TrackedLink } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { isLinkPreviewBot } from '../lib/og-bot.js';
import { buildOgHtml } from '../lib/og-html.js';
import { resolveOgForTrackedLink } from '../lib/og-resolver.js';
import { resolveTrackedLinkBaseUrl } from '../lib/link-base-url.js';
import { awardActivityMileage } from '../services/activity-mileage.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { dispatchAutomationEventWithLogging } from '../services/automation-triggers.js';
import { applyActionScoreEvent } from '../services/action-score-events.js';

const trackedLinks = new Hono<Env>();

async function adminAccountScope(c: Context<Env>) {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const where = scope.allowedAccountIds.length
    ? `(line_account_id IN (${scope.allowedAccountIds.map(() => '?').join(',')})${scope.canSeeUnassigned ? ' OR line_account_id IS NULL' : ''})`
    : scope.canSeeUnassigned
      ? 'line_account_id IS NULL'
      : '1 = 0';
  return { scope, where };
}

const requireVisibleTrackedLink: MiddlewareHandler<Env> = async (c, next) => {
  const link = await getTrackedLinkById(c.env.DB, c.req.param('id') ?? '');
  if (!link || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [link.line_account_id])) {
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
): Promise<Record<string, unknown> | null> {
  const accountId = await resolveLinkAccountId(db, link);
  if (!accountId) return null;
  return db
    .prepare(`SELECT * FROM line_accounts WHERE id = ?`)
    .bind(accountId)
    .first<Record<string, unknown>>();
}

async function resolveLinkAccountId(
  db: D1Database,
  link: TrackedLink,
): Promise<string | null> {
  let accountId: string | null = link.line_account_id ?? null;
  if (!accountId && link.scenario_id) {
    const scRow = await db
      .prepare(`SELECT line_account_id FROM scenarios WHERE id = ?`)
      .bind(link.scenario_id)
      .first<{ line_account_id: string | null }>();
    accountId = scRow?.line_account_id ?? null;
  }
  return accountId;
}

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
    console.error('GET /api/tracked-links error:', err);
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
    console.error('GET /api/tracked-links/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/tracked-links — create
trackedLinks.post('/api/tracked-links', requireRole('owner', 'admin'), async (c) => {
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
      return c.json({ success: false, error: 'name and originalUrl are required' }, 400);
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
    console.error('POST /api/tracked-links error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/tracked-links/:id — update mutable fields
trackedLinks.patch('/api/tracked-links/:id', requireRole('owner', 'admin'), requireVisibleTrackedLink, async (c) => {
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
    console.error('PATCH /api/tracked-links/:id error:', err);
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
    console.error('DELETE /api/tracked-links/:id error:', err);
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
  const escaped = destinationUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const androidPackage = getAndroidPackage(destinationUrl);
  // intent://path#Intent;scheme=https;package=com.xxx;S.browser_fallback_url=https://...;end
  const intentUrl = androidPackage
    ? `intent://${destinationUrl.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=${androidPackage};S.browser_fallback_url=${encodeURIComponent(destinationUrl)};end`
    : null;
  const intentEscaped = intentUrl ? intentUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;') : '';

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
  if(isAndroid && "${intentEscaped}"){
    window.location.href="${intentEscaped}";
  } else {
    window.location.href="${escaped}";
  }
})();
</script>
<noscript><meta http-equiv="refresh" content="0;url=${escaped}"></noscript>
</body></html>`;
}

// GET /t/:linkId — click tracking redirect (no auth, fast redirect)
// :linkId accepts both the legacy UUID and the 7-char short code.
trackedLinks.get('/t/:linkId', async (c) => {
  const linkId = c.req.param('linkId');
  const lineUserId = c.req.query('lu') ?? null;
  let friendId = c.req.query('f') ?? null;

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
    const og = resolveOgForTrackedLink(link, account as any, canonical);
    return c.html(buildOgHtml(og));
  }

  const useAppRedirect = isAppLinkDomain(link.original_url);

  // If no user ID yet, check if this is LINE's in-app browser → redirect to LIFF for identification
  // Skip LIFF redirect for app-link domains (they'll come from Safari via externalBrowser)
  //
  // LIFF はリンクを所有するアカウントのものを使う。グローバル env.LIFF_URL 固定だと
  // 他アカウントの友だちに①の同意画面が出る（未同意チャネルの LIFF に飛ぶため）。
  const isLineApp = /\bLine\b/i.test(ua);
  if (!useAppRedirect && !lineUserId && !friendId && isLineApp) {
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

  // Resolve friendId from LINE user ID if provided
  if (!friendId && lineUserId) {
    const accountId = await resolveLinkAccountId(c.env.DB, link);
    const friend = await getFriendByLineUserIdForAccount(
      c.env.DB,
      lineUserId,
      accountId,
    );
    if (friend) {
      friendId = friend.id;
    }
  }

  // Run side-effects async (click recording, tag/scenario actions)
  const ctx = c.executionCtx as ExecutionContext;
  ctx.waitUntil(
    (async () => {
      try {
        // Record the click (link.id, not the raw param — it may be a short code)
        const click = await recordLinkClick(c.env.DB, link.id, friendId);

        if (friendId) {
          await awardActivityMileage(c.env.DB, {
            eventType: 'link_clicked',
            source: 'tracked_link',
            sourceEventId: click.id,
            friendId,
            subjectKey: link.id,
            metadata: { trackedLinkId: link.id, linkName: link.name },
            occurredAt: click.clicked_at,
          });
          const accountId = await resolveLinkAccountId(c.env.DB, link);
          if (accountId) {
            const results = await Promise.allSettled([
              applyActionScoreEvent(c.env.DB, {
                lineAccountId: accountId,
                friendId,
                eventType: 'link_clicked',
                source: 'tracked_link',
                sourceEventId: click.id,
                subjectKey: link.id,
                occurredAt: click.clicked_at,
              }),
              dispatchAutomationEventWithLogging(c.env.DB, {
                lineAccountId: accountId,
                eventType: 'link_clicked',
                sourceEventId: click.id,
                friendId,
                eventData: { trackedLinkId: link.id, clickId: click.id },
              }),
            ]);
            for (const result of results) {
              if (result.status === 'rejected') console.error('tracked link action event failed:', result.reason);
            }
          }
        }

        // Run automatic actions if a friend is identified
        if (friendId) {
          const actions: Promise<unknown>[] = [];

          // 「このURLに着いたら成果」と決めてある地点があれば数える。
          // 判定は転送先URL（link.original_url）に対して行う。/t/ 自体は
          // 短縮URLで、成果地点の設定には出てこないため。
          //
          // ここで数えるのは、リンクを踏んだ人が確実に分かるのがこの経路だけ
          // だから。転送先のページに計測を仕込む方法だと、そのページを
          // こちらで触れる必要がある。
          actions.push(
            (async () => {
              const points = await getUrlReachConversionPoints(
                c.env.DB,
                link.original_url,
                link.line_account_id ?? null,
              );
              for (const point of points) {
                // 一人一回の地点で二度目のときは trackConversion 側が
                // 既存の1件を返すので、ここでは重複を気にしなくてよい。
                await trackConversion(c.env.DB, {
                  conversionPointId: point.id,
                  friendId: friendId!,
                  metadata: JSON.stringify({ via: 'tracked_link', trackedLinkId: link.id }),
                });
              }
            })(),
          );

          if (link.tag_id) {
            // Guarded attach: fires tag_added scenario enrollment only when
            // the tag is NEWLY applied — an in-app /t click must start a
            // tag-triggered campaign exactly like the /auth/line ref path
            // does, and stay silent on re-clicks.
            actions.push(attachTagAndFireSideEffects(c.env.DB, friendId, link.tag_id, {
              defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
              workerUrl: c.env.WORKER_URL,
            }));
          }

          if (link.scenario_id) {
            actions.push(enrollFriendInScenario(c.env.DB, friendId, link.scenario_id));
          }

          if (actions.length > 0) {
            await Promise.allSettled(actions);
          }
        }
      } catch (err) {
        console.error(`/t/${linkId} async tracking error:`, err);
      }
    })(),
  );

  // App-link domains: return HTML with JS redirect for Universal Link support
  if (useAppRedirect) {
    return c.html(buildAppRedirectHtml(link.original_url));
  }

  return c.redirect(link.original_url, 302);
});

export { trackedLinks };
