import { trackedLinkReferralMatchesAccount } from '../services/tracked-link-identity.js';
import { navigationProof } from '../lib/navigation-proof.js';
import { storedRedirectTarget } from '../lib/safe-redirect.js';
import { logger, tracedFetch as fetch } from '@line-crm/shared/server';
import { inputError } from '../lib/input-errors.js';

import { getFriendByLineUserIdForAccount, getLineAccountById, getLineAccounts, getTrackedLinkById, getMessageTemplateById } from '@line-crm/db';
import { isStoppedEntryRouteRef } from '../services/entry-route-stop.js';
import { buildIntroMessage } from '../services/intro-message.js';
import { introMessagePayload } from '../lib/intro-message-payload.js';
import type { Env } from '../worker-env.js';
import { resolveLineToken } from '../services/line-token.js';

import { analyticsAccountScope, stoppedLineAccountResponse, linkIgIgsid, saveIgAccountMeta } from './liff-definition.js';
import type { Context } from 'hono';

export const get__api_analytics_ref_refCode_orders_1 = async (c: Context<Env, "/api/analytics/ref/:refCode/orders">) => {
  try {
    const db = c.env.DB;
    const refCode = c.req.param('refCode');
    const lineAccountId = c.req.query('lineAccountId');
    const accountScope = await analyticsAccountScope(c, lineAccountId);
    if (!accountScope) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }

    const limitRaw = Number(c.req.query('limit') ?? '20');
    const offsetRaw = Number(c.req.query('offset') ?? '0');
    const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;
    const offset = Number.isInteger(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    const where = `f.ref_code = ? ${accountScope.where}`;
    const binds = [refCode, ...accountScope.binds];

    const [items, countRes, summaryRes] = await Promise.all([
      db
        .prepare(
          `SELECT o.id, o.order_number, o.normalized_status, o.provider_status,
                  o.currency, o.total_amount_minor, o.refunded_amount_minor,
                  o.ordered_at, o.detail_url,
                  f.id AS friend_id, f.display_name AS friend_name
             FROM ec_orders o
             JOIN friends f ON f.id = o.friend_id
            WHERE ${where}
            ORDER BY o.ordered_at DESC, o.id DESC
            LIMIT ? OFFSET ?`,
        )
        .bind(...binds, limit, offset)
        .all<{
          id: string;
          order_number: string;
          normalized_status: string;
          provider_status: string;
          currency: string;
          total_amount_minor: number | null;
          refunded_amount_minor: number | null;
          ordered_at: string;
          detail_url: string | null;
          friend_id: string;
          friend_name: string | null;
        }>(),
      db
        .prepare(
          `SELECT COUNT(*) AS count
             FROM ec_orders o JOIN friends f ON f.id = o.friend_id
            WHERE ${where}`,
        )
        .bind(...binds)
        .first<{ count: number }>(),
      db
        .prepare(
          `SELECT
             SUM(CASE WHEN o.normalized_status = 'refunded' THEN 1 ELSE 0 END) AS refunded,
             SUM(CASE WHEN o.normalized_status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
             SUM(o.total_amount_minor) AS total_amount,
             SUM(o.refunded_amount_minor) AS refunded_amount
           FROM ec_orders o JOIN friends f ON f.id = o.friend_id
          WHERE ${where}`,
        )
        .bind(...binds)
        .first<{
          refunded: number | null;
          cancelled: number | null;
          total_amount: number | null;
          refunded_amount: number | null;
        }>(),
    ]);

    return c.json({
      success: true,
      data: {
        refCode,
        total: countRes?.count ?? 0,
        // 金額は取れていない注文があると合計が欠ける。0 ではなく null で
        // 「額は未計測」を表す（画面側は「—」を出す）。
        summary: {
          refunded: summaryRes?.refunded ?? 0,
          cancelled: summaryRes?.cancelled ?? 0,
          totalAmount: summaryRes?.total_amount ?? null,
          refundedAmount: summaryRes?.refunded_amount ?? null,
        },
        items: (items.results ?? []).map((row) => ({
          id: row.id,
          orderNumber: row.order_number,
          status: row.normalized_status,
          providerStatus: row.provider_status,
          currency: row.currency,
          totalAmount: row.total_amount_minor,
          refundedAmount: row.refunded_amount_minor,
          orderedAt: row.ordered_at,
          detailUrl: row.detail_url,
          friend: { id: row.friend_id, displayName: row.friend_name },
        })),
      },
    });
  } catch (err) {
    logger.error("routes_liff_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};

export const post__api_links_wrap_2 = async (c: Context<Env, "/api/links/wrap">) => {
  try {
    const body = await c.req.json<{ url: string; ref?: string }>();
    if (!body.url) {
      return inputError(c, { success: false, error: 'url is required' }, 400, ["url"]);
    }

    const liffUrl = c.env.LIFF_URL;
    if (!liffUrl) {
      return c.json({ success: false, error: 'LIFF_URL not configured' }, 500);
    }

    const destination = storedRedirectTarget(body.url);
    if (!destination) return inputError(c, { success: false, error: 'url is required' }, 400, ['url']);
    const liffId = new URL(liffUrl).pathname.split('/').filter(Boolean)[0] || '';
    const proof = await navigationProof(c.env.LINE_CHANNEL_SECRET, `redirect:${liffId}`, destination);
    const params = new URLSearchParams({ redirect: destination, redirectProof: proof });
    if (body.ref) {
      params.set('ref', body.ref);
    }

    const wrappedUrl = `${liffUrl}?${params.toString()}`;
    return c.json({ success: true, data: { url: wrappedUrl } });
  } catch (err) {
    logger.error("routes_liff_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};

export const post__api_liff_send_form_link_3 = async (c: Context<Env, "/api/liff/send-form-link">) => {
  try {
    const { lineUserId, formId, idToken, ref, gate, xh, ig, iga, igan } = await c.req.json<{
      lineUserId: string;
      formId: string;
      idToken?: string;
      ref?: string;
      gate?: string;
      xh?: string;
      ig?: string;
      iga?: string;
      igan?: string;
    }>();
    if (!lineUserId || !formId) {
      return inputError(c, { success: false, error: 'lineUserId and formId required' }, 400, ["lineUserId","formId"]);
    }
    // idToken is required: this endpoint pins friend.first_tracked_link_id and
    // pushes a campaign-specific message, so we must verify the caller IS the
    // claimed LINE user before trusting lineUserId. Without this, an attacker
    // who knows another user's lineUserId could lock that user into an
    // attacker-chosen tracked_link_id (and thus an attacker-chosen reward).
    if (!idToken) {
      return c.json({ success: false, error: 'idToken required' }, 401);
    }

    // Verify idToken — ensures caller is the actual user
    let verifiedLineAccountId: string | null = null;
    {
      const loginChannelIds = [c.env.LINE_LOGIN_CHANNEL_ID];
      const dbAccounts = await getLineAccounts(c.env.DB);
      for (const acct of dbAccounts) {
        if (acct.login_channel_id) loginChannelIds.push(acct.login_channel_id);
      }
      let verified = false;
      for (const channelId of loginChannelIds) {
        const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
        });
        if (verifyRes.ok) {
          const data = await verifyRes.json() as { sub: string };
          if (data.sub !== lineUserId) {
            return c.json({ success: false, error: 'Token mismatch' }, 403);
          }
          verified = true;
          verifiedLineAccountId = dbAccounts.find(
            (account) => account.login_channel_id === channelId,
          )?.id ?? null;
          break;
        }
      }
      if (!verified) {
        return c.json({ success: false, error: 'Invalid idToken' }, 401);
      }
    }

    const stopped = await stoppedLineAccountResponse(c, verifiedLineAccountId);
    if (stopped) return stopped;

    const db = c.env.DB;
    const friend = await getFriendByLineUserIdForAccount(
      db,
      lineUserId,
      verifiedLineAccountId,
    );
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    // IG cross-link for LIFF flows that hit this endpoint (existing friends
    // tapping a reward DM URL).
    const igLinkOk = await linkIgIgsid(c, friend.id, ig || '');
    if (igLinkOk) await saveIgAccountMeta(db, friend.id, iga || '', igan || '');

    // Build form LIFF URL using the friend's account liff_id (multi-account aware)
    // Append gate/xh so the form can verify against the correct campaign gate
    // (form definitions can be reused across campaigns, so the form's webhook
    // URL is unreliable as a source of gate id).
    // xh: refs are X Harness one-time secret tokens — never put them on
    // liff.line.me URLs (third-party host).
    // N-244差戻: 停止 ref は再送しない (下流の form 受付で帰属が復活するのを
    // 止める)。tracked 解決も後段で止める。不存在 ref は従来どおり載せる。
    const stoppedFormRef = await isStoppedEntryRouteRef(db, ref);
    const refLink = ref && !stoppedFormRef ? await getTrackedLinkById(db, ref) : null;
    const trackedLink = refLink && await trackedLinkReferralMatchesAccount(db, refLink, friend.line_account_id ?? null)
      ? refLink : null;
    const externalRefForForm = ref && !ref.startsWith('xh:') && !stoppedFormRef
      && (!refLink || trackedLink) ? ref : '';
    const formQuery = new URLSearchParams();
    formQuery.set('page', 'form');
    formQuery.set('id', formId);
    if (externalRefForForm) formQuery.set('ref', externalRefForForm);
    if (gate) formQuery.set('gate', gate);
    if (xh) formQuery.set('xh', xh);
    let formLiffUrl = `${new URL(c.req.url).origin}?${formQuery.toString()}`;
    const { LineClient } = await import('@line-crm/line-sdk');
    let accountToken: string | null = null;
    if (friend.line_account_id) {
      const account = await getLineAccountById(db, friend.line_account_id);
      accountToken = account?.channel_access_token ?? null;
      if (account?.liff_id) {
        formLiffUrl = `https://liff.line.me/${account.liff_id}?${formQuery.toString()}`;
      }
    }
    const accessToken = resolveLineToken({
      accountToken,
      defaultToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
      accountId: friend.line_account_id ?? null,
      context: 'liff.form-send',
    });
    if (formLiffUrl.startsWith(`${new URL(c.req.url).origin}`)) {
      // Fallback: use env LIFF_URL if no account-specific liff_id
      const liffUrl = c.env.LIFF_URL || '';
      const liffIdMatch = liffUrl.match(/liff\.line\.me\/([0-9]+-[A-Za-z0-9]+)/);
      if (liffIdMatch) {
        formLiffUrl = `https://liff.line.me/${liffIdMatch[1]}?${formQuery.toString()}`;
      }
    }
    // Resolve intro template via tracked link (if ref provided).
    // Also pin the friend's first_tracked_link_id (idempotent — never overwrites).
    // N-244差戻: 停止 entry route と同名の tracked link があっても fallback
    // しない (帰属の復活を止める)。不存在 ref は従来どおり解決する。
    let introTemplate = null;
    if (trackedLink) {
      try {
        const { setFriendFirstTrackedLinkIfNull } = await import('@line-crm/db');
        await setFriendFirstTrackedLinkIfNull(c.env.DB, friend.id, trackedLink.id);
      } catch {
        logger.error("routes_liff_failed");
      }
      if (trackedLink.intro_template_id) {
        introTemplate = await getMessageTemplateById(c.env.DB, trackedLink.intro_template_id);
      }
    }
    // intro テンプレートの {{var.*}} は送信時点の値へ置き換える。
    // 消えた共通情報があれば fail-closed で止める。
    if (introTemplate) {
      const { expandSendCommonVars } = await import('../services/interpolation-context.js');
      introTemplate = {
        ...introTemplate,
        message_content: await expandSendCommonVars(
          c.env.DB, introTemplate.message_content,
          { kind: 'liff', id: introTemplate.id },
          { lineAccountId: friend.line_account_id ?? null, friendId: friend.id, messageType: introTemplate.message_type },
        ),
      };
    }
    const introMessage = buildIntroMessage(introTemplate, formLiffUrl);

    const lineClient = new LineClient(accessToken);
    await lineClient.pushMessage(lineUserId, [introMessagePayload(introMessage)]);

    return c.json({ success: true });
  } catch (err) {
    logger.error("routes_liff_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};
