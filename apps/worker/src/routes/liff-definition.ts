import { logger, tracedFetch as fetch } from '@line-crm/shared/server';
import { sqlIdSet } from '@line-crm/db/id-queries';
import { patchFriendMetadata } from '../features/friends/friend-metadata/index.js';
import { type Context } from 'hono';
import { getEntryRouteByRefCode, recordFriendAddAttributionCandidate, addTagToFriend, getTrackedLinkById, getAffiliateLinkByRefCode, getAffiliateOfferById, getAffiliateById, enrollFriendInScenario, findOrCreateGlobalTag, isLineAccountTenantActive } from '@line-crm/db';
import { isStoppedEntryRouteRef } from '../services/entry-route-stop.js';
import { attachTagAndFireSideEffects } from '../features/friends/friend-tag-attach/index.js';
import { pushImmediateFirstStep } from '../services/immediate-first-step.js';
import { notifyAffiliateFriendAdd } from '../services/affiliate-notifier.js';
import { awardActivityMileage } from '../services/activity-mileage.js';
import type { Env } from '../worker-env.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

export // OAuth state base64 helpers. btoa only accepts Latin-1, so a single
// multibyte query param (e.g. utm_campaign=夏キャンペーン) used to throw
// InvalidCharacterError and turn the whole /auth/line request into a 500.
// Encode via UTF-8 bytes instead. decodeState is byte-compatible with
// states produced by the old plain btoa (ASCII-only payloads).
function encodeState(state: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(state)));
}
export function decodeState(encoded: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0)));
}

export const TENANT_UNAVAILABLE_RESPONSE = {
  success: false,
  code: 'TENANT_SUSPENDED',
  error: '現在ご利用いただけません',
} as const;

export async function stoppedLineAccountResponse(
  c: Context<Env>,
  lineAccountId: string | null | undefined,
): Promise<Response | null> {
  if (!lineAccountId) return null;
  return await isLineAccountTenantActive(c.env.DB, lineAccountId)
    ? null
    : c.json(TENANT_UNAVAILABLE_RESPONSE, 503);
}

export /**
 * 呼び出し側の見えるアカウントに絞る WHERE 断片を作る。
 * IDEA-18: 友だち(f)だけでなく注文(o)や相関副問合せの友だち(f2)にも
 * 同じ条件を使うため、別名ごとの断片を `for(alias)` で作れるようにした。
 * 既定の where/binds は従来どおり友だち別名 `f` のものを返す。
 */
async function analyticsAccountScope(c: Context<Env>, lineAccountId?: string) {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (lineAccountId && !scope.allowedAccountIds.includes(lineAccountId)) {
    return null;
  }
  const forAlias = (alias: string) => {
    if (lineAccountId) {
      return { where: `AND ${alias}.line_account_id = ?`, binds: [lineAccountId] };
    }
    const where = scope.allowedAccountIds.length
      ? `AND (${alias}.line_account_id IN (${sqlIdSet(scope.allowedAccountIds).sql})${scope.canSeeUnassigned ? ` OR ${alias}.line_account_id IS NULL` : ''})`
      : scope.canSeeUnassigned
        ? `AND ${alias}.line_account_id IS NULL`
        : 'AND 1 = 0';
    return { where, binds: scope.allowedAccountIds.length ? sqlIdSet(scope.allowedAccountIds).binds : [] };
  };
  return { ...forAlias('f'), for: forAlias };
}

export async function saveFriendAddCandidate(
  db: D1Database,
  input: {
    lineAccountId: string | null;
    friendId: string;
    refCode?: string | null;
    source: 'line_login' | 'liff' | 'short_link';
  },
): Promise<void> {
  const refCode = input.refCode?.trim();
  if (!input.lineAccountId || !refCode || refCode.startsWith('xh:')) return;
  // N-244: 停止した流入経路の ref は候補も残さない。入口表示後に停止して
  // LIFF/OAuth直送で届いた場合も、共有 namespace の tracked/affiliate へ
  // 落とさず止める。不存在 ref (Any が null) は従来どおり記録する。
  if (await isStoppedEntryRouteRef(db, refCode)) return;
  try {
    const route = await getEntryRouteByRefCode(db, refCode);
    await recordFriendAddAttributionCandidate(db, {
      lineAccountId: input.lineAccountId,
      friendId: input.friendId,
      refCode,
      entryRouteId: route?.id ?? null,
      source: input.source,
    });
  } catch (err) {
    // 既存のLIFF連携を止めない。台帳だけ監視ログへ残して再調査できるようにする。
    logger.error("friend_add_candidate_record_failed");
  }
}

