import { getCookie } from 'hono/cookie';
import { bumpAuthThrottle } from '@line-crm/db';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { logger, tracedFetch as fetch } from '@line-crm/shared/server';
import { patchFriendMetadata } from '../features/friends/friend-metadata/index.js';
import { inputError } from '../lib/input-errors.js';
import { redeemCoupon } from '../services/coupon-redemption.js';

import { getFriendByLineUserIdForAccount, createUser, getUserByEmailForAccess, linkFriendToUser, getEntryRouteByRefCode, recordRefTracking, recordFriendAddAttributionCandidate, getLineAccounts } from '@line-crm/db';
import { isStoppedEntryRouteRef, recordStopSuppressionSafe } from '../services/entry-route-stop.js';
import { verifyCallerLineIdentity } from '../services/liff-auth.js';
import type { Env } from '../worker-env.js';

import { verifyCrossAccountToken } from '../lib/cross-account-token.js';
import { stoppedLineAccountResponse, linkIgIgsid, saveIgAccountMeta, saveFriendAddCandidate, applyRefAttribution, resolveXHarnessToken, applyXHarnessActions, analyticsAccountScope } from './liff-definition.js';
import type { Context } from 'hono';

export const post__api_liff_entry_route_coupon_use_1 = async (c: Context<Env, "/api/liff/entry-route-coupon/use">) => {
  try {
    const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env);
    if (!identity) return c.json({ success: false, error: 'Invalid ID token' }, 401);
    const stopped = await stoppedLineAccountResponse(c, identity.lineAccountId);
    if (stopped) return stopped;
    const body = await c.req.json<{ receiptId?: unknown; requestId?: unknown }>();
    if (typeof body.receiptId !== 'string' || body.receiptId.length > 64
      || typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.requestId)) {
      return c.json({ success: false, error: '受け取りまたは操作の番号が正しくありません' }, 400);
    }
    const friend = await getFriendByLineUserIdForAccount(c.env.DB, identity.lineUserId, identity.lineAccountId);
    if (!friend || friend.is_following !== 1 || !identity.lineAccountId) return c.json({ success: false, error: 'Not found' }, 404);
    const receipt = await c.env.DB.prepare('SELECT asset_id FROM entry_route_coupon_receipts WHERE id = ? AND friend_id = ? AND line_account_id = ?')
      .bind(body.receiptId, friend.id, identity.lineAccountId).first<{ asset_id: string }>();
    if (!receipt) return c.json({ success: false, error: 'Not found' }, 404);
    const result = await redeemCoupon(c.env.DB, friend, identity.lineAccountId, receipt.asset_id,
      `liff-entry-coupon:${friend.id}:${body.requestId}`, new Date(), body.receiptId);
    if (!result.ok) return c.json({ success: false, error: result.message }, 409);
    return c.json({ success: true, data: { message: result.message, replayed: result.replayed ?? false } });
  } catch (error) {
    logger.error("routes_liff_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};

export const post__api_liff_friend_add_intent_2 = async (c: Context<Env, "/api/liff/friend-add-intent">) => {
  try {
    const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env);
    if (!identity) return c.json({ success: false, error: 'Invalid ID token' }, 401);
    const stopped = await stoppedLineAccountResponse(c, identity.lineAccountId);
    if (stopped) return stopped;
    if (!identity.lineAccountId) {
      return c.json({ success: false, error: 'LINEアカウントを特定できません' }, 409);
    }

    const body = await c.req.json<{
      ref?: string;
      source?: 'line_login' | 'liff' | 'short_link';
    }>();
    const refCode = body.ref?.trim() ?? '';
    if (!refCode || refCode.length > 256 || refCode.startsWith('xh:')) {
      return inputError(c, { success: false, error: 'ref が正しくありません' }, 400, ["ref"]);
    }
    const source = body.source ?? 'liff';
    if (!['line_login', 'liff', 'short_link'].includes(source)) {
      return inputError(c, { success: false, error: 'source が正しくありません' }, 400, ["source"]);
    }

    const friend = await getFriendByLineUserIdForAccount(
      c.env.DB,
      identity.lineUserId,
      identity.lineAccountId,
    );
    // N-244: 停止した流入経路への直送は候補を残さない。内部状態を漏らさない
    // 汎用文で 410 にする。不存在 ref は共有 namespace の正規フローのため
    // 従来どおり 200 で記録する。
    // N-244差戻(台帳): 停止試行は抑止台帳へ引き継ぐ。友だち行が無い新規利用者
    // でも記録し、後の別followが自然流入扱いにならないようにする。応答は変えない。
    const stoppedIntentRef = await isStoppedEntryRouteRef(c.env.DB, refCode);
    if (stoppedIntentRef) {
      await recordStopSuppressionSafe(c.env.DB, {
        lineAccountId: identity.lineAccountId,
        lineUserId: identity.lineUserId,
        friendId: friend?.id ?? null,
        refCode,
        source,
      });
    }
    if (!friend || friend.line_account_id !== identity.lineAccountId) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }
    if (stoppedIntentRef) {
      return c.json({ success: false, error: 'このリンクは現在利用できません' }, 410);
    }
    const route = await getEntryRouteByRefCode(c.env.DB, refCode);
    const candidate = await recordFriendAddAttributionCandidate(c.env.DB, {
      lineAccountId: identity.lineAccountId,
      friendId: friend.id,
      refCode,
      entryRouteId: route?.id ?? null,
      source,
    });
    return c.json({
      success: true,
      data: {
        status: candidate.status,
        refCode: candidate.refCode,
        entryRouteId: candidate.entryRouteId,
        expiresAt: candidate.expiresAt,
      },
    });
  } catch (err) {
    logger.error("routes_liff_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};

export const post__api_liff_link_3 = async (c: Context<Env, "/api/liff/link">) => {
  try {
    const body = await c.req.json<{
      idToken: string;
      displayName?: string | null;
      ref?: string;
      existingUuid?: string;
      crossAccountToken?: string;
      confirmCrossAccountLink?: boolean;
      ig?: string;
      iga?: string;
      igan?: string;
    }>();

    if (!body.idToken) {
      return inputError(c, { success: false, error: 'idToken is required' }, 400, ["idToken"]);
    }

    // Try verifying with default Login channel, then DB accounts
    const loginChannelIds = [c.env.LINE_LOGIN_CHANNEL_ID];
    const dbAccounts = await getLineAccounts(c.env.DB);
    for (const acct of dbAccounts) {
      if (acct.login_channel_id && !loginChannelIds.includes(acct.login_channel_id)) {
        loginChannelIds.push(acct.login_channel_id);
      }
    }

    let verifyRes: Response | null = null;
    let matchedLoginChannelId: string | null = null;
    for (const channelId of loginChannelIds) {
      verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: body.idToken, client_id: channelId }),
      });
      if (verifyRes.ok) {
        matchedLoginChannelId = channelId;
        break;
      }
    }

    if (!verifyRes?.ok) {
      return c.json({ success: false, error: 'Invalid ID token' }, 401);
    }

    const verified = await verifyRes.json<{ sub: string; email?: string; name?: string }>();
    const lineUserId = verified.sub;
    const email = verified.email || null;

    const db = c.env.DB;
    // id_token を検証できたログインチャネル = ユーザーが開いている LIFF のアカウント。
    // friend 行とプッシュ先をそのアカウントに揃える (同一プロバイダーの兄弟アカウント
    // では line_user_id が同一で、無指定の先頭一致だと別アカウントに吸われるため)。
    const matchedAccount = matchedLoginChannelId
      ? dbAccounts.find((a) => a.login_channel_id === matchedLoginChannelId) ?? null
      : null;
    const stopped = await stoppedLineAccountResponse(c, matchedAccount?.id);
    if (stopped) return stopped;
    const friend = await getFriendByLineUserIdForAccount(
      db, lineUserId, matchedAccount?.id ?? null,
    );
    // N-244差戻(再審査): 本番LIFFはfriend作成前にlinkのみ呼ぶ。404で返す前に
    // 停止判定・抑止記録を済ませ、後のfollowが自然流入扱いにならないようにする。
    // 応答は変えない (行なしは従来どおり 404)。
    if (body.ref) {
      const stoppedPreLinkRef = await isStoppedEntryRouteRef(db, body.ref);
      if (stoppedPreLinkRef) {
        await recordStopSuppressionSafe(db, {
          lineAccountId: matchedAccount?.id ?? null,
          lineUserId,
          friendId: friend?.id ?? null,
          refCode: body.ref,
          source: 'liff',
        });
      }
    }
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    let linkedUserId = (friend as unknown as Record<string, unknown>).user_id as string | null;
    if (body.crossAccountToken) {
      const crossAccount = await verifyCrossAccountToken(
        c.env.LINE_CHANNEL_SECRET,
        body.crossAccountToken,
      );
      if (!crossAccount || !matchedAccount || crossAccount.targetAccountId !== matchedAccount.id
        || !crossAccount.browserNonce || getCookie(c, '__Host-lh_cross_account') !== crossAccount.browserNonce
        || body.confirmCrossAccountLink !== true || (linkedUserId && linkedUserId !== crossAccount.userId)) {
        return inputError(c, { success: false, error: 'Invalid cross-account token' }, 400, ["crossAccountToken"]);
      }
      const targetUser = await db
        .prepare('SELECT id FROM users WHERE id = ?')
        .bind(crossAccount.userId)
        .first<{ id: string }>();
      if (!targetUser) {
        return inputError(c, { success: false, error: 'Cross-account user not found' }, 400, ["crossAccountToken"]);
      }
      const consumed = await bumpAuthThrottle(db, `cross-account-used:${await tokenDigest(body.crossAccountToken)}`, 15 * 60_000);
      if (consumed !== 1 || !await linkFriendToUser(db, friend.id, crossAccount.userId)) return inputError(c, { success: false, error: 'Invalid cross-account token' }, 400, ['crossAccountToken']);
      linkedUserId = crossAccount.userId;
    }

    // IG cross-link: runs regardless of already-linked vs new-link branch so
    // existing friends still get ig_igsid wired when they hit this endpoint
    // from a reward DM.
    const igLinkOk = await linkIgIgsid(c, friend.id, body.ig || '');
    if (igLinkOk) await saveIgAccountMeta(db, friend.id, body.iga || '', body.igan || '');

    if (linkedUserId) {
      // N-244: 停止した流入経路への LIFF 直送は、連携済みでも raw ref 保存・
      // 候補・tracking・帰属をすべて止める。apply 側も二重に止める。不存在
      // ref は共有 namespace の正規フローのため従来どおり進める。
      const stoppedLinkRef = await isStoppedEntryRouteRef(db, body.ref);
      if (!stoppedLinkRef) {
        await saveFriendAddCandidate(db, {
          lineAccountId: matchedAccount?.id ?? null,
          friendId: friend.id,
          refCode: body.ref,
          source: 'liff',
        });
      } else {
        // N-244差戻(台帳): 停止試行を抑止台帳へ引き継ぐ。連携自体は通す。
        await recordStopSuppressionSafe(db, {
          lineAccountId: matchedAccount?.id ?? null,
          lineUserId,
          friendId: friend.id,
          refCode: body.ref,
          source: 'liff',
        });
      }
      // Still save ref even if already linked (but never persist xh: tokens as ref_code)
      if (body.ref && !body.ref.startsWith('xh:') && !stoppedLinkRef) {
        await db.prepare('UPDATE friends SET ref_code = ? WHERE id = ? AND ref_code IS NULL')
          .bind(body.ref, friend.id).run();
      }
      // Apply ref attribution (tag + scenario push) for already-linked friends.
      // /auth/callback only fires for new OAuth flows, so existing friends
      // would otherwise miss tracked-link campaigns triggered by /api/liff/link.
      // Mirror the new-link branch's recordRefTracking call so analytics
      // (/api/analytics/ref-summary) include LIFF hits from existing friends.
      if (body.ref && !body.ref.startsWith('xh:') && !stoppedLinkRef) {
        try {
          const route = await getEntryRouteByRefCode(db, body.ref);
          await recordRefTracking(db, {
            refCode: body.ref,
            friendId: friend.id,
            entryRouteId: route?.id ?? null,
            sourceUrl: null,
          });
        } catch { /* silent */ }
      }
      if (body.ref && !stoppedLinkRef) {
        await applyRefAttribution(c, body.ref, friend, lineUserId, {
          accountChannelId: matchedAccount?.channel_id ?? null,
        });
      }
      // X Harness token resolution for already-linked friends
      if (body.ref && body.ref.startsWith('xh:')) {
        try {
          const xhToken = body.ref.slice(3);
          const xhResult = await resolveXHarnessToken(xhToken, c.env);
          if (xhResult?.xUsername) {
            await patchFriendMetadata(db, friend.id, { x_username: xhResult.xUsername });
            logger.log("routes_liff_log");
          }
          if (xhResult) {
            await applyXHarnessActions(db, friend.id, xhResult);
          }
        } catch (err) {
          logger.error("routes_liff_failed");
        }
      }
      return c.json({
        success: true,
        data: { userId: linkedUserId, alreadyLinked: true },
      });
    }

    const identityTenant = matchedAccount?.tenant_id ?? DEFAULT_TENANT_ID;
    const identityAccounts = dbAccounts.filter(a => (a.tenant_id ?? DEFAULT_TENANT_ID) === identityTenant).map(a => a.id);
    let userId: string | null = null;
    if (email) {
      const existingUser = await getUserByEmailForAccess(db, email, { tenantId: identityTenant, allowedAccountIds: identityAccounts, includeUnlinked: true });
      if (existingUser) userId = existingUser.id;
    }

    if (!userId) {
      const newUser = await createUser(db, {
        email,
        tenantId: identityTenant,
        displayName: body.displayName || verified.name,
      });
      userId = newUser.id;
    }

    await linkFriendToUser(db, friend.id, userId);

    // N-244: 新規連携でも停止 ref の保存・計測・帰属は止める。
    const stoppedNewLinkRef = await isStoppedEntryRouteRef(db, body.ref);
    if (!stoppedNewLinkRef) {
      await saveFriendAddCandidate(db, {
        lineAccountId: matchedAccount?.id ?? null,
        friendId: friend.id,
        refCode: body.ref,
        source: 'liff',
      });
    } else {
      // N-244差戻(台帳): 停止試行を抑止台帳へ引き継ぐ。連携自体は通す。
      await recordStopSuppressionSafe(db, {
        lineAccountId: matchedAccount?.id ?? null,
        lineUserId,
        friendId: friend.id,
        refCode: body.ref,
        source: 'liff',
      });
    }

    // Save ref_code from LIFF (first touch wins)
    // xh: refs are X Harness one-time tokens — never persist as ref_code
    if (body.ref && !body.ref.startsWith('xh:') && !stoppedNewLinkRef) {
      await db.prepare('UPDATE friends SET ref_code = ? WHERE id = ? AND ref_code IS NULL')
        .bind(body.ref, friend.id).run();

      // Record ref tracking
      try {
        const route = await getEntryRouteByRefCode(db, body.ref);
        await recordRefTracking(db, {
          refCode: body.ref,
          friendId: friend.id,
          entryRouteId: route?.id ?? null,
          sourceUrl: null,
        });
      } catch { /* silent */ }

      // Apply ref attribution (tag + scenario push) for newly-linked friends
      await applyRefAttribution(c, body.ref, friend, lineUserId, {
        accountChannelId: matchedAccount?.channel_id ?? null,
      });
    }

    // X Harness token resolution: ref starting with "xh:" links X account to LINE friend
    if (body.ref && body.ref.startsWith('xh:')) {
      try {
        const xhToken = body.ref.slice(3);
        const xhResult = await resolveXHarnessToken(xhToken, c.env);
        if (xhResult?.xUsername) {
          await patchFriendMetadata(db, friend.id, { x_username: xhResult.xUsername });
          logger.log("routes_liff_log");
        }
        if (xhResult) {
          await applyXHarnessActions(db, friend.id, xhResult);
        }
      } catch (err) {
        logger.error("routes_liff_failed");
      }
    }

    return c.json({
      success: true,
      data: { userId, alreadyLinked: false },
    });
  } catch (err) {
    logger.error("routes_liff_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};

export const get__api_analytics_ref_summary_4 = async (c: Context<Env, "/api/analytics/ref-summary">) => {
  try {
    const db = c.env.DB;
    const lineAccountId = c.req.query('lineAccountId');
    const accountScope = await analyticsAccountScope(c, lineAccountId);
    if (!accountScope) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }

    // friends 起点で集計することで、entry_routes に登録されていない ref
    // (例えば X Harness が発行する UUID ref) も summary に拾えるようにする。
    // 名前は entry_routes と LEFT JOIN して引く (未登録なら NULL → クライアン
    // ト側で「(未登録)」と表示)。
    //
    // IDEA-18: 購入・返金も同じ経路へ連結する。注文は「その経路で最初に来た
    // 友だち(first-touch)」が起こした ec_orders だけを数える。友だちの絞り込み
    // と同じ条件(相関副問合せの f2 に同じアカウント範囲)で数えるので、経路別の
    // 購入件数と /api/analytics/ref/:refCode/orders の明細は同じ母集団になる。
    // 同じ注文は ec_orders の (line_account_id, source_key, external_order_id)
    // 一意制約で取り込み時に1行へ潰れているため、ここでは行数をそのまま数える。
    const friendScope = accountScope.for('f2');
    const rows = await db
      .prepare(
        `SELECT
          f.ref_code,
          er.name as name,
          COUNT(DISTINCT f.id) as friend_count,
          COUNT(DISTINCT rt.id) as click_count,
          MAX(f.created_at) as latest_at,
          (SELECT COUNT(*) FROM ec_orders o
             JOIN friends f2 ON f2.id = o.friend_id
            WHERE f2.ref_code = f.ref_code ${friendScope.where}) as order_count,
          (SELECT COUNT(*) FROM ec_orders o
             JOIN friends f2 ON f2.id = o.friend_id
            WHERE f2.ref_code = f.ref_code AND o.normalized_status = 'refunded'
              ${friendScope.where}) as refunded_order_count,
          (SELECT COUNT(*) FROM ec_orders o
             JOIN friends f2 ON f2.id = o.friend_id
            WHERE f2.ref_code = f.ref_code AND o.normalized_status = 'cancelled'
              ${friendScope.where}) as cancelled_order_count
        FROM friends f
        LEFT JOIN entry_routes er ON er.ref_code = f.ref_code
        LEFT JOIN ref_tracking rt ON rt.ref_code = f.ref_code AND rt.friend_id = f.id
        WHERE f.ref_code IS NOT NULL AND f.ref_code != ''
          ${accountScope.where}
        GROUP BY f.ref_code, er.name
        ORDER BY friend_count DESC`,
      )
      .bind(
        ...friendScope.binds,
        ...friendScope.binds,
        ...friendScope.binds,
        ...accountScope.binds,
      )
      .all<{
        ref_code: string;
        name: string;
        friend_count: number;
        click_count: number;
        latest_at: string | null;
        order_count: number;
        refunded_order_count: number;
        cancelled_order_count: number;
      }>();

    const totalStmt = db
      .prepare(`SELECT COUNT(*) as count FROM friends f WHERE 1 = 1 ${accountScope.where}`)
      .bind(...accountScope.binds);
    const totalFriendsRes = await totalStmt.first<{ count: number }>();

    const refStmt = db
      .prepare(`SELECT COUNT(*) as count FROM friends f WHERE ref_code IS NOT NULL AND ref_code != '' ${accountScope.where}`)
      .bind(...accountScope.binds);
    const friendsWithRefRes = await refStmt.first<{ count: number }>();

    /*
      IDEA-18: 未計測を「0件」と混ぜないための注文の内訳。
      - attributed: 友だちに結びつき、その友だちに流入経路(ref)がある注文
      - noRoute:    友だちには結びついたが流入経路が分からない注文
      - unlinked:   LINEの友だちに結びついていない注文(会員のつき合わせ対象)
      注文の範囲は注文自身の所属アカウント(o.line_account_id)で絞る。
    */
    const orderScope = accountScope.for('o');
    const ordersRes = await db
      .prepare(
        `SELECT COUNT(*) AS orders_total,
           SUM(CASE WHEN o.friend_id IS NOT NULL THEN 1 ELSE 0 END) AS orders_linked,
           SUM(CASE WHEN f3.ref_code IS NOT NULL AND f3.ref_code != '' THEN 1 ELSE 0 END) AS orders_attributed,
           SUM(CASE WHEN o.normalized_status = 'refunded' THEN 1 ELSE 0 END) AS orders_refunded,
           SUM(CASE WHEN o.normalized_status = 'cancelled' THEN 1 ELSE 0 END) AS orders_cancelled
         FROM ec_orders o
         LEFT JOIN friends f3 ON f3.id = o.friend_id
         WHERE 1 = 1 ${orderScope.where}`,
      )
      .bind(...orderScope.binds)
      .first<{
        orders_total: number;
        orders_linked: number | null;
        orders_attributed: number | null;
        orders_refunded: number | null;
        orders_cancelled: number | null;
      }>();

    const totalFriends = totalFriendsRes?.count ?? 0;
    const friendsWithRef = friendsWithRefRes?.count ?? 0;

    return c.json({
      success: true,
      data: {
        routes: (rows.results ?? []).map((r) => ({
          refCode: r.ref_code,
          name: r.name,
          friendCount: r.friend_count,
          clickCount: r.click_count,
          latestAt: r.latest_at,
          orderCount: r.order_count,
          refundedOrderCount: r.refunded_order_count,
          cancelledOrderCount: r.cancelled_order_count,
        })),
        totalFriends,
        friendsWithRef,
        friendsWithoutRef: totalFriends - friendsWithRef,
        orders: {
          total: ordersRes?.orders_total ?? 0,
          linked: ordersRes?.orders_linked ?? 0,
          attributed: ordersRes?.orders_attributed ?? 0,
          refunded: ordersRes?.orders_refunded ?? 0,
          cancelled: ordersRes?.orders_cancelled ?? 0,
        },
      },
    });
  } catch (err) {
    logger.error("routes_liff_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};

export const get__api_analytics_ref_refCode_5 = async (c: Context<Env, "/api/analytics/ref/:refCode">) => {
  try {
    const db = c.env.DB;
    const refCode = c.req.param('refCode');
    const lineAccountId = c.req.query('lineAccountId');
    const accountScope = await analyticsAccountScope(c, lineAccountId);
    if (!accountScope) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }

    // Look up the registered entry_route to surface the operator-facing name,
    // but do NOT 404 when missing. /inflow-links surfaces refs that exist in
    // the friends table but have never been registered (X Harness UUIDs,
    // external campaign IDs, etc.) and we still want their friend list to
    // expand — name just falls back to the raw ref_code in that case.
    const routeRow = await db
      .prepare(`SELECT ref_code, name FROM entry_routes WHERE ref_code = ?`)
      .bind(refCode)
      .first<{ ref_code: string; name: string }>();

    const binds = [refCode, refCode, ...accountScope.binds];

    const friends = await db
      .prepare(
        `SELECT
          f.id,
          f.display_name,
          f.ref_code,
          f.is_following,
          rt.created_at as tracked_at
        FROM friends f
        LEFT JOIN ref_tracking rt ON f.id = rt.friend_id AND rt.ref_code = ?
        WHERE f.ref_code = ? ${accountScope.where}
        ORDER BY rt.created_at DESC`,
      )
      .bind(...binds)
      .all<{
        id: string;
        display_name: string;
        ref_code: string | null;
        is_following: number | null;
        tracked_at: string | null;
      }>();

    return c.json({
      success: true,
      data: {
        refCode: routeRow?.ref_code ?? refCode,
        name: routeRow?.name ?? null,
        // #514-8: 画面が読む欄のうち口が返せるのはいまの状態だけ
        // (is_following を運用文言に寄せる)。はじめて見たページ・成果・
        // マイルの集計口は無いので返さず、画面は「—」にする。
        friends: (friends.results ?? []).map((f) => ({
          id: f.id,
          displayName: f.display_name,
          trackedAt: f.tracked_at,
          currentStatus: f.is_following === 0 ? 'ブロック済み' : '友だち中',
        })),
      },
    });
  } catch (err) {
    logger.error("routes_liff_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};

async function tokenDigest(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
