import { logger } from '@line-crm/shared/server';
import { inputError } from '../lib/input-errors.js';

import { getFriendById, jstNow } from '@line-crm/db';
import { buildMessage } from '../services/step-delivery.js';
import type { Env } from '../worker-env.js';
import { resolveLineToken } from '../services/line-token.js';

import { classifyLineOutboundFailure, completeOutboundSendStatement, failOutboundSend, hashOutboundPayload, isValidIdempotencyKey, reserveOutboundSend } from '../services/outbound-idempotency.js';

import type { Context } from 'hono';

export const get__api_friends_id_timeline_1 = async (c: Context<Env, "/api/friends/:id/timeline">) => {
    try {
      const limitRaw = Number(c.req.query('limit') ?? 50);
      const offsetRaw = Number(c.req.query('cursor') ?? 0);
      if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100
          || !Number.isInteger(offsetRaw) || offsetRaw < 0) {
        return c.json({ success: false, error: 'ページ位置が正しくありません' }, 400);
      }
      const friendId = c.req.param('id');
      /*
        N-717: compound SELECTはD1の SQLITE_MAX_COMPOUND_SELECT(既定5)を超えて
        "too many terms in compound SELECT" になる（better-sqlite3の既定上限は
        500なので手元試験は通ってしまい、D1でだけ落ちる）。
        4項ずつのCTEへ割り、外側でUNION ALLへまとめて5項以下に収める形を保つ。
        IDEA-03 で注文・写真投稿を足したので、専用ソース10項を
        group_a(4) + group_b(4) + group_c(2) の3CTEへ分け、外側は3項。

        重複の扱い（IDEA-03「重複なし」）:
        analytics_events は事実の分析用の写しで、同じ出来事が専用台帳にも
        1行ある（受信メッセージ→messages_log、フォーム回答→form_submissions、
        予約の確定/取消→各予約台帳、注文→ec_orders、postback→messages_log）。
        そのevent_typeはanalytics側から外し、1つの出来事が2行出ないようにする。
        タグ変更・シナリオ開始など専用台帳を持たないイベントはそのまま出す。

        status: 出せるソースだけ状態を返す。状態を持たない行は NULL。
        source: 元の台帳を指す {kind,id} に、遷移先で必要な親ID(form_id等)と
        外部URL(注文詳細・投稿画像)だけを添える。行き先が無い種類は NULL のまま。
      */
      const result = await c.env.DB.prepare(
        `WITH group_a AS (
             SELECT ml.id,
                    CASE WHEN ml.direction = 'incoming' THEN 'message_received' ELSE 'message_sent' END AS event_type,
                    CASE WHEN ml.direction = 'incoming' THEN 'メッセージを受信しました' ELSE 'メッセージを送信しました' END AS summary,
                    NULL AS status,
                    'message' AS source_kind, ml.id AS source_id,
                    NULL AS source_parent_id, NULL AS source_url,
                    ml.created_at AS occurred_at,
                    COALESCE(ml.line_account_id, f.line_account_id) AS line_account_id
               FROM messages_log ml JOIN friends f ON f.id = ml.friend_id
              WHERE ml.friend_id = ? AND (ml.delivery_type IS NULL OR ml.delivery_type != 'test')
             UNION ALL
             SELECT fs.id, 'form_submitted', '回答フォームへ回答しました', NULL,
                    'form_submission', fs.id, fs.form_id, NULL, fs.created_at, f.line_account_id
               FROM form_submissions fs JOIN friends f ON f.id = fs.friend_id
              WHERE fs.friend_id = ?
             UNION ALL
             SELECT b.id, 'booking', 'カレンダー予約が更新されました', b.status,
                    'booking', b.id, NULL, NULL, COALESCE(b.updated_at, b.created_at), b.line_account_id
               FROM bookings b WHERE b.friend_id = ?
             UNION ALL
             SELECT cb.id, 'calendar_booking', '外部カレンダー予約が更新されました', cb.status,
                    'calendar_booking', cb.id, NULL, NULL, COALESCE(cb.updated_at, cb.created_at), f.line_account_id
               FROM calendar_bookings cb JOIN friends f ON f.id = cb.friend_id
              WHERE cb.friend_id = ?
           ),
           group_b AS (
             SELECT eb.id, 'event_booking', 'イベント予約が更新されました', eb.status,
                    'event_booking', eb.id, eb.event_id, NULL, COALESCE(eb.updated_at, eb.requested_at), eb.line_account_id
               FROM event_bookings eb WHERE eb.friend_id = ?
             UNION ALL
             SELECT fr.id, 'reminder', 'リマインダが更新されました', fr.status,
                    'friend_reminder', fr.id, fr.reminder_id, NULL, COALESCE(fr.updated_at, fr.created_at), f.line_account_id
               FROM friend_reminders fr JOIN friends f ON f.id = fr.friend_id
              WHERE fr.friend_id = ?
             UNION ALL
             SELECT ie.id, ie.event_type, ie.summary, NULL,
                    'identity_event', ie.id, NULL, NULL, ie.occurred_at, f.line_account_id
               FROM identity_events ie JOIN friends f ON f.user_id = ie.user_id
              WHERE f.id = ? AND ie.tenant_id = COALESCE(
                (SELECT la2.tenant_id FROM line_accounts la2 WHERE la2.id = f.line_account_id),
                '00000000-0000-4000-8000-000000000001'
              )
             UNION ALL
             SELECT ae.id, ae.event_type, '共通イベントを記録しました', NULL,
                    ae.source_kind, ae.source_id, NULL, NULL, ae.occurred_at, ae.line_account_id
               FROM analytics_events ae
              WHERE ae.friend_id = ?
                AND ae.event_type NOT IN (
                  'message_received', 'message_sent', 'postback_received',
                  'form_submitted', 'booking_confirmed', 'booking_cancelled',
                  'ec.order.confirmed', 'ec.order.payment_received',
                  'ec.order.bank_transfer_reminder', 'ec.order.shipped',
                  'ec.order.cancelled', 'ec.order.refunded'
                )
           ),
           group_c AS (
             SELECT o.id, 'ec_order', '注文 ' || o.order_number || ' を記録しました',
                    o.normalized_status,
                    'ec_order', o.id, NULL, o.detail_url, o.ordered_at, o.line_account_id
               FROM ec_orders o WHERE o.friend_id = ?
             UNION ALL
             SELECT p.id, 'photo_submitted', '写真を投稿しました', p.status,
                    'nen_photo_submission', p.id, NULL, p.image_url, p.created_at, f.line_account_id
               FROM nen_photo_submissions p JOIN friends f ON f.id = p.friend_id
              WHERE p.friend_id = ?
           )
         SELECT timeline.id, timeline.event_type, timeline.summary, timeline.status,
                timeline.source_kind, timeline.source_id,
                timeline.source_parent_id, timeline.source_url,
                timeline.occurred_at,
                timeline.line_account_id, la.name AS line_account_name
           FROM (
             SELECT * FROM group_a
             UNION ALL
             SELECT * FROM group_b
             UNION ALL
             SELECT * FROM group_c
           ) timeline
           LEFT JOIN line_accounts la ON la.id = timeline.line_account_id
          ORDER BY timeline.occurred_at DESC, timeline.id DESC
          LIMIT ? OFFSET ?`,
      ).bind(
        friendId, friendId, friendId, friendId, friendId, friendId, friendId, friendId,
        friendId, friendId,
        limitRaw + 1, offsetRaw,
      ).all<{
        id: string;
        event_type: string;
        summary: string;
        status: string | null;
        source_kind: string;
        source_id: string;
        source_parent_id: string | null;
        source_url: string | null;
        occurred_at: string;
        line_account_id: string | null;
        line_account_name: string | null;
      }>();
      const hasNextPage = result.results.length > limitRaw;
      const items = result.results.slice(0, limitRaw).map((row) => ({
        id: row.id,
        type: row.event_type,
        summary: row.summary,
        status: row.status,
        source: {
          kind: row.source_kind,
          id: row.source_id,
          parentId: row.source_parent_id,
          url: row.source_url,
        },
        occurredAt: row.occurred_at,
        lineAccount: row.line_account_id
          ? { id: row.line_account_id, name: row.line_account_name ?? null }
          : null,
      }));
      return c.json({
        success: true,
        data: {
          items,
          limit: limitRaw,
          nextCursor: hasNextPage ? String(offsetRaw + limitRaw) : null,
        },
      });
    } catch (error) {
      throw error;
    }
  };