export // Persist ig_igsid on the LINE friend and notify IG Harness.
// Used anywhere a LIFF/OAuth flow resolves with a known IGSID so existing
// friends (who bypass /auth/callback) also get the cross-link written.
// Returns whether the friend is linked to THIS IGSID after the call (true
// when written or already identical; false on conflict/error). Callers use
// the verdict to gate IG-account metadata writes so metadata can't claim an
// account that contradicts the stored ig_igsid. An empty igParam returns
// true: no IGSID means no conflict evidence.
async function linkIgIgsid(
  c: Context<Env>,
  friendId: string,
  igParam: string,
): Promise<boolean> {
  if (!igParam) return true;

  // Only notify IG Harness if this friend is actually linked to this IGSID
  // locally. Writing LINE→IG first then gating the IG→LINE notify prevents
  // the two DBs from diverging when the same LINE friend is hit with a
  // different ?ig= on a later visit (the UPDATE is a no-op, and blindly
  // notifying would then point IG Harness at the wrong LINE UUID).
  let linked = false;
  try {
    const result = await c.env.DB
      .prepare('UPDATE friends SET ig_igsid = ? WHERE id = ? AND (ig_igsid IS NULL OR ig_igsid = ?)')
      .bind(igParam, friendId, igParam)
      .run();
    if (result.meta?.changes && result.meta.changes > 0) {
      linked = true;
    } else {
      const row = await c.env.DB
        .prepare('SELECT ig_igsid FROM friends WHERE id = ?')
        .bind(friendId)
        .first<{ ig_igsid: string | null }>();
      linked = row?.ig_igsid === igParam;
    }
  } catch (err) {
    logger.error("liff.link_ig_igsid_failed");
    return false;
  }

  if (!linked) {
    logger.warn("routes_liff_warn");
    return false;
  }

  // A successful IG -> LINE return is itself an engagement milestone. The
  // stable identity/subject keys make repeated LIFF visits harmless.
  await awardActivityMileage(c.env.DB, {
    eventType: 'instagram_line_returned',
    source: 'instagram',
    sourceEventId: `${friendId}:${igParam}`,
    friendId,
    subjectKey: igParam,
    metadata: { igsid: igParam },
  });

  if (c.env.IG_HARNESS_URL && c.env.IG_HARNESS_LINK_SECRET) {
    c.executionCtx.waitUntil(
      fetch(`${c.env.IG_HARNESS_URL}/api/followers/link-line`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LINE-HARNESS-LINK-SECRET': c.env.IG_HARNESS_LINK_SECRET,
        },
        body: JSON.stringify({ igsid: igParam, line_friend_uuid: friendId }),
      })
        .then(async (res) => {
          if (!res.ok) {
            logger.error("liff.link_ig_igsid_failed");
          }
          await res.body?.cancel().catch(() => undefined);
        })
        .catch((err) => logger.error("liff.link_ig_igsid_failed")),
    );
  }
  return true;
}

export /**
 * Persist which IG Harness business account funneled this friend in.
 * First touch wins — a friend arriving via multiple IG accounts keeps the
 * original attribution, mirroring friends.ref_code semantics. Values land in
 * friends.metadata (ig_account_id / ig_account_username) so no migration is
 * needed and the admin friend detail can render an attribution badge.
 */
async function saveIgAccountMeta(
  db: D1Database,
  friendId: string,
  igAccountId: string,
  igAccountUsername: string,
): Promise<void> {
  if (!igAccountId && !igAccountUsername) return;
  try {
    const patch: Record<string,string> = {};
    if (igAccountId) patch.ig_account_id = igAccountId;
    if (igAccountUsername) patch.ig_account_username = igAccountUsername.replace(/^@/, '');
    await patchFriendMetadata(db, friendId, patch, { firstTouchKeys: ['ig_account_id','ig_account_username'] });
  } catch (err) {
    logger.error("liff.save_ig_account_meta_failed");
  }
}

