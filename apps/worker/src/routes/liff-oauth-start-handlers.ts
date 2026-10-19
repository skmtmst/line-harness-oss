import { setCookie } from 'hono/cookie';
import { navigationProof } from '../lib/navigation-proof.js';
import { getEntryRouteByRefCode, getLineAccountByChannelId, getTrafficPoolBySlug, getTrafficPoolById, getRandomPoolAccount, getPoolAccounts } from '@line-crm/db';
import { isStoppedEntryRouteRef, ENTRY_ROUTE_STOPPED_HTML } from '../services/entry-route-stop.js';
import type { Env } from '../worker-env.js';
import { stoppedLineAccountResponse, encodeState } from './liff-definition.js';
import type { Context } from 'hono';

export const get__auth_line_1 = async (c: Context<Env, "/auth/line">) => {
  const ref = c.req.query('ref') || '';
  // N-244差戻: 開始時にも停止判定する。停止前のページから停止後に押した
  // 場合を拒否する。不存在 ref は共有 namespace の正規フローのため通す。
  // DB 読取失敗は fail-closed (止める側) に倒す。
  if (await isStoppedEntryRouteRef(c.env.DB, ref)) {
    return c.html(ENTRY_ROUTE_STOPPED_HTML, 410);
  }
  const redirect = c.req.query('redirect') || '';
  const formId = c.req.query('form') || '';
  const gclid = c.req.query('gclid') || '';
  const fbclid = c.req.query('fbclid') || '';
  const twclid = c.req.query('twclid') || '';
  const ttclid = c.req.query('ttclid') || '';
  const utmSource = c.req.query('utm_source') || '';
  const utmMedium = c.req.query('utm_medium') || '';
  const utmCampaign = c.req.query('utm_campaign') || '';
  let accountParam = c.req.query('account') || '';
  const uidParam = c.req.query('uid') || ''; // existing user UUID for cross-account linking
  const igParam = c.req.query('ig') || ''; // IG Harness IGSID for cross-platform linking
  const igaParam = c.req.query('iga') || ''; // IG Harness business account id
  const iganParam = c.req.query('igan') || ''; // IG Harness business account @username
  let poolAccount = ''; // pool's channel_id — passed via state only, not accountParam
  const baseUrl = new URL(c.req.url).origin;

  const ua = c.req.header('user-agent') || '';

  // Multi-account: resolve LINE Login channel + LIFF
  // Priority:
  //   1. entry_route.pool_id (when ref resolves to a referral link)
  //   2. ?account= explicit single-account override
  //   3. ?pool= explicit override
  //   4. 'main' traffic pool fallback
  //   5. env default
  let channelId = c.env.LINE_LOGIN_CHANNEL_ID;
  let liffUrl = c.env.LIFF_URL;

  // 1. entry_route → pool_id. getTrafficPoolById skips the is_active check
  // that getTrafficPoolBySlug does for us, so we filter disabled pools here
  // to honor an operator pause.
  let resolvedPool: Awaited<ReturnType<typeof getTrafficPoolBySlug>> | null = null;
  if (ref) {
    const route = await getEntryRouteByRefCode(c.env.DB, ref);
    if (route?.pool_id) {
      const candidate = await getTrafficPoolById(c.env.DB, route.pool_id);
      if (candidate?.is_active) resolvedPool = candidate;
    }
  }

  if (!resolvedPool && accountParam) {
    // 2. ?account= explicit override
    const account = await getLineAccountByChannelId(c.env.DB, accountParam);
    const stopped = await stoppedLineAccountResponse(c, account?.id);
    if (stopped) return stopped;
    if (account?.login_channel_id) {
      channelId = account.login_channel_id;
    }
    if (account?.liff_id) {
      liffUrl = `https://liff.line.me/${account.liff_id}`;
    }
  } else {
    // 3 / 4: pool lookup (entry_route.pool_id wins over query)
    if (!resolvedPool) {
      const poolSlug = c.req.query('pool') || 'main';
      resolvedPool = await getTrafficPoolBySlug(c.env.DB, poolSlug);
    }
    if (resolvedPool) {
      const account = await getRandomPoolAccount(c.env.DB, resolvedPool.id);
      if (account) {
        if (account.login_channel_id) channelId = account.login_channel_id;
        if (account.liff_id) liffUrl = `https://liff.line.me/${account.liff_id}`;
        if (account.channel_id) poolAccount = account.channel_id;
      } else {
        const allAccounts = await getPoolAccounts(c.env.DB, resolvedPool.id);
        if (allAccounts.length === 0) {
          // No pool_accounts yet — fallback to active_account_id (migration period)
          if (resolvedPool.login_channel_id) channelId = resolvedPool.login_channel_id;
          if (resolvedPool.liff_id) liffUrl = `https://liff.line.me/${resolvedPool.liff_id}`;
          if (resolvedPool.channel_id) poolAccount = resolvedPool.channel_id;
        } else {
          // All pool_accounts disabled — fail closed, don't leak to default account
          return c.text('このリンクは現在利用できません。しばらくしてからお試しください。', 503);
        }
      }
    }
  }
  const callbackUrl = `${baseUrl}/auth/callback`;

  // xh: refs are X Harness one-time tokens — never forward to third-party URLs (liff.line.me / QR)
  // The token must reach /auth/callback, so it IS included in the OAuth state (handled by this worker).
  // It must NOT appear in LIFF URLs or QR codes that escape to external domains.
  const externalRef = ref.startsWith('xh:') ? '' : ref;

  // Build LIFF URL with ref + ad params (for mobile → LINE app)
  // Extract LIFF ID from URL and pass as query param so the app can init correctly
  const liffIdMatch = liffUrl.match(/liff\.line\.me\/([0-9]+-[A-Za-z0-9]+)/);
  const liffParams = new URLSearchParams();
  if (liffIdMatch) liffParams.set('liffId', liffIdMatch[1]);
  if (externalRef) liffParams.set('ref', externalRef);
  if (formId) liffParams.set('form', formId);
  const gateParam = c.req.query('gate') || '';
  if (gateParam) liffParams.set('gate', gateParam);
  const xhParam2 = c.req.query('xh') || '';
  if (xhParam2) liffParams.set('xh', xhParam2);
  if (igParam) liffParams.set('ig', igParam);
  if (igaParam) liffParams.set('iga', igaParam);
  if (iganParam) liffParams.set('igan', iganParam);
  if (redirect) liffParams.set('redirect', redirect);
  if (gclid) liffParams.set('gclid', gclid);
  if (fbclid) liffParams.set('fbclid', fbclid);
  if (twclid) liffParams.set('twclid', twclid);
  if (ttclid) liffParams.set('ttclid', ttclid);
  if (utmSource) liffParams.set('utm_source', utmSource);
  const liffTarget = liffParams.toString()
    ? `${liffUrl}?${liffParams.toString()}`
    : liffUrl;

  // Build OAuth URL (for desktop fallback)
  // Pack all tracking params into state so they survive the OAuth redirect.
  // The full ref (including xh: tokens) is stored in state — it is opaque to access.line.me
  // and only decoded by this worker's /auth/callback handler.
  // gate / xh: campaign metadata that must reach the form push so the form
  // can verify against the correct gate via the correct X Harness instance.
  // Without these, the form falls back to the gateId baked into the form's
  // onSubmitWebhookUrl (which is stale when a form is reused across campaigns).
  const state = JSON.stringify({ ref, redirect, redirectProof: c.req.query('redirectProof') || '', form: formId, gate: gateParam, xh: xhParam2, gclid, fbclid, twclid, ttclid, utmSource, utmMedium, utmCampaign, account: accountParam || poolAccount, uid: uidParam, ig: igParam, iga: igaParam, igan: iganParam });
  const oauthNonce = crypto.randomUUID();
  const payload = encodeState(JSON.stringify({ data: state, nonce: oauthNonce, expires: Date.now() + 10 * 60_000 }));
  const encodedState = `${payload}.${await navigationProof(c.env.LINE_CHANNEL_SECRET, 'liff-oauth', payload)}`;
  setCookie(c, 'lh_liff_oauth', oauthNonce, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/auth', maxAge: 600 });
  const loginUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  loginUrl.searchParams.set('response_type', 'code');
  loginUrl.searchParams.set('client_id', channelId);
  loginUrl.searchParams.set('redirect_uri', callbackUrl);
  loginUrl.searchParams.set('scope', 'profile openid email');
  loginUrl.searchParams.set('bot_prompt', 'aggressive');
  loginUrl.searchParams.set('state', encodedState);

  // Build LIFF URL with params (opens LINE app directly on mobile + QR on PC)
  // externalRef used — xh: tokens must not appear in QR codes or LIFF URLs
  // gate/xh: campaign metadata that the LIFF page must see so it can verify
  // against the correct gate (otherwise the form falls back to the stale gate
  // baked into the form's webhook URL when forms are reused across campaigns).
  const qrParams = new URLSearchParams();
  if (liffIdMatch) qrParams.set('liffId', liffIdMatch[1]);
  if (externalRef) qrParams.set('ref', externalRef);
  if (formId) qrParams.set('form', formId);
  if (gateParam) qrParams.set('gate', gateParam);
  if (xhParam2) qrParams.set('xh', xhParam2);
  if (uidParam) qrParams.set('uid', uidParam);
  if (accountParam) qrParams.set('account', accountParam);
  if (igParam) qrParams.set('ig', igParam);
  if (igaParam) qrParams.set('iga', igaParam);
  if (iganParam) qrParams.set('igan', iganParam);
  // Ad click IDs + UTM — without these the PC/QR path loses ad attribution
  // (same params /auth/line already reads for the OAuth state).
  if (gclid) qrParams.set('gclid', gclid);
  if (fbclid) qrParams.set('fbclid', fbclid);
  if (twclid) qrParams.set('twclid', twclid);
  if (ttclid) qrParams.set('ttclid', ttclid);
  if (utmSource) qrParams.set('utm_source', utmSource);
  if (utmMedium) qrParams.set('utm_medium', utmMedium);
  if (utmCampaign) qrParams.set('utm_campaign', utmCampaign);
  const qrUrl = qrParams.toString() ? `${liffUrl}?${qrParams.toString()}` : liffUrl;

  // Mobile: route through /r/:ref so users get the OS-aware landing page
  // (long-press hint on iOS, intent:// URL on Android) instead of being
  // dropped onto liff.line.me directly. Direct liff.line.me redirects
  // surface LINE Login web for UL-未学習 devices, which kills conversion.
  // Exceptions:
  //   - cross-account links (accountParam) → OAuth directly so the callback
  //     can push from the correct account
  //   - xh: refs (X Harness one-time tokens) → liff.line.me direct, since
  //     these tokens must NEVER appear in third-party URLs and the
  //     externalRef has already been zeroed for that case
  //   - empty ref → liff.line.me direct (no /r/:ref to route to)
  const isMobile = /iphone|ipad|android|mobile/.test(ua.toLowerCase());
  if (isMobile) {
    if (accountParam) {
      return c.redirect(loginUrl.toString());
    }
    if (externalRef) {
      // Forward all relevant query params (form, gate, xh, ig, pool, redirect, ad ids).
      // ref is already in the path; strip it from the query.
      const reqUrl = new URL(c.req.url);
      const passthrough = new URLSearchParams();
      for (const [key, value] of reqUrl.searchParams) {
        if (key !== 'ref') passthrough.set(key, value);
      }
      const qs = passthrough.toString();
      return c.redirect(`/r/${encodeURIComponent(externalRef)}${qs ? '?' + qs : ''}`);
    }
    return c.redirect(qrUrl);
  }

  // PC: show QR code page
  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
      <img src="/api/qr?size=240x240&data=${encodeURIComponent(qrUrl)}" alt="QR Code">
    </div>
    <p class="hint">LINE アプリのカメラまたは<br>スマートフォンのカメラで読み取れます</p>
    <p class="footer">友だち追加で全機能を無料体験できます</p>
  </div>
</body>
</html>`);
};

export const get__auth_oauth_2 = async (c: Context<Env, "/auth/oauth">) => {
  const ref = c.req.query('ref') || '';
  // N-244差戻: /auth/line と同じく開始時に停止判定する。停止前のページから
  // 停止後に押した場合を拒否する。不存在 ref は正規フローのため通す。
  if (await isStoppedEntryRouteRef(c.env.DB, ref)) {
    return c.html(ENTRY_ROUTE_STOPPED_HTML, 410);
  }
  const redirect = c.req.query('redirect') || '';
  const formId = c.req.query('form') || '';
  const gateParam = c.req.query('gate') || '';
  const xhParam = c.req.query('xh') || '';
  const gclid = c.req.query('gclid') || '';
  const fbclid = c.req.query('fbclid') || '';
  const twclid = c.req.query('twclid') || '';
  const ttclid = c.req.query('ttclid') || '';
  const utmSource = c.req.query('utm_source') || '';
  const utmMedium = c.req.query('utm_medium') || '';
  const utmCampaign = c.req.query('utm_campaign') || '';
  const accountParam = c.req.query('account') || '';
  const uidParam = c.req.query('uid') || '';
  const igParam = c.req.query('ig') || '';
  const igaParam = c.req.query('iga') || '';
  const iganParam = c.req.query('igan') || '';
  let poolAccount = '';
  const baseUrl = new URL(c.req.url).origin;

  // Pool / account resolution — same logic as /auth/line
  let channelId = c.env.LINE_LOGIN_CHANNEL_ID;
  if (accountParam) {
    const account = await getLineAccountByChannelId(c.env.DB, accountParam);
    const stopped = await stoppedLineAccountResponse(c, account?.id);
    if (stopped) return stopped;
    if (account?.login_channel_id) channelId = account.login_channel_id;
  } else {
    const poolSlug = c.req.query('pool') || 'main';
    const pool = await getTrafficPoolBySlug(c.env.DB, poolSlug);
    if (pool) {
      const account = await getRandomPoolAccount(c.env.DB, pool.id);
      if (account) {
        if (account.login_channel_id) channelId = account.login_channel_id;
        if (account.channel_id) poolAccount = account.channel_id;
      } else {
        const { getPoolAccounts } = await import('@line-crm/db');
        const allAccounts = await getPoolAccounts(c.env.DB, pool.id);
        if (allAccounts.length === 0) {
          if (pool.login_channel_id) channelId = pool.login_channel_id;
          if (pool.channel_id) poolAccount = pool.channel_id;
        } else {
          return c.text('このリンクは現在利用できません。しばらくしてからお試しください。', 503);
        }
      }
    }
  }

  // Build OAuth URL with full state
  const callbackUrl = `${baseUrl}/auth/callback`;
  const state = JSON.stringify({
    ref, redirect, redirectProof: c.req.query('redirectProof') || '', form: formId, gate: gateParam, xh: xhParam,
    gclid, fbclid, twclid, ttclid,
    utmSource, utmMedium, utmCampaign,
    account: accountParam || poolAccount, uid: uidParam, ig: igParam,
    iga: igaParam, igan: iganParam,
  });
  const oauthNonce = crypto.randomUUID();
  const payload = encodeState(JSON.stringify({ data: state, nonce: oauthNonce, expires: Date.now() + 10 * 60_000 }));
  const encodedState = `${payload}.${await navigationProof(c.env.LINE_CHANNEL_SECRET, 'liff-oauth', payload)}`;
  setCookie(c, 'lh_liff_oauth', oauthNonce, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/auth', maxAge: 600 });
  const loginUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  loginUrl.searchParams.set('response_type', 'code');
  loginUrl.searchParams.set('client_id', channelId);
  loginUrl.searchParams.set('redirect_uri', callbackUrl);
  loginUrl.searchParams.set('scope', 'profile openid email');
  loginUrl.searchParams.set('bot_prompt', 'aggressive');
  loginUrl.searchParams.set('state', encodedState);

  return c.redirect(loginUrl.toString());
};
