import { logger } from '@line-crm/shared/server';
import { resolveLineSender } from '../services/line-senders.js';
import { GapError } from '../services/gap-common.js';
import { validateScheduledAt } from './chat-schedule-validation.js';
import { inputError } from '../lib/input-errors.js';

import type { Message } from '@line-crm/line-sdk';
import { getChatById, getFriendById, updateChat, createScheduledChatSend, getScheduledChatSend, listPendingScheduledChatSends, cancelScheduledChatSend, updateScheduledChatSend, jstNow } from '@line-crm/db';
import type { Env } from '../worker-env.js';

import { classifyLineOutboundFailure, completeOutboundSendStatement, failOutboundSend, hashOutboundPayload, isValidIdempotencyKey, reserveOutboundSend } from '../services/outbound-idempotency.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { inboxEventStatement, acquireInboxReplyLease, releaseInboxReplyLease } from '../services/inbox-events.js';
import { fireEvent } from '../services/event-bus.js';
import { findUnsupportedInterpolations } from '@line-crm/shared';
import { renderChatMessageContent, unresolvedVariablesPayload } from '../services/manual-send-interpolation.js';
import { buildChatMessage, ChatAttachmentError } from '../services/chat-attachments.js';
import { resolveOrCreateChat, resolveFriendAndAccessToken, QuotedMessageRow, resolveQuotedMessage, scheduledSendResponse } from './chats-definition.js';
import type { Context } from 'hono';

