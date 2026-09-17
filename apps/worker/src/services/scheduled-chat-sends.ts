import {
  claimDueScheduledChatSends,
  getFriendById,
  getLineAccountById,
  markScheduledChatSendFailed,
  markScheduledChatSendSent,
  jstNow,
  SCHEDULED_CHAT_SEND_MAX_ATTEMPTS,
  type ScheduledChatSendRow,
} from '@line-crm/db';
import { resolveLineToken } from './line-token.js';
import { classifyLineOutboundFailure } from './outbound-idempotency.js';
import { renderChatMessageContent } from './manual-send-interpolation.js';

// N-025: 期限が来た送信予約をLINEへpushするcron側の処理。
// 二重送信防止は3層: claimのCAS(status) + lease_token照合 + LINEへ同じ
// idempotency_keyを渡す(retry-key)。送信結果がunknownのときは自動再送しない。

type ScheduleDispatchEnv = {
  DB: D1Database;
  LINE_CHANNEL_ACCESS_TOKEN: string;
};

const RETRY_BACKOFF_MS = 5 * 60_000;

async function resolveSendTarget(
  env: ScheduleDispatchEnv,
  row: ScheduledChatSendRow,
): Promise<{ friend: NonNullable<Awaited<ReturnType<typeof getFriendById>>>; accessToken: string; liffId: string | null } | null> {
  const friend = await getFriendById(env.DB, row.friend_id);
  if (!friend) return null;
  const account = friend.line_account_id
    ? await getLineAccountById(env.DB, friend.line_account_id)
    : null;
  const accessToken = resolveLineToken({
    accountToken: account?.channel_access_token ?? null,
    defaultToken: env.LINE_CHANNEL_ACCESS_TOKEN,
    accountId: friend.line_account_id,
    context: 'scheduled-chat-send',
  });
  return { friend, accessToken, liffId: account?.liff_id ?? null };
}

/**
 * claim済みの1件を送る。引用元が送るまでに取消された場合は引用なしで送る
 * (引用できなくても予約そのものは届ける方針)。
 */