export // Apply tag + scenario from a ref code. Looks up entry_routes (legacy) first,
// then tracked_links (modern). Both expose (tag_id, scenario_id) so the call
// sites are uniform.
//
// Click-campaign semantics: when scenario step 1 is delay-0, push it on
// EVERY click — not just first enrollment. enrollFriendInScenario is
// INSERT OR IGNORE so re-clicks return null, but the push fires anyway
// so the same Flex / message is re-delivered each time the user re-enters
// the funnel (matches user expectation of "tracked link push"). Only
// advance the enrollment row when the enrollment row is freshly created;
// otherwise the cron worker keeps managing the existing enrollment.
//
// Used from BOTH /auth/callback (new friends, OAuth path) and
// /api/liff/link (existing friends, LIFF SDK path) so click-driven push
// works for already-friend users too.
//
// `accountChannelId` lets callers (e.g. /auth/callback) supply the resolved
// LINE account context when `friend.line_account_id` may not yet be wired
// up by the follow webhook. Without it the helper would fall back to the
// default env token and push to the wrong bot for non-default accounts.
async function applyRefAttribution(
  c: Context<Env>,
  ref: string,
  friend: { id: string; line_account_id?: string | null },
  lineUserId: string,
  options?: { accountChannelId?: string | null; isNewFriend?: boolean },
): Promise<void> {
  if (!ref || ref.startsWith('xh:')) return;
  const db = c.env.DB;

  // N-244: 停止した流入経路の ref は、入口表示後の LIFF/OAuth 直送でも
  // tracked/affiliate fallback・タグ/シナリオ開始をすべて止める。
  // 不存在 ref は共有 namespace の正規フローのため従来どおり進める。
  if (await isStoppedEntryRouteRef(db, ref)) return;

  const route = await getEntryRouteByRefCode(db, ref);
  let trackedLink: Awaited<ReturnType<typeof getTrackedLinkById>> = null;
  if (!route) {
    const tl = await getTrackedLinkById(db, ref);
    if (tl?.is_active) trackedLink = tl;
  }

  // ASP Phase 2: when the ref is neither an entry_route nor a tracked_link,
  // it may be an affiliate offer link. An affiliate_link carrying a non-NULL
  // offer_id inherits the offer's tag + scenario, applied through the same
  // path as entry_routes / tracked_links so the flow is identical. Generic
  // affiliate links (offer_id NULL) resolve to no tag/scenario — unchanged.
  let offer: Awaited<ReturnType<typeof getAffiliateOfferById>> = null;
  if (!route && !trackedLink) {
    const affiliateLink = await getAffiliateLinkByRefCode(db, ref);
    if (affiliateLink) {
      // ASP friend-add notification: only for a brand-new friend arriving via an
      // affiliate link (existing-friend re-touches would spam the affiliate).
      // Self-clicks (the affiliate adding their own bot) are suppressed. Runs
      // even for a 汎用リンク (offer_id NULL) — offerName is then null.
      // Wrapped so a notify failure can never break attribution.
      if (options?.isNewFriend) {
        try {
          const affiliate = await getAffiliateById(db, affiliateLink.affiliate_id);
          if (affiliate && affiliate.friend_id !== friend.id) {
            let offerName: string | null = null;
            if (affiliateLink.offer_id) {
              const linkOffer = await getAffiliateOfferById(db, affiliateLink.offer_id);
              offerName = linkOffer?.name ?? null;
            }
            await notifyAffiliateFriendAdd(db, c.env, affiliate.id, offerName);
          }
        } catch (err) {
          logger.error("liff.apply_ref_attribution_failed");
        }
      }

      if (affiliateLink.offer_id) {
        const fetchedOffer = await getAffiliateOfferById(db, affiliateLink.offer_id);
        // Inactive offers (is_active = 0) are treated as null: stop the automatic
        // flow (tag / scenario) so a paused campaign does not enroll new friends.
        // Attribution recording (ref_tracking / ref_code on the friend row) is
        // unaffected — it runs before this function and always persists the click.
        if (fetchedOffer?.is_active) {
          offer = fetchedOffer;
        }
      }
    }
  }

  const effectiveTagId = route?.tag_id ?? trackedLink?.tag_id ?? offer?.tag_id ?? null;
  const effectiveScenarioId =
    route?.scenario_id ?? trackedLink?.scenario_id ?? offer?.scenario_id ?? null;

  if (effectiveTagId) {
    // Guarded attach: fires tag_added scenario enrollment (and tag_change
    // events) ONLY when the tag is newly applied. Re-clicks and clicks from
    // other links carrying the same tag are no-ops, so a tag_added-triggered
    // campaign (e.g. a seminar optin sequence) sends exactly once per friend
    // no matter how many article links they enter through. Routes that want
    // push-on-every-click keep using an explicit scenario_id below.
    await attachTagAndFireSideEffects(db, friend.id, effectiveTagId, {
      defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
      workerUrl: c.env.WORKER_URL,
      accountChannelId: options?.accountChannelId ?? null,
    });
  }
  if (effectiveScenarioId) {
    try {
      await pushImmediateFirstStep(
        db,
        friend.id,
        effectiveScenarioId,
        {
          defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
          workerUrl: c.env.WORKER_URL,
          accountChannelId: options?.accountChannelId ?? null,
        },
        // every-click: cooldown before enrolling, push even on re-clicks,
        // advance only fresh / behind enrollment rows (see the service).
        // lineUserId comes from the verified id_token / OAuth exchange, so
        // the push works even before friend.line_user_id is fully wired.
        { mode: 'every-click', targetLineUserId: lineUserId },
      );
    } catch (err) {
      logger.error("liff.apply_ref_attribution_failed");
    }
  }
}

