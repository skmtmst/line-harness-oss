import { parseOffsetPaging, buildOffsetListResponse } from '../lib/list-paging.js';
import { trackedLinkReferralMatchesAccount } from '../services/tracked-link-identity.js';
import { navigationProof } from '../lib/navigation-proof.js';
import { storedRedirectTarget } from '../lib/safe-redirect.js';
import { logger, tracedFetch as fetch } from '@line-crm/shared/server';
import { inputError } from '../lib/input-errors.js';
import { fail } from '../lib/fail.js';
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

    const { limit, offset } = parseOffsetPaging({ limit: c.req.query('limit'), offset: c.req.query('offset') }, { defaultLimit: 20, limitPolicy: { fallback: 'integer', minimum: 1, maximum: 50 }, offsetPolicy: { fallback: 'integer', minimum: 0 } });

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
      data: buildOffsetListResponse({ refCode,
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
        })), paging: { limit, offset }, sort: [{ field: 'orderedAt', direction: 'desc' }, { field: 'id', direction: 'desc' }] }),
    });
  } catch (err) {
    throw err;
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
    throw err;
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
    // 流入先の固定と報酬メッセージを本人以外が操作できないよう、lineUserId を信用する前に idToken を必須検証する。
    if (!idToken) {
      return c.json({ success: false, error: 'idToken required' }, 401);
    }

    // 本人を証明する ID トークンを検証する。
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
      return fail(c, 404, 'FRIEND_NOT_FOUND');
    }

    const friendAccountId = verifiedLineAccountId ?? friend.line_account_id ?? null;

    // 報酬 DM から再訪した友だちも、IG との結び付けを更新する。
    const igLinkOk = await linkIgIgsid(c, friend.id, ig || '');
    if (igLinkOk) await saveIgAccountMeta(db, friend.id, iga || '', igan || '');

    // 友だちの所属 LIFF を使い、再利用されるフォーム自身の URL でなく gate/xh の条件を引き継ぐ。秘密の xh: トークンと停止 ref は第三者の LIFF URL に載せず、下流で停止した帰属が復活しないようにする。
    const stoppedFormRef = await isStoppedEntryRouteRef(db, ref);
    const refLink = ref && !stoppedFormRef ? await getTrackedLinkById(db, ref) : null;
    const trackedLink = refLink && await trackedLinkReferralMatchesAccount(db, refLink, friendAccountId)
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
    if (friendAccountId) {
      const account = await getLineAccountById(db, friendAccountId);
      accountToken = account?.channel_access_token ?? null;
      if (account?.liff_id) {
        formLiffUrl = `https://liff.line.me/${account.liff_id}?${formQuery.toString()}`;
      }
    }
    const accessToken = resolveLineToken({
      accountToken,
      defaultToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
      accountId: friendAccountId,
      context: 'liff.form-send',
    });
    if (formLiffUrl.startsWith(`${new URL(c.req.url).origin}`)) {
      // 個別 LIFF ID がなければ環境の LIFF_URL を使う。
      const liffUrl = c.env.LIFF_URL || '';
      const liffIdMatch = liffUrl.match(/liff\.line\.me\/([0-9]+-[A-Za-z0-9]+)/);
      if (liffIdMatch) {
        formLiffUrl = `https://liff.line.me/${liffIdMatch[1]}?${formQuery.toString()}`;
      }
    }
    // 計測リンクから案内文と初回流入を解決し、既存の初回値は上書きしない。停止経路と同名のリンクへ代替して帰属を復活させない。
    let introTemplate = null;
    if (trackedLink) {
      try {
        const { setFriendFirstTrackedLinkIfNull } = await import('@line-crm/db');
        await setFriendFirstTrackedLinkIfNull(c.env.DB, friend.id, trackedLink.id);
      } catch {
        logger.error("liff.liff_send_form_link_post_failed");
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
          { lineAccountId: friendAccountId, friendId: friend.id, messageType: introTemplate.message_type },
        ),
      };
    }
    const introMessage = buildIntroMessage(introTemplate, formLiffUrl);

    const lineClient = new LineClient(accessToken);
    await lineClient.pushMessage(lineUserId, [introMessagePayload(introMessage)]);

    return c.json({ success: true });
  } catch (err) {
    throw err;
  }
};