async function dispatchOne(
  env: ScheduleDispatchEnv,
  row: ScheduledChatSendRow,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const target = await resolveSendTarget(env, row);
  if (!target) {
    await markScheduledChatSendFailed(env.DB, {
      id: row.id,
      leaseToken: row.lease_token!,
      errorCode: 'friend_not_found',
      error: '送信対象の友だちが見つかりません',
      retryable: false,
      now: nowIso,
    });
    return;
  }

  let quoteToken: string | null = null;
  if (row.quoted_message_id) {
    const quoted = await env.DB
      .prepare(
        `SELECT quote_token FROM messages_log
          WHERE id = ? AND friend_id = ? AND unsent_at IS NULL`,
      )
      .bind(row.quoted_message_id, row.friend_id)
      .first<{ quote_token: string | null }>();
    quoteToken = quoted?.quote_token ?? null;
  }

  // N-026: 差し込みは送信時の情報で解決する(予約時点と値が変わり得る)。
  // 解決しきれない `{{…}}` が残るなら LINE を呼ばず、行だけ失敗で残す。
  const rendered = await renderChatMessageContent(
    env.DB, target.friend, row.message_type, row.content, target.liffId,
    { kind: 'chat', id: row.id },
  );
  if (rendered.unresolved.length > 0) {
    await markScheduledChatSendFailed(env.DB, {
      id: row.id,
      leaseToken: row.lease_token!,
      errorCode: 'unresolved_template_variables',
      error: `差し込みを解決できません: ${rendered.unresolved.map((v) => `{{${v}}}`).join(', ')}`,
      retryable: false,
      now: nowIso,
    });
    return;
  }

  // 展開でLINEの上限を超えた分はLINEを呼ばず失敗で残す(400で落ちるのが分かりきっている)。
  if (rendered.content.length > 5000) {
    await markScheduledChatSendFailed(env.DB, {
      id: row.id,
      leaseToken: row.lease_token!,
      errorCode: 'content_too_long',
      error: '差し込みを解決した本文が5000文字を超えています',
      retryable: false,
      now: nowIso,
    });
    return;
  }

  const { LineClient } = await import('@line-crm/line-sdk');
  const lineClient = new LineClient(target.accessToken);
  const message = {
    type: 'text' as const,
    text: rendered.content,
    ...(quoteToken ? { quoteToken } : {}),
  };

  try {
    await lineClient.pushMessage(target.friend.line_user_id, [message], row.idempotency_key);
  } catch (error) {
    const failure = classifyLineOutboundFailure(error, nowIso);
    // unknown(送達可否が分からない)は自動再送すると二重送信になり得るため
    // retryable=false扱いでfailedへ確定し、台帳に残す。
    const retryable =
      failure.retryable &&
      failure.status !== 'unknown' &&
      row.attempt_count < SCHEDULED_CHAT_SEND_MAX_ATTEMPTS;
    await markScheduledChatSendFailed(env.DB, {
      id: row.id,
      leaseToken: row.lease_token!,
      errorCode: failure.code,
      error: error instanceof Error ? error.message : String(error),
      retryable,
      nextScheduledAt: retryable
        ? new Date(Date.now() + RETRY_BACKOFF_MS * row.attempt_count).toISOString()
        : undefined,
      now: nowIso,
    });
    return;
  }

  // LINE受理後: 送信履歴→予約確定の順で書く。履歴が書けなければ確定しない
  // (次のcronがclaimを回収してもLINE側のretry-keyが二重送信を止める)。
  const sentAt = jstNow();
  const messageId = `scheduled:${row.id}`;
  try {
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO messages_log
           (id, friend_id, direction, message_type, content, source,
            line_account_id, sent_by_staff_id, created_at, quoted_message_id)
         VALUES (?, ?, 'outgoing', ?, ?, 'scheduled', ?, ?, ?, ?)`,
      )
      .bind(
        messageId,
        row.friend_id,
        row.message_type,
        rendered.content,
        row.line_account_id,
        row.staff_id,
        sentAt,
        row.quoted_message_id,
      )
      .run();
  } catch (error) {
    await markScheduledChatSendFailed(env.DB, {
      id: row.id,
      leaseToken: row.lease_token!,
      errorCode: 'confirmation_failed',
      error: error instanceof Error ? error.message : String(error),
      retryable: false,
      now: nowIso,
    });
    return;
  }

  await markScheduledChatSendSent(env.DB, {
    id: row.id,
    leaseToken: row.lease_token!,
    messageId,
    now: nowIso,
  });
  await env.DB
    .prepare(`UPDATE chats SET last_message_at = ? WHERE friend_id = ?`)
    .bind(sentAt, row.friend_id)
    .run();
}

/**
 * cronから呼ばれる入口。期限到来分をclaimして順に送る。
 * 失敗した1件があっても他の予約は進める。
 */
export async function processDueScheduledChatSends(
  env: ScheduleDispatchEnv,
  options: { now?: string; limit?: number } = {},
): Promise<{ claimed: number; sent: number; failed: number }> {
  const now = options.now ?? new Date().toISOString();
  const claimed = await claimDueScheduledChatSends(env.DB, {
    now,
    leaseToken: crypto.randomUUID(),
    limit: options.limit ?? 20,
  });

  let sent = 0;
  let failed = 0;
  for (const row of claimed) {
    try {
      await dispatchOne(env, row);
    } catch (error) {
      console.error('scheduled chat send dispatch error:', row.id, error);
      failed += 1;
      continue;
    }
    const after = await env.DB
      .prepare(`SELECT status FROM scheduled_chat_sends WHERE id = ?`)
      .bind(row.id)
      .first<{ status: string }>();
    if (after?.status === 'sent') sent += 1;
    else if (after?.status === 'failed') failed += 1;
  }
  return { claimed: claimed.length, sent, failed };
}