export // ─── HTML Templates ─────────────────────────────────────────────

function authLandingPage(liffUrl: string, oauthUrl: string): string {
  // Extract LIFF ID from URL like https://liff.line.me/{LIFF_ID}?ref=test
  const liffIdMatch = liffUrl.match(/liff\.line\.me\/([^?]+)/);
  const liffId = liffIdMatch ? liffIdMatch[1] : '';
  // Query string part (e.g., ?ref=test)
  const qsIndex = liffUrl.indexOf('?');
  const liffQs = qsIndex >= 0 ? liffUrl.slice(qsIndex) : '';

  // line:// scheme to force open LINE app with LIFF
  const lineSchemeUrl = `https://line.me/R/app/${liffId}${liffQs}`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LINE で開く</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Hiragino Sans', system-ui, sans-serif; background: #06C755; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; padding: 40px 24px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); text-align: center; max-width: 400px; width: 90%; }
    .line-icon { font-size: 48px; margin-bottom: 16px; }
    h2 { font-size: 20px; color: #333; margin-bottom: 8px; }
    .sub { font-size: 14px; color: #999; margin-bottom: 24px; }
    .btn { display: block; width: 100%; padding: 16px; border: none; border-radius: 8px; font-size: 16px; font-weight: 700; text-decoration: none; text-align: center; cursor: pointer; transition: opacity 0.15s; font-family: inherit; }
    .btn:active { opacity: 0.85; }
    .btn-line { background: #06C755; color: #fff; margin-bottom: 12px; }
    .btn-web { background: #f5f5f5; color: #666; font-size: 13px; padding: 12px; }
    .loading { margin-top: 16px; font-size: 13px; color: #999; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="card" id="card">
    <div class="line-icon">💬</div>
    <h2>LINEで開く</h2>
    <p class="sub">LINEアプリが起動します</p>
    <a href="${escapeHtml(lineSchemeUrl)}" class="btn btn-line" id="openBtn">LINEアプリで開く</a>
    <a href="${escapeHtml(oauthUrl)}" class="btn btn-web" id="pcBtn">PCの方・LINEが開かない方</a>
    <p class="loading hidden" id="loading">LINEアプリを起動中...</p>
  </div>
  <script>
    var lineUrl = '${escapeHtml(lineSchemeUrl)}';
    var ua = navigator.userAgent.toLowerCase();
    var isMobile = /iphone|ipad|android/.test(ua);
    var isLine = /line\\//.test(ua);
    var isIOS = /iphone|ipad/.test(ua);
    var isAndroid = /android/.test(ua);

    if (isLine) {
      // Already in LINE — go to LIFF directly
      window.location.href = '${escapeHtml(liffUrl)}';
    } else if (isMobile) {
      // Mobile browser — try to open LINE app
      document.getElementById('loading').classList.remove('hidden');
      document.getElementById('openBtn').classList.add('hidden');

      // Use line.me/R/app/ which is a Universal Link (iOS) / App Link (Android)
      // This opens LINE app directly without showing browser login
      setTimeout(function() {
        window.location.href = lineUrl;
      }, 100);

      // Fallback: if LINE app doesn't open within 2s, show the button
      setTimeout(function() {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('openBtn').classList.remove('hidden');
        document.getElementById('openBtn').textContent = 'もう一度試す';
      }, 2500);
    }
  </script>
</body>
</html>`;
}

export function completionPage(displayName: string, pictureUrl: string | null, ref: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登録完了</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Hiragino Sans', system-ui, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; padding: 40px 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); text-align: center; max-width: 400px; width: 90%; }
    .check { width: 64px; height: 64px; border-radius: 50%; background: #06C755; color: #fff; font-size: 32px; line-height: 64px; margin: 0 auto 16px; }
    h2 { font-size: 20px; color: #06C755; margin-bottom: 16px; }
    .profile { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 16px 0; }
    .profile img { width: 48px; height: 48px; border-radius: 50%; }
    .profile .name { font-size: 16px; font-weight: 600; }
    .message { font-size: 14px; color: #666; line-height: 1.6; margin-top: 12px; }
    .ref { display: inline-block; margin-top: 12px; padding: 4px 12px; background: #f0f0f0; border-radius: 12px; font-size: 11px; color: #999; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h2>登録完了！</h2>
    <div class="profile">
      ${pictureUrl ? `<img src="${pictureUrl}" alt="">` : ''}
      <p class="name">${escapeHtml(displayName)} さん</p>
    </div>
    <p class="message">ありがとうございます！<br>これからお役立ち情報をお届けします。<br>このページは閉じて大丈夫です。</p>
    ${ref ? `<p class="ref">${escapeHtml(ref)}</p>` : ''}
  </div>
</body>
</html>`;
}

export function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>エラー</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Hiragino Sans', system-ui, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; padding: 40px 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); text-align: center; max-width: 400px; width: 90%; }
    h2 { font-size: 18px; color: #e53e3e; margin-bottom: 12px; }
    p { font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <div class="card">
    <h2>エラー</h2>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export // ─── X Harness Token Resolution ─────────────────────────────────

/**
 * Apply X Harness gate actions (tag + scenario) to a LINE friend.
 * Non-blocking — failures are logged but don't interrupt the flow.
 */
async function applyXHarnessActions(
  db: D1Database,
  friendId: string,
  result: XHarnessTokenResult,
): Promise<void> {
  // Add tag if specified
  if (result.tag) {
    try {
      const tagRow = await findOrCreateGlobalTag(db, { name: result.tag });
      if (tagRow) {
        const { addTagToFriend } = await import('@line-crm/db');
        await addTagToFriend(db, friendId, tagRow.id);
        logger.log("routes_liff_log");
      }
    } catch (err) {
      logger.error("liff.apply_xharness_actions_failed");
    }
  }

  // Start scenario if specified
  if (result.scenarioId) {
    try {
      const { enrollFriendInScenario } = await import('@line-crm/db');
      await enrollFriendInScenario(db, friendId, result.scenarioId);
      logger.log("routes_liff_log");
    } catch (err) {
      logger.error("liff.apply_xharness_actions_failed");
    }
  }
}

export interface XHarnessTokenResult {
  xUsername: string | null;
  tag: string | null;
  scenarioId: string | null;
}

export /**
 * Resolve an X Harness token to get the linked X username + gate config (tag, scenario).
 * The token IS the secret — no Bearer auth needed on the resolve endpoint.
 */
async function resolveXHarnessToken(
  token: string,
  env: { X_HARNESS_URL?: string },
): Promise<XHarnessTokenResult | null> {
  if (!env.X_HARNESS_URL) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout — must not block login flow
    try {
      const res = await fetch(`${env.X_HARNESS_URL}/api/tokens/${token}/resolve`, {
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const body = await res.json() as { success: boolean; data?: XHarnessTokenResult };
      if (!body.success || !body.data) return null;
      return { xUsername: body.data.xUsername, tag: body.data.tag ?? null, scenarioId: body.data.scenarioId ?? null };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return null;
  }
}