export const post__api_chats_id_send_combined_1 = async (c: Context<Env, "/api/chats/:id/send-combined">) => {
  if(c.get('impersonation')) return c.json({success:false,code:'IMPERSONATION_SEND_BLOCKED',error:'代理ログイン中は送れません'},403);
  let leasedConversationId: string | null = null;
  try {
    const chatId = c.req.param('id');
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!isValidIdempotencyKey(idempotencyKey)) {
      return inputError(c, { success: false, error: '有効なIdempotency-Keyが必要です' }, 400, []);
    }
    const chat = await resolveOrCreateChat(c.env.DB, chatId);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    let body: { image?: { originalContentUrl?: unknown; previewImageUrl?: unknown } | null; text?: unknown; texts?: unknown; revision?: number; quotedMessageId?: string; correctionOfMessageId?: string; senderId?: string };
    try {
      body = await c.req.json();
    } catch {
      return inputError(c, { success: false, error: 'content is required' }, 400, ["content"]);
    }
    const image = body.image ?? null;
    const text = typeof body.text === 'string' ? body.text : null;
    // G-4: テンプレートパック。`texts` は `text` と並べて受け、
    // 挿入順のまま1回のpushにまとめる。LINEのpush上限は1回5通。
    const extraTexts = Array.isArray(body.texts)
      ? body.texts.filter((t): t is string => typeof t === 'string' && t.length > 0)
      : [];
    const texts = [...(text ? [text] : []), ...extraTexts];
    if (!image && texts.length === 0) return inputError(c, { success: false, error: 'content is required' }, 400, ["image","text","texts"]);
    if (texts.length + (image ? 1 : 0) > 5) {
      return inputError(c, { success: false, error: 'まとめて送れるのは5通までです' }, 400, ["text","texts","image"]);
    }
    if (body.revision !== undefined && body.revision !== chat.revision) {
      return c.json({
        success: false,
        error: 'ほかの担当者が先に更新しました。最新の会話を確認してください',
        code: 'REVISION_CONFLICT',
        data: { revision: chat.revision },
      }, 409);
    }

    const { friend, accessToken, liffId } = await resolveFriendAndAccessToken(
      c.env.DB,
      chat.friend_id,
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
      'chats.manual-send',
    );
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);
    if (friend.is_following !== 1) return c.json({ success: false, error: 'ブロックまたは友だち解除された相手には送信できません', code: 'FRIEND_NOT_FOLLOWING' }, 409);

    if (!await canAccessAllLineAccounts(
      c.env.DB,
      c.get('staff'),
      [friend.line_account_id ?? null],
    )) {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    // 引用元の検証は外部送信より前に行う(単体送信口と同じ境界)。
    let quoted: QuotedMessageRow | null = null;
    if (body.quotedMessageId) {
      quoted = await resolveQuotedMessage(c.env.DB, {
        friendId: friend.id,
        lineAccountId: friend.line_account_id ?? null,
        quotedMessageId: body.quotedMessageId,
      });
      if (!quoted) {
        return c.json({ success: false, error: '引用元のメッセージが見つかりません' }, 404);
      }
    }

    // 外部送信の前に両方を検証する。片方でも壊れていれば送らず保存しない。
    let imagePart: { originalContentUrl: string; previewImageUrl: string } | null = null;
    if (image) {
      if (typeof image.originalContentUrl !== 'string' || !image.originalContentUrl
        || typeof image.previewImageUrl !== 'string' || !image.previewImageUrl) {
        return inputError(c, { success: false, error: '画像メッセージの形式が正しくありません' }, 400, ["image"]);
      }
      imagePart = {
        originalContentUrl: image.originalContentUrl,
        previewImageUrl: image.previewImageUrl,
      };
    }
    const textParts: string[] = [];
    for (const rawText of texts) {
      // N-026: 差し込みは単体送信口と同じ解決器・同じ拒否。片方だけ
      // 素通しだと、画像つき送信が `{{name}}` をそのまま相手へ出す。
      const renderedText = await renderChatMessageContent(
        c.env.DB, friend, 'text', rawText, liffId,
        { kind: 'chat', id: friend.id },
      );
      if (renderedText.unresolved.length > 0) {
        return inputError(c, { success: false, ...unresolvedVariablesPayload(renderedText.unresolved) }, 400, ["friend","liffId"]);
      }
      // 上限は解決後の長さで判定する(展開で超え得る)。
      if (renderedText.content.length > 5000) {
        return inputError(c, { success: false, error: 'メッセージは5000文字以内で入力してください' }, 400, ["friend","liffId"]);
      }
      textParts.push(renderedText.content);
    }
    const messages: Message[] = [
      ...(imagePart ? [{ type: 'image', ...imagePart } as Message] : []),
      ...textParts.map((part) => ({ type: 'text', text: part }) as Message),
    ];
    // 引用は先頭のメッセージに付ける(1送信要求につき1つの引用元)。
    if (quoted?.quote_token && messages.length > 0) {
      messages[0].quoteToken = quoted.quote_token;
    }

    if (body.correctionOfMessageId !== undefined && (typeof body.correctionOfMessageId!=='string' || !await c.env.DB.prepare(
      "SELECT id FROM messages_log WHERE id=? AND friend_id=? AND line_account_id IS ? AND direction='outgoing' AND unsent_at IS NULL AND (delivery_type IS NULL OR delivery_type!='test')"
    ).bind(body.correctionOfMessageId,friend.id,friend.line_account_id??null).first())) return c.json({success:false,error:'correction_source_not_found'},404);
    let sender: Awaited<ReturnType<typeof resolveLineSender>> | null=null;
    if(body.senderId!==undefined){
      if(typeof body.senderId!=='string'||!friend.line_account_id)return c.json({success:false,error:'invalid_sender'},400);
      try{sender=await resolveLineSender(c.env.DB,friend.line_account_id,c.get('staff'),body.senderId);}
      catch(e){if(e instanceof GapError)return c.json({success:false,error:e.code},e.status);throw e;}
      for(const m of messages)Object.assign(m,{sender});
    }
    const leaseNow = new Date();
    const lease = await acquireInboxReplyLease(c.env.DB, {
      channel: 'line',
      conversationId: friend.id,
      staffId: c.get('staff').id,
      conversationRevision: chat.revision,
      now: leaseNow.toISOString(),
      expiresAt: new Date(leaseNow.getTime() + 60_000).toISOString(),
    });
    if (!lease.acquired) {
      return c.json({
        success: false,
        error: 'ほかの担当者が返信中です。送信せず、少し待って最新の会話を確認してください',
        code: 'REPLY_LEASE_CONFLICT',
        data: { staffId: lease.staffId, expiresAt: lease.expiresAt },
      }, 409);
    }
    leasedConversationId = friend.id;

    const payloadHash = await hashOutboundPayload(
      JSON.stringify({
        chatId: chat.id,
        friendId: friend.id,
        combined: true,
        image: imagePart,
        texts: textParts,
        quotedMessageId: quoted?.id ?? null,
        correctionOfMessageId:body.correctionOfMessageId??null,senderId:body.senderId??null,sender,
      }),
    );
    const reservation = await reserveOutboundSend(c.env.DB, {
      key: idempotencyKey,
      channel: 'line',
      resourceId: chat.id,
      payloadHash,
      lineAccountId: friend.line_account_id ?? null,
      retryInProgress: false,
      now: new Date().toISOString(),
    });
    if (reservation.kind === 'conflict') {
      await releaseInboxReplyLease(c.env.DB, { channel: 'line', conversationId: friend.id, staffId: c.get('staff').id });
      leasedConversationId = null;
      return c.json({ success: false, error: '同じ送信キーを別の内容には使用できません' }, 409);
    }
    if (reservation.kind === 'in_progress') {
      await releaseInboxReplyLease(c.env.DB, { channel: 'line', conversationId: friend.id, staffId: c.get('staff').id });
      leasedConversationId = null;
      return c.json({
        success: false,
        error: '同じメッセージを送信中か、送信結果を確認中です',
        code: 'OUTBOUND_SEND_IN_PROGRESS',
      }, 409);
    }
    if (reservation.kind === 'failed') {
      await releaseInboxReplyLease(c.env.DB, { channel: 'line', conversationId: friend.id, staffId: c.get('staff').id });
      leasedConversationId = null;
      return c.json({
        success: false,
        error: reservation.retryable ? '再送できる時刻までお待ちください' : 'この送信は自動再送できません',
        code: reservation.code,
        data: { retryable: reservation.retryable, nextRetryAt: reservation.nextRetryAt },
      }, 409);
    }
    if (reservation.kind === 'unknown') {
      await releaseInboxReplyLease(c.env.DB, { channel: 'line', conversationId: friend.id, staffId: c.get('staff').id });
      leasedConversationId = null;
      return c.json({
        success: false,
        error: 'LINEへの送達結果を確認できないため、自動再送を停止しました',
        code: reservation.code,
        data: { retryable: false, nextRetryAt: null },
      }, 409);
    }
    if (reservation.kind === 'replay') {
      await releaseInboxReplyLease(c.env.DB, { channel: 'line', conversationId: friend.id, staffId: c.get('staff').id });
      leasedConversationId = null;
      return c.json({
        success: true,
        data: {
          sent: true,
          messageId: reservation.responseId,
          sentByStaffName: c.get('staff').name,
          revision: chat.revision,
          replayed: true,
        },
      });
    }

    // 1回のpush要求にまとめる。2回の独立pushにしない。
    const { LineClient } = await import('@line-crm/line-sdk');
    const lineClient = new LineClient(accessToken);
    const outboundLeaseToken = reservation.leaseToken;
    try {
      await lineClient.pushMessage(friend.line_user_id, messages, idempotencyKey);
    } catch (error) {
      const failedAt = new Date().toISOString();
      const failure = classifyLineOutboundFailure(error, failedAt);
      await failOutboundSend(c.env.DB, {
        key: idempotencyKey,
        leaseToken: outboundLeaseToken,
        status: failure.status,
        code: failure.code,
        retryable: failure.retryable,
        nextRetryAt: failure.nextRetryAt,
        now: failedAt,
      });
      await releaseInboxReplyLease(c.env.DB, {
        channel: 'line', conversationId: friend.id, staffId: c.get('staff').id,
      });
      leasedConversationId = null;
      return inputError(c, {
        success: false,
        error: failure.status === 'unknown'
          ? 'LINEへの送達結果を確認できないため、自動再送を停止しました'
          : 'LINEへ送信できませんでした',
        code: failure.code,
        data: { retryable: failure.retryable, nextRetryAt: failure.nextRetryAt },
      }, failure.httpStatus, []);
    }

    const logBaseId = idempotencyKey;
    const sentAt = jstNow();
    const rows = [
      ...(imagePart ? [{
        id: `${logBaseId}:0`,
        messageType: 'image',
        content: JSON.stringify(imagePart),
      }] : []),
      ...textParts.map((part, index) => ({
        id: `${logBaseId}:${index + (imagePart ? 1 : 0)}`,
        messageType: 'text',
        content: part,
      })),
    ];
    try {
      await c.env.DB.batch([
        ...rows.map((row, index) =>
          c.env.DB
            .prepare(`INSERT OR IGNORE INTO messages_log
              (id, friend_id, direction, message_type, content, source, line_account_id,
               sent_by_staff_id, created_at, quoted_message_id,correction_of_message_id,sender_id,sender_snapshot_json)
              VALUES (?, ?, 'outgoing', ?, ?, 'manual', ?, ?, ?, ?,?,?,?)`)
            .bind(
              row.id,
              friend.id,
              row.messageType,
              row.content,
              friend.line_account_id ?? null,
              c.get('staff').id,
              sentAt,
              // 引用は先頭メッセージに付けたので、記録も先頭行にだけ持たせる。
              index === 0 ? quoted?.id ?? null : null,
              index === 0 ? body.correctionOfMessageId??null : null,
              body.senderId??null,sender?JSON.stringify(sender):null,
            ),
        ),
        completeOutboundSendStatement(c.env.DB, {
          key: idempotencyKey,
          responseId: logBaseId,
          now: new Date().toISOString(),
          leaseToken: outboundLeaseToken,
        }),
      ]);
    } catch {
      const failedAt = new Date().toISOString();
      await failOutboundSend(c.env.DB, {
        key: idempotencyKey,
        leaseToken: outboundLeaseToken,
        status: 'unknown',
        code: 'OUTBOUND_CONFIRMATION_FAILED',
        retryable: false,
        nextRetryAt: null,
        now: failedAt,
      });
      await releaseInboxReplyLease(c.env.DB, {
        channel: 'line', conversationId: friend.id, staffId: c.get('staff').id,
      });
      leasedConversationId = null;
      return c.json({
        success: false,
        error: 'LINEには受理された可能性がありますが、送信履歴を確定できませんでした',
        code: 'OUTBOUND_CONFIRMATION_FAILED',
        data: { retryable: false, nextRetryAt: null },
      }, 503);
    }

    await updateChat(c.env.DB, chat.id, { status: 'in_progress', lastMessageAt: sentAt });
    const updatedChat = await getChatById(c.env.DB, chat.id);
    await inboxEventStatement(c.env.DB, {
      channel: 'line',
      conversationId: friend.id,
      eventType: 'send',
      before: null,
      after: { messageId: logBaseId, status: 'in_progress', source: 'manual' },
      actorStaffId: c.get('staff').id,
      correlationId: idempotencyKey,
      createdAt: sentAt,
    }).run();

    try {
      await c.env.DB
        .prepare(
          `UPDATE chats SET first_replied_at = ?
            WHERE id = ? AND first_replied_at IS NULL`,
        )
        .bind(jstNow(), chat.id)
        .run();
    } catch (e) {
      logger.error("chats.chats_id_send_combined_post_failed");
    }

    await fireEvent(c.env.DB, 'manual_reply_sent', {
      sourceEventId: logBaseId,
      sourceKind: 'manual_reply',
      occurredAt: sentAt,
      friendId: friend.id,
      eventData: { staffId: c.get('staff').id },
    }, undefined, friend.line_account_id).catch((error) => {
      logger.error("chats.chats_id_send_combined_post_failed");
    });

    await releaseInboxReplyLease(c.env.DB, {
      channel: 'line', conversationId: friend.id, staffId: c.get('staff').id,
    });
    leasedConversationId = null;

    return c.json({
      success: true,
      data: {
        sent: true,
        messageId: logBaseId,
        messageIds: rows.map((row) => row.id),
        sentByStaffName: c.get('staff').name,
        revision: updatedChat?.revision ?? chat.revision + 1,
      },
    });
  } catch (err) {
    if (leasedConversationId) {
      await releaseInboxReplyLease(c.env.DB, {
        channel: 'line', conversationId: leasedConversationId, staffId: c.get('staff').id,
      }).catch(() => undefined);
    }
    throw err;
  }
};

