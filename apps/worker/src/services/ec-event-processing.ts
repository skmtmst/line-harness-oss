import {
  attachEcOrderFriend,
  getCustomerNotificationSource,
  getFriendByLineUserIdForAccount,
  getLineAccountById,
  recordConversionSourceEvent,
  recordCustomerEcDelivery,
  setEcActionExecutionStatus,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { fireEvent, logOutgoingMessage } from './event-bus.js';
import {
  buildEcV6Event,
  ecDispatchIdempotencyKey,
  ecNotificationRetryKey,
} from './ec-event-publish.js';
import { classifyExternalDeliveryError } from './external-delivery-retry.js';
import { enqueuePostShippingFollowUps } from './nen-engagement.js';
import { ecFlexMessage } from './ec-notification-message.js';
import { syncNenEcTags, syncNenPetTags } from './nen-tag-sync.js';
// syncMemberSnapshot と EcEvent は受付口に残す。ここで使うのは実行時だけ
// のため、循環 import でも未評価の束縛に触れない。
import { syncMemberSnapshot, type EcEvent } from '../routes/ec-integrations.js';

/*
 * EC イベント1件の取り込み後処理（受付口と再試行で共用）。
 *
 * 受付口（webhook）は署名・台帳・読み取りモデルまで済ませてから呼ぶ。
 * 再試行（sweeper）は保存済み payload を起こして同じ入口から回す。
 * どちらも claim（received/failed → processing）で1回だけ進み、
 * 送信の冪等キー（X-Line-Retry-Key・dispatch 台帳）で二重送信を防ぐ。
 */

export type EcDispatchSubscriber = 'notification' | 'v6';

async function getEcDispatchStatus(
  db: D1Database, eventId: string, subscriber: EcDispatchSubscriber,
): Promise<string | null> {
  const row = await db.prepare(
    `SELECT status FROM ec_v6_dispatches WHERE event_id = ? AND subscriber = ?`,
  ).bind(eventId, subscriber).first<{ status: string }>();
  return row?.status ?? null;
}

async function markEcDispatch(
  db: D1Database,
  input: {
    eventId: string; subscriber: EcDispatchSubscriber; status: 'pending' | 'sent' | 'failed';
    error?: string | null; idempotencyKey: string; now: string;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO ec_v6_dispatches
       (event_id, subscriber, status, attempt_count, last_error, idempotency_key, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(event_id, subscriber) DO UPDATE SET
       status = excluded.status,
       attempt_count = ec_v6_dispatches.attempt_count + 1,
       last_error = excluded.last_error,
       idempotency_key = excluded.idempotency_key,
       updated_at = excluded.updated_at`,
  ).bind(
    input.eventId, input.subscriber, input.status,
    input.error ?? null, input.idempotencyKey, input.now,
  ).run();
}

/**
 * V6へ1回分の連携を行い、購読台帳へ結果を残す。V6側の失敗は台帳へ
 * `failed` として残してから投げ直す(呼び出し側は再試行へ回す)。
 * 送信済みの記録自体に失敗したときは黙殺せず、そのまま投げる。
 */
async function fireEcV6Event(
  db: D1Database,
  input: {
    eventId: string; lineAccountId: string; externalEventId: string;
    event: EcEvent; friendId: string; accessToken: string; now: string;
  },
): Promise<void> {
  const idempotencyKey = ecDispatchIdempotencyKey(input.lineAccountId, input.externalEventId, 'v6');
  // 送信済みの購読先は送らない。実行状態の更新失敗で再試行になっても、
  // 成功済みV6を再発火させない。並行受信は台帳claim(atomic UPDATE)が fence する。
  if (await getEcDispatchStatus(db, input.eventId, 'v6') === 'sent') return;
  const v6Event = buildEcV6Event(input.event, input.friendId);
  try {
    await fireEvent(db, v6Event.eventType, v6Event.payload, input.accessToken, input.lineAccountId);
  } catch (error) {
    try {
      await markEcDispatch(db, {
        eventId: input.eventId, subscriber: 'v6', status: 'failed',
        error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
        idempotencyKey, now: input.now,
      });
    } catch (markError) {
      console.error(`[ec-event] v6 dispatch ledger failed event=${input.externalEventId}`, markError);
    }
    throw error;
  }
  await markEcDispatch(db, {
    eventId: input.eventId, subscriber: 'v6', status: 'sent', idempotencyKey, now: input.now,
  });
}

/** 定義の公開版configから文面項目を取る。文字列以外・未設定は null へ畳む。 */
function notificationText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}


export type EcEventOutcome = 'processed' | 'skipped' | 'identity_pending' | 'duplicate';

export async function processEcEvent(
  db: D1Database,
  input: {
    account: NonNullable<Awaited<ReturnType<typeof getLineAccountById>>>;
    lineAccountId: string;
    event: EcEvent;
    eventRowId: string;
    now: string;
  },
): Promise<EcEventOutcome> {
  const { account, lineAccountId, event, now } = input;
  const row = { id: input.eventRowId };
  const claim = await db.prepare(
    `UPDATE ec_events SET status = 'processing', error_message = NULL, updated_at = ?
     WHERE id = ? AND status IN ('received', 'failed')`,
  ).bind(now, row.id).run();
  if (!claim.meta.changes) return 'duplicate';

  // 受付口では弾いているが、保存済み payload の直叩きに備えてここでも守る。
  // 無いまま進むと誰宛か分からない送信になる。
  if (!event.line_user_id) {
    await db.prepare(
      `UPDATE ec_events SET status = 'identity_pending', error_message = 'line_identity_unmatched', updated_at = ? WHERE id = ?`,
    ).bind(now, row.id).run();
    await setEcActionExecutionStatus(db, {
      eventId: row.id, lineAccountId, status: 'skipped',
      errorCode: 'line_identity_unmatched', errorMessageSafe: 'LINEの友だちが見つかりません', now,
    });
    return 'identity_pending';
  }

  {
    // N-330 (#943): 顧客通知定義があるイベントは定義だけが正本。published の
    // ときだけ送り、文面は確定済み版の config から取る。定義が無いイベント
    // だけ従来の ec_notification_settings を見る(未移行の互換)。
    const notificationSource = await getCustomerNotificationSource(
      db, lineAccountId, event.event_type,
    );
    const ledgerBase = {
      lineAccountId,
      sourceEventType: event.event_type,
      sourceEventId: event.event_id,
      metadata: { orderNumber: event.order?.number ?? null },
      definitionId: notificationSource?.definitionId ?? null,
      definitionVersionId: notificationSource?.versionId ?? null,
    } as const;
    const friend = await getFriendByLineUserIdForAccount(db, event.line_user_id, lineAccountId);
    if (!friend || !friend.is_following) {
      await db.prepare(
        `UPDATE ec_events SET status = ?, error_message = ?, processed_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(
        friend ? 'skipped' : 'identity_pending',
        friend ? 'friend_not_following' : 'line_identity_unmatched',
        friend ? now : null,
        now,
        row.id,
      ).run();
      // N-328 (#943): 送れなかった結果も共通送信台帳へ残す。プロフィール同期は
      // 顧客通知を出さないので台帳へは書かない。
      if (event.event_type !== 'ec.customer.profile_updated') {
        await recordCustomerEcDelivery(db, {
          ...ledgerBase,
          recipientId: friend?.id ?? event.line_user_id,
          idempotencyKey: await ecNotificationRetryKey(lineAccountId, event.event_id),
          attemptedSend: false,
          finish: {
            kind: 'excluded',
            errorCode: friend ? 'friend_not_following' : 'line_identity_unmatched',
            errorMessage: friend ? 'LINEの友だちが現在フォローしていません' : 'LINEの友だちが見つかりません',
          },
        });
      }
      await setEcActionExecutionStatus(db, {
        eventId: row.id, lineAccountId, status: 'skipped',
        errorCode: friend ? 'friend_not_following' : 'line_identity_unmatched',
        errorMessageSafe: friend ? 'LINEの友だちが現在フォローしていません' : 'LINEの友だちが見つかりません',
        now,
      });
      return friend ? 'skipped' : 'identity_pending';
    }

    if (friend.line_account_id !== lineAccountId) throw new Error('EC event account mismatch');
    await attachEcOrderFriend(db, { eventId: row.id, lineAccountId, friendId: friend.id, now });
    const accessToken = account.channel_access_token;
    if (!accessToken) throw new Error('LINE access token is not configured');

    await syncMemberSnapshot(db, friend.id, event, now);
    await syncNenEcTags(db, friend.id);

    // 注文の確定を成果計測へ接続する(#648)。「注文が確定した」を起点に選んだ
    // 地点は、ここを通らないと 0 件のままになる。
    //
    // この位置は、この後のどの出口(通知停止で skipped / 通常の processed)を
    // 通っても必ず通る。冪等キーは EC 側の event_id なので、同じ注文の再送
    // (台帳 claim をすり抜けた再試行を含む)でも二度数えない。
    // 記録に失敗しても注文処理は続ける(通知を落とさない)。
    if (event.event_type === 'ec.order.confirmed') {
      // 注文にクーポンが使われていれば、発行台帳の used_at を立てる。
      // EC側のクーポン利用台帳とは別物なので、ここが記録口の1つになる
      // （もう1つは /api/integrations/eccube/coupon-usages）。冪等（used_at IS NULL の行だけ）。
      const couponCode = typeof event.order?.coupon_code === 'string' ? event.order.coupon_code.trim() : '';
      if (couponCode) {
        await db.prepare(
          `UPDATE nen_coupon_issues SET used_at = ? WHERE coupon_code = ? AND used_at IS NULL`,
        ).bind(event.occurred_at.slice(0, 19).replace('T', ' '), couponCode).run();
      }
      try {
        await recordConversionSourceEvent(db, {
          sourceType: 'ec_order_confirmed',
          lineAccountId,
          friendId: friend.id,
          sourceEventId: event.event_id,
          metadata: { ecEventId: event.event_id, orderNumber: event.order?.number ?? null },
        });
      } catch (error) {
        console.error(`[ec-event] conversion record failed event=${event.event_id}`, error);
      }
    }

    if (event.event_type === 'ec.customer.profile_updated') {
      const { syncNenPetProfiles } = await import('./nen-engagement.js');
      await syncNenPetProfiles(db, event, friend.id);
      await syncNenPetTags(db, friend.id);
      await db.prepare(
        `UPDATE ec_events SET friend_id = ?, status = 'processed', processed_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(friend.id, now, now, row.id).run();
      await fireEcV6Event(db, {
        eventId: row.id, lineAccountId, externalEventId: event.event_id,
        event, friendId: friend.id, accessToken, now,
      });
      await setEcActionExecutionStatus(db, {
        eventId: row.id, lineAccountId, status: 'succeeded', now,
      });
      return 'processed';
    }

    const setting = notificationSource
      ? {
          // 正本の定義があるときは、公開中の版だけを送る。下書き・停止は送らない。
          is_enabled: notificationSource.status === 'published' ? 1 : 0,
          title_override: notificationText(notificationSource.config.title) ?? notificationSource.name,
          intro_text: notificationText(notificationSource.config.introText),
          outro_text: notificationText(notificationSource.config.outroText),
          button_label: notificationText(notificationSource.config.buttonLabel),
          button_url: notificationText(notificationSource.config.buttonUrl),
          image_url: notificationText(notificationSource.config.imageUrl),
        }
      : await db.prepare(
          `SELECT COALESCE(a.is_enabled, s.is_enabled) AS is_enabled,
                  CASE WHEN a.line_account_id IS NULL THEN s.title_override ELSE a.title_override END AS title_override,
                  CASE WHEN a.line_account_id IS NULL THEN s.intro_text ELSE a.intro_text END AS intro_text,
                  CASE WHEN a.line_account_id IS NULL THEN s.outro_text ELSE a.outro_text END AS outro_text,
                  CASE WHEN a.line_account_id IS NULL THEN s.button_label ELSE a.button_label END AS button_label,
                  CASE WHEN a.line_account_id IS NULL THEN s.button_url ELSE a.button_url END AS button_url,
                  CASE WHEN a.line_account_id IS NULL THEN s.image_url ELSE a.image_url END AS image_url
             FROM ec_notification_settings s
             LEFT JOIN ec_notification_account_settings a
               ON a.event_type = s.event_type AND a.line_account_id = ?
            WHERE s.event_type = ?`,
        ).bind(lineAccountId, event.event_type).first<{
          is_enabled: number; title_override: string | null; intro_text: string | null; outro_text: string | null;
          button_label: string | null; button_url: string | null; image_url: string | null;
        }>();

    if (event.event_type === 'ec.order.shipped') {
      await enqueuePostShippingFollowUps(
        db, event, friend.id, account.id,
      );
    }

    // Transactional delivery can be paused independently while automation
    // events continue to fire for segmentation and step campaigns.
    if (setting?.is_enabled === 0) {
      await db.prepare(
        `UPDATE ec_events SET friend_id = ?, status = 'skipped', error_message = 'notification_disabled', processed_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(friend.id, now, now, row.id).run();
      // N-328 (#943): 通知停止(定義の draft/stopped、旧設定のOFF)も共通台帳へ
      // 「対象外」として残す。この処理では送っていないので試行は増やさない。
      await recordCustomerEcDelivery(db, {
        ...ledgerBase,
        recipientId: friend.id,
        idempotencyKey: await ecNotificationRetryKey(lineAccountId, event.event_id),
        attemptedSend: false,
        finish: {
          kind: 'excluded',
          errorCode: 'notification_disabled',
          errorMessage: 'この通知は設定で停止されています',
        },
      });
      await fireEcV6Event(db, {
        eventId: row.id, lineAccountId, externalEventId: event.event_id,
        event, friendId: friend.id, accessToken, now,
      });
      await setEcActionExecutionStatus(db, {
        eventId: row.id, lineAccountId, status: 'skipped',
        errorCode: 'notification_disabled', errorMessageSafe: 'この通知は設定で停止されています', now,
      });
      return 'skipped';
    }

    // 通知設定の見出し・前後の文章にも {{var.*}} を書ける。消えた
    // 共通情報は空文字へ置き換えず、この通知を止める（台帳に残る）。
    const { expandSendCommonVars } = await import('./interpolation-context.js');
    const ecSource = { kind: 'notification' as const, id: row.id };
    const ecCtx = { lineAccountId, friendId: friend.id };
    const expandEcField = (value: string | null) =>
      value ? expandSendCommonVars(db, value, ecSource, ecCtx) : Promise.resolve(value);
    const [ecTitle, ecIntroText, ecOutroText] = await Promise.all([
      expandEcField(setting?.title_override ?? null),
      expandEcField(setting?.intro_text ?? null),
      expandEcField(setting?.outro_text ?? null),
    ]);
    const message = ecFlexMessage(event, {
      title: ecTitle ?? undefined,
      introText: ecIntroText ?? undefined,
      outroText: ecOutroText ?? undefined,
      buttonLabel: setting?.button_label,
      buttonUrl: setting?.button_url,
      imageUrl: setting?.image_url,
    });
    // 通知は購読先別の台帳で管理する。照合契約:
    // - sent → 送らない(再試行・並行とも)
    // - failed/なし → 固定retry keyで送る
    // - pending(送達不明: 送信後に台帳書込が落ちた) → 同じ固定keyで送り直す。
    //   LINE側がキーで重複を抑える(X-Line-Retry-Key、受理済みは409)ため安全。
    const lineClient = new LineClient(accessToken);
    // N-328 (#943): 共通台帳の冪等キーはLINEへ渡す固定retry keyと同じ値。
    // イベント再送や再試行で新しい送達行を作らず同じ行を確定する。
    const retryKey = await ecNotificationRetryKey(lineAccountId, event.event_id);
    if (await getEcDispatchStatus(db, row.id, 'notification') !== 'sent') {
      const notificationKey = ecDispatchIdempotencyKey(lineAccountId, event.event_id, 'notification');
      await markEcDispatch(db, {
        eventId: row.id, subscriber: 'notification', status: 'pending',
        idempotencyKey: notificationKey, now,
      });
      let providerRequestId: string | null = null;
      try {
        const pushed = await lineClient.pushMessageWithRequestId(event.line_user_id, [message], retryKey);
        providerRequestId = pushed.requestId;
      } catch (pushError) {
        try {
          await markEcDispatch(db, {
            eventId: row.id, subscriber: 'notification', status: 'failed',
            error: pushError instanceof Error ? pushError.message.slice(0, 500) : 'Unknown error',
            idempotencyKey: notificationKey, now,
          });
        } catch (markError) {
          console.error(`[ec-event] notification ledger failed event=${event.event_id}`, markError);
        }
        // N-328: 送れなかった結果も共通送信台帳へ残す。秘密値を含まない
        // 安全な分類だけ書く。
        const classified = classifyExternalDeliveryError(pushError);
        await recordCustomerEcDelivery(db, {
          ...ledgerBase,
          recipientId: friend.id,
          idempotencyKey: retryKey,
          attemptedSend: true,
          finish: { kind: 'failed', errorCode: classified.code, errorMessage: classified.message },
        });
        throw pushError;
      }
      // N-328: 共通台帳を先に確定してから購読台帳を sent にする。台帳の
      // 書込が落ちた場合はイベントごと失敗へ回り、再処理で同じ冪等キーの
      // 行を復旧する(既に受理済みなら送達状態は戻らない)。
      await recordCustomerEcDelivery(db, {
        ...ledgerBase,
        recipientId: friend.id,
        idempotencyKey: retryKey,
        attemptedSend: true,
        finish: { kind: 'accepted', providerRequestId },
      });
      await markEcDispatch(db, {
        eventId: row.id, subscriber: 'notification', status: 'sent',
        idempotencyKey: notificationKey, now,
      });
      await logOutgoingMessage(db, {
        friendId: friend.id,
        messageType: message.type,
        content: message.type === 'text' ? message.text : JSON.stringify(message),
        deliveryType: 'push',
        source: 'ec_transactional',
        lineAccountId: account.id,
      });
    } else {
      // 送信済みだが共通台帳への書込だけ落ちていた分をここで復旧する。
      // 冪等キーが同じため、既に行があれば状態は変わらない。
      await recordCustomerEcDelivery(db, {
        ...ledgerBase,
        recipientId: friend.id,
        idempotencyKey: retryKey,
        attemptedSend: false,
        finish: { kind: 'accepted' },
      });
    }

    await db.prepare(
      `UPDATE ec_events SET friend_id = ?, status = 'processed', processed_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(friend.id, now, now, row.id).run();

    await fireEcV6Event(db, {
      eventId: row.id, lineAccountId, externalEventId: event.event_id,
      event, friendId: friend.id, accessToken, now,
    });

    await setEcActionExecutionStatus(db, {
      eventId: row.id, lineAccountId, status: 'succeeded', now,
    });

    return 'processed';
  }
}

/**
 * 処理に失敗したイベントを、再試行の待ち行列へ回す。上限に達したら
 * dead letter（permanent_failed）へ倒す。回数の計算は
 * setEcActionExecutionStatus が担う。
 */
export async function markEcEventFailed(
  db: D1Database,
  input: {
    eventRowId: string;
    externalEventId: string;
    lineAccountId: string;
    message: string;
    now: string;
  },
): Promise<void> {
  await db.prepare(
    `UPDATE ec_events SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`,
  ).bind(input.message, input.now, input.eventRowId).run();
  await setEcActionExecutionStatus(db, {
    eventId: input.eventRowId,
    lineAccountId: input.lineAccountId,
    status: 'retryable_failed',
    errorCode: 'event_processing_failed',
    errorMessageSafe: 'ECの処理を完了できませんでした',
    now: input.now,
  }).catch(() => undefined);
  console.error(`[ec-event] processing failed event=${input.externalEventId}`);
}