export const post__api_friends_id_messages_2 = async (c: Context<Env, "/api/friends/:id/messages">) => {
  try {
    const friendId = c.req.param('id');
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!isValidIdempotencyKey(idempotencyKey)) {
      return inputError(c, { success: false, error: '有効なIdempotency-Keyが必要です' }, 400, []);
    }
    const body = await c.req.json<{
      messageType?: string;
      content: string;
      altText?: string;
      trackLinks?: boolean;
    }>();

    if (!body.content) {
      return inputError(c, { success: false, error: 'content is required' }, 400, ["content"]);
    }

    const db = c.env.DB;
    const friend = await getFriendById(db, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    const messageType = body.messageType ?? 'text';
    // アカウントは予約の範囲キーにも使うので先に解く（N-028/N-029）。
    const friendAccountId =
      ((friend as unknown as Record<string, unknown>).line_account_id as string | null) ?? null;

    // この経路は従来 {{var.*}} を展開せず生のまま送っていた。消えた共通情報は
    // 空文字にせず止め、解決できるものは送信時点の値へ置き換える。
    // 予約・追跡より先に行うので、拒否時はDBへ何も書かない。
    const { expandSendCommonVars, CommonVarResolutionFailedError } = await import('../services/interpolation-context.js');
    let resolvedContent = body.content;
    try {
      resolvedContent = await expandSendCommonVars(
        db, body.content,
        { kind: 'friend_direct', id: friend.id },
        { lineAccountId: friendAccountId, messageType },
      );
    } catch (error) {
      if (error instanceof CommonVarResolutionFailedError) {
        return inputError(c, {
          success: false,
          error: `共通情報を解決できません: ${error.failures.map((f) => `{{var.${f.varKey}}}`).join(', ')}`,
          code: 'UNRESOLVED_TEMPLATE_VARIABLES',
          data: { variables: error.failures.map((f) => `var.${f.varKey}`) },
        }, 422, ["content"]);
      }
      throw error;
    }

    const payloadHash = await hashOutboundPayload(
      JSON.stringify({
        friendId: friend.id,
        messageType,
        content: resolvedContent,
        altText: body.altText,
        trackLinks: body.trackLinks !== false,
      }),
    );
    const reservation = await reserveOutboundSend(db, {
      key: idempotencyKey,
      channel: 'line',
      resourceId: friend.id,
      payloadHash,
      lineAccountId: friendAccountId,
      // in_progress はLINE受理後の応答喪失を含み得るため、自動再送しない。
      retryInProgress: false,
      now: new Date().toISOString(),
    });
    if (reservation.kind === 'conflict') {
      return c.json({ success: false, error: '同じ送信キーを別の内容には使用できません' }, 409);
    }
    if (reservation.kind === 'in_progress') {
      return c.json({
        success: false,
        error: '同じメッセージを送信中か、送信結果を確認中です',
        code: 'OUTBOUND_SEND_IN_PROGRESS',
      }, 409);
    }
    if (reservation.kind === 'failed') {
      return c.json({
        success: false,
        error: reservation.retryable ? '再送できる時刻までお待ちください' : 'この送信は自動再送できません',
        code: reservation.code,
        data: { retryable: reservation.retryable, nextRetryAt: reservation.nextRetryAt },
      }, 409);
    }
    if (reservation.kind === 'unknown') {
      return c.json({
        success: false,
        error: 'LINEへの送達結果を確認できないため、自動再送を停止しました',
        code: reservation.code,
        data: { retryable: false, nextRetryAt: null },
      }, 409);
    }
    if (reservation.kind === 'replay') {
      return c.json({ success: true, data: { messageId: reservation.responseId, replayed: true } });
    }

    // LINE 側にも同じキーを渡す。DB保存前に通信が切れて再実行されても、
    // LINE API が同一リクエストを二重配信しない。
    const outboundLeaseToken = reservation.leaseToken;
    const { LineClient } = await import('@line-crm/line-sdk');
    let lineClient: InstanceType<typeof LineClient>;
    let tracked: { messageType: string; content: string };
    try {
      // Resolve access token from friend's account (multi-account support)
      let accountToken: string | null = null;
      if (friendAccountId) {
        const { getLineAccountById } = await import('@line-crm/db');
        const account = await getLineAccountById(db, friendAccountId);
        accountToken = account?.channel_access_token ?? null;
      }
      const accessToken = resolveLineToken({
        accountToken,
        defaultToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
        accountId: friendAccountId,
        context: 'friends.direct-send',
      });
      lineClient = new LineClient(accessToken);

      // Auto-wrap URLs with tracking links (text with URLs → Flex with button)
      // trackLinks=false で明示的に短縮 OFF (URL をそのまま送る)
      const sendWorkerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
      tracked = { messageType, content: resolvedContent };
      if (body.trackLinks !== false) {
        const { autoTrackContent } = await import('../services/auto-track.js');
        tracked = await autoTrackContent(
          db, messageType, resolvedContent,
          sendWorkerUrl,
          { lineAccountId: friendAccountId },
        );
      }
      // 1:1 送信なので /t リンクに f=<friendId> を焼き込み、LIFF 識別ホップなしで
      // クリック帰属できるようにする（既存 /t リンクにも効くので trackLinks に関わらず実施）
      const { appendFriendToTrackedLinks } = await import('../services/auto-track.js');
      tracked = {
        ...tracked,
        content: await appendFriendToTrackedLinks(db, tracked.content, sendWorkerUrl, friend.id),
      };
    } catch (prepareError) {
      // LINEへ届く前の失敗なので、再送しても二重送信にならない失敗として残す。
      const failedAt = new Date().toISOString();
      await failOutboundSend(db, {
        key: idempotencyKey,
        leaseToken: outboundLeaseToken,
        status: 'failed',
        code: 'OUTBOUND_PREPARATION_FAILED',
        retryable: true,
        nextRetryAt: null,
        now: failedAt,
      });
      logger.error("friends.friends_id_messages_post_failed");
      return c.json({
        success: false,
        error: '送信の準備に失敗しました',
        code: 'OUTBOUND_PREPARATION_FAILED',
        data: { retryable: true, nextRetryAt: null },
      }, 500);
    }

    const message = buildMessage(tracked.messageType, tracked.content, body.altText);
    try {
      await lineClient.pushMessage(friend.line_user_id, [message], idempotencyKey);
    } catch (sendError) {
      const failedAt = new Date().toISOString();
      const failure = classifyLineOutboundFailure(sendError, failedAt);
      await failOutboundSend(db, {
        key: idempotencyKey,
        leaseToken: outboundLeaseToken,
        status: failure.status,
        code: failure.code,
        retryable: failure.retryable,
        nextRetryAt: failure.nextRetryAt,
        now: failedAt,
      });
      return inputError(c, {
        success: false,
        error: failure.status === 'unknown'
          ? 'LINEへの送達結果を確認できないため、自動再送を停止しました'
          : 'LINEへ送信できませんでした',
        code: failure.code,
        data: { retryable: failure.retryable, nextRetryAt: failure.nextRetryAt },
      }, failure.httpStatus, []);
    }

    // Log outgoing message
    const logId = idempotencyKey;
    const sentAt = jstNow();
    try {
      await db.batch([
        db.prepare(
          `INSERT OR IGNORE INTO messages_log (
             id, friend_id, direction, message_type, content, broadcast_id,
             scenario_step_id, source, line_account_id, created_at
           ) VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, 'manual', ?, ?)`,
        )
          .bind(logId, friend.id, tracked.messageType, tracked.content, friendAccountId, sentAt),
        completeOutboundSendStatement(db, {
          key: idempotencyKey,
          responseId: logId,
          now: new Date().toISOString(),
          leaseToken: outboundLeaseToken,
        }),
      ]);
    } catch {
      // pushは受理済みだが記録を確定できなかった。自動再送は二重送信になり得るので止める。
      const failedAt = new Date().toISOString();
      await failOutboundSend(db, {
        key: idempotencyKey,
        leaseToken: outboundLeaseToken,
        status: 'unknown',
        code: 'OUTBOUND_CONFIRMATION_FAILED',
        retryable: false,
        nextRetryAt: null,
        now: failedAt,
      });
      return c.json({
        success: false,
        error: 'LINEには受理された可能性がありますが、送信履歴を確定できませんでした',
        code: 'OUTBOUND_CONFIRMATION_FAILED',
        data: { retryable: false, nextRetryAt: null },
      }, 503);
    }

    return c.json({ success: true, data: { messageId: logId } });
  } catch (err) {
    throw err;
  }
};