export const post__api_chats_id_schedule_2 = async (c: Context<Env, "/api/chats/:id/schedule">) => {
  if(c.get('impersonation')) return c.json({success:false,code:'IMPERSONATION_SEND_BLOCKED',error:'代理ログイン中は送れません'},403);
  try {
    const chatId = c.req.param('id');
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!isValidIdempotencyKey(idempotencyKey)) {
      return inputError(c, { success: false, error: '有効なIdempotency-Keyが必要です' }, 400, []);
    }
    const chat = await resolveOrCreateChat(c.env.DB, chatId);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    let body: { messageType?: unknown; content?: unknown; scheduledAt?: unknown; quotedMessageId?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return inputError(c, { success: false, error: 'content is required' }, 400, ["content"]);
    }
    const content = typeof body?.content === 'string' ? body.content : '';
    const messageType = body?.messageType === undefined ? 'text' : body.messageType;
    if (typeof messageType !== 'string') return inputError(c, { success: false, error: 'messageType is not supported' }, 400, ["messageType"]);
    if (!content) return inputError(c, { success: false, error: 'content is required' }, 400, ["content"]);
    if (messageType === 'text' && content.length > 5000) {
      return inputError(c, { success: false, error: 'メッセージは5000文字以内で入力してください' }, 400, ["messageType","content"]);
    }
    // N-026: 送信時に解決される差し込み(name/field/var/date等)は予約へ通すが、
    // カタログに無い名前は将来も解決できないのでここで拒否する(予約行も作らない)。
    const unsupported = findUnsupportedInterpolations(content);
    if (unsupported.length > 0) {
      return inputError(c, { success: false, ...unresolvedVariablesPayload(unsupported) }, 400, ["content"]);
    }
    const time = validateScheduledAt(body.scheduledAt);
    if (!time.ok) {
      return inputError(c, { success: false, error: '未来の日時を指定してください' }, 400, ["scheduledAt"]);
    }

    const { friend } = await resolveFriendAndAccessToken(
      c.env.DB,
      chat.friend_id,
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
      'chats.schedule-send',
    );
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);
    if (friend.is_following !== 1) return c.json({ success: false, error: 'ブロックまたは友だち解除された相手には送信できません', code: 'FRIEND_NOT_FOLLOWING' }, 409);
    if (!await canAccessAllLineAccounts(
      c.env.DB,
      c.get('staff'),
      [friend.line_account_id ?? null],
    )) {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    // 引用元の検証は単体送信口と同じ境界。無効な引用は予約を作らない。
    let quotedMessageId: string | null = null;
    if (typeof body.quotedMessageId === 'string' && body.quotedMessageId) {
      const quoted = await resolveQuotedMessage(c.env.DB, {
        friendId: friend.id,
        lineAccountId: friend.line_account_id ?? null,
        quotedMessageId: body.quotedMessageId,
      });
      if (!quoted) {
        return c.json({ success: false, error: '引用元のメッセージが見つかりません' }, 404);
      }
      quotedMessageId = quoted.id;
    }

    let validatedContent = content;
    try {
      // text/Flexの差し込みは送信時に展開する。添付は予約時と送信時の両方で検証する。
      if (messageType !== 'text') {
        validatedContent = (await buildChatMessage({ messageType, content, bucket: c.env.IMAGES, signingSecret: c.env.API_KEY,
          owner: { friendId: friend.id, lineAccountId: friend.line_account_id ?? null },
          origin: c.env.WORKER_URL || new URL(c.req.url).origin, neededAt: Date.parse(time.scheduledAt),
        })).content;
      }
    } catch (error) {
      if (error instanceof ChatAttachmentError) return inputError(c, { success: false, code: error.code, error: error.message }, 400, ["attachmentIds"]);
      throw error;
    }

    const { row, created } = await createScheduledChatSend(c.env.DB, {
      id: crypto.randomUUID(),
      friendId: friend.id,
      lineAccountId: friend.line_account_id ?? null,
      staffId: c.get('staff').id,
      messageType,
      content: validatedContent,
      quotedMessageId,
      idempotencyKey,
      scheduledAt: time.scheduledAt,
      now: new Date().toISOString(),
    });

    // 同じ予約キーを別の友だち・内容へ使わせない。既存行の添付を返さない。
    // 再送時に日時を再計算した呼び出しも、最初の予約日時のまま返す。
    if (row.friend_id !== friend.id || row.line_account_id !== (friend.line_account_id ?? null)
      || row.message_type !== messageType || row.content !== validatedContent
      || row.quoted_message_id !== quotedMessageId) {
      return c.json({ success: false, error: '同じ予約キーを別の内容には使用できません' }, 409);
    }
    return c.json({
      success: true,
      data: { ...scheduledSendResponse(row), replayed: !created },
    });
  } catch (err) {
    throw err;
  }
};

export const get__api_chats_id_scheduled_3 = async (c: Context<Env, "/api/chats/:id/scheduled">) => {
  try {
    const chatId = c.req.param('id');
    const chat = await getChatById(c.env.DB, chatId)
      ?? await resolveOrCreateChat(c.env.DB, chatId).catch(() => null);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);
    const rows = await listPendingScheduledChatSends(c.env.DB, chat.friend_id);
    return c.json({
      success: true,
      data: { scheduled: rows.map(scheduledSendResponse) },
    });
  } catch (err) {
    throw err;
  }
};

export const patch__api_chats_id_scheduled_scheduleId_4 = async (c: Context<Env, "/api/chats/:id/scheduled/:scheduleId">) => {
  try {
    const chatId = c.req.param('id');
    const scheduleId = c.req.param('scheduleId');
    const chat = await getChatById(c.env.DB, chatId)
      ?? await resolveOrCreateChat(c.env.DB, chatId).catch(() => null);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    const existing = await getScheduledChatSend(c.env.DB, scheduleId);
    if (!existing || existing.friend_id !== chat.friend_id) return c.json({ success: false, error: '予約が見つかりません' }, 404);
    if (existing.status !== 'scheduled') return c.json({ success: false, error: '送信処理が始まったか、すでに処理済みの予約です', code: 'SCHEDULE_LOCKED' }, 409);

    let body: { scheduledAt?: unknown; content?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return inputError(c, { success: false, error: 'content is required' }, 400, ["content"]);
    }
    const updates: { scheduledAt?: string; content?: string } = {};
    if (body.scheduledAt !== undefined) {
      const time = validateScheduledAt(body.scheduledAt);
      if (!time.ok) {
        return inputError(c, { success: false, error: '未来の日時を指定してください' }, 400, ["scheduledAt"]);
      }
      updates.scheduledAt = time.scheduledAt;
    }
    if (body.content !== undefined) {
      if (typeof body.content !== 'string' || !body.content) {
        return inputError(c, { success: false, error: 'content is required' }, 400, ["content"]);
      }
      if (existing.message_type === 'text' && body.content.length > 5000) {
        return inputError(c, { success: false, error: 'メッセージは5000文字以内で入力してください' }, 400, ["content"]);
      }
      // N-026: 予約作成と同じく、カタログに無い差し込み名はここで拒否する。
      const unsupported = findUnsupportedInterpolations(body.content);
      if (unsupported.length > 0) {
        return inputError(c, { success: false, ...unresolvedVariablesPayload(unsupported) }, 400, ["content"]);
      }
      updates.content = body.content;
    }
    if (updates.scheduledAt === undefined && updates.content === undefined) {
      return inputError(c, { success: false, error: '変更する項目がありません' }, 400, ["scheduledAt","content"]);
    }

    try {
      if (!['text', 'flex'].includes(existing.message_type)) {
        const friend = await getFriendById(c.env.DB, chat.friend_id);
        if (!friend) return c.notFound();
        const built = await buildChatMessage({ messageType: existing.message_type,
          content: updates.content ?? existing.content, bucket: c.env.IMAGES, signingSecret: c.env.API_KEY,
          owner: { friendId: friend.id, lineAccountId: friend.line_account_id ?? null },
          origin: c.env.WORKER_URL || new URL(c.req.url).origin,
          neededAt: Date.parse(updates.scheduledAt ?? existing.scheduled_at),
        });
        if (updates.content !== undefined) updates.content = built.content;
      }
    } catch (error) {
      if (error instanceof ChatAttachmentError) return inputError(c, { success: false, code: error.code, error: error.message }, 400, ["attachmentIds"]);
      throw error;
    }

    const result = await updateScheduledChatSend(c.env.DB, {
      id: scheduleId,
      friendId: chat.friend_id,
      scheduledAt: updates.scheduledAt,
      content: updates.content,
      now: new Date().toISOString(),
    });
    if (result === 'not_found') {
      return c.json({ success: false, error: '予約が見つかりません' }, 404);
    }
    if (result === 'locked') {
      return c.json({
        success: false,
        error: '送信処理が始まったか、すでに処理済みの予約です',
        code: 'SCHEDULE_LOCKED',
      }, 409);
    }
    return c.json({ success: true, data: { updated: true } });
  } catch (err) {
    throw err;
  }
};

export const delete__api_chats_id_scheduled_scheduleId_5 = async (c: Context<Env, "/api/chats/:id/scheduled/:scheduleId">) => {
  try {
    const chatId = c.req.param('id');
    const scheduleId = c.req.param('scheduleId');
    const chat = await getChatById(c.env.DB, chatId)
      ?? await resolveOrCreateChat(c.env.DB, chatId).catch(() => null);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    if (c.get('staff').readOnly || c.get('impersonation')?.mode === 'read') return c.json({success:false,error:'forbidden'},403);
    let reason = c.get('impersonation') ? c.req.header('X-Impersonation-Reason')?.trim() : undefined;
    if(reason) {try{reason=decodeURIComponent(reason);}catch{return c.json({success:false,error:'invalid_reason'},400);}}
    if(reason && reason.length>500)return c.json({success:false,error:'invalid_reason'},400);
    if (c.get('impersonation') && !reason) return c.json({success:false,error:'reason_required'},400);
    const result = await cancelScheduledChatSend(c.env.DB, {
      id: scheduleId,
      friendId: chat.friend_id,
      staffId: c.get('staff').id,
      reason,
      now: new Date().toISOString(),
    });
    if (result === 'too_late') return c.json({success:false, code:'SCHEDULE_TOO_LATE',error:'まもなく送ります。取り消せません'},409);
    if (result === 'not_found') {
      return c.json({ success: false, error: '予約が見つかりません' }, 404);
    }
    if (result === 'locked') {
      return c.json({
        success: false,
        error: '送信処理が始まったか、すでに処理済みの予約です',
        code: 'SCHEDULE_LOCKED',
      }, 409);
    }
    return c.json({ success: true, data: { cancelled: true } });
  } catch (err) {
    throw err;
  }
};
