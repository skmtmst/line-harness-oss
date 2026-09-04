import { extractFlexAltText } from '../utils/flex-alt-text.js';

/**
 * イベントバス — システム内イベントの発火と処理
 *
 * イベント発生時に以下を実行:
 * 1. アクティブな送信Webhookへ通知
 * 2. スコアリングルール適用
 * 3. 自動化ルール(IF-THEN)実行
 */

import {
  getActiveOutgoingWebhooksByEvent,
  applyScoring,
  getActiveAutomationsByEvent,
  createAutomationLog,
  addTagToFriend,
  removeTagFromFriend,
  enrollFriendInScenario,
  jstNow,
  getFriendScore,
  recordAnalyticsEvent,
  createWebhookInteraction,
  finishWebhookInteraction,
  type WebhookInteractionFailureReason,
} from '@line-crm/db';
import { deliverWebhook, recordDeliveryOutcome } from './outgoing-webhook-delivery.js';
import { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import { sendAdConversions } from './ad-conversion.js';
import { dispatchAutomationEventWithLogging } from './automation-triggers.js';
import { applyActionScoreEvent } from './action-score-events.js';

import {
  applyRichMenuTargeting,
  isTargetingTrigger,
} from './rich-menu-targeting.js';

export interface EventPayload {
  /** 再配達されても同じ出来事と判定できる、発生元の不変ID。 */
  sourceEventId?: string;
  /** 発生元の台帳名。分析の冪等キーに使う。 */
  sourceKind?: string;
  /** 推測せず、発生元が持つタイムゾーン付き時刻を渡す。 */
  occurredAt?: string;
  friendId?: string;
  eventData?: Record<string, unknown>;
  conversionEventName?: string;
  conversionValue?: number;
  replyToken?: string;
}

/**
 * Fire an event and run all registered handlers.
 *
 * Execution is split into two sequential phases so that score_threshold
 * conditions in automation rules see the score already updated by this event:
 *
 *   Phase 1 (concurrent): outgoing webhooks + scoring
 *   Phase 2 (concurrent): automations + notifications, with currentScore injected
 */
export async function fireEvent(
  db: D1Database,
  eventType: string,
  payload: EventPayload,
  lineAccessToken?: string,
  lineAccountId?: string | null,
): Promise<void> {
  let outgoingWebhookLineAccountId = lineAccountId;
  if (outgoingWebhookLineAccountId === undefined && payload.friendId) {
    const friend = await db
      .prepare('SELECT line_account_id FROM friends WHERE id = ?')
      .bind(payload.friendId)
      .first<{ line_account_id: string | null }>();
    outgoingWebhookLineAccountId = friend?.line_account_id;
  }

  // Phase 1: fire webhooks, apply scoring rules, and ad conversion postback concurrently.
  const phase1: Promise<unknown>[] = [
    fireOutgoingWebhooks(db, eventType, payload, outgoingWebhookLineAccountId),
    processScoring(db, eventType, payload, outgoingWebhookLineAccountId, lineAccessToken),
  ];
  if (payload.friendId && payload.conversionEventName) {
    phase1.push(
      sendAdConversions(db, payload.friendId, payload.conversionEventName, payload.conversionValue),
    );
  }
  await Promise.allSettled(phase1);

  // Build an enriched payload with the freshly-updated score.
  const enrichedPayload: EventPayload = payload.friendId
    ? {
        ...payload,
        eventData: {
          ...payload.eventData,
          currentScore: await getFriendScore(db, payload.friendId),
        },
      }
      : payload;

  // 業務の正本は既存台帳のまま。発生元ID・時刻・アカウントがそろった事実だけを
  // 分析用の追記台帳へ写す。失敗しても送信やタグ処理は巻き添えにしない。
  if (lineAccountId && enrichedPayload.sourceEventId && enrichedPayload.occurredAt) {
    const mappedType = eventType === 'cv_fire'
      ? 'conversion_created'
      : eventType === 'calendar_booked'
        ? 'booking_confirmed'
        : eventType;
    try {
      await recordAnalyticsEvent(db, {
        lineAccountId,
        friendId: enrichedPayload.friendId,
        eventType: mappedType,
        sourceKind: enrichedPayload.sourceKind ?? 'event_bus',
        sourceId: enrichedPayload.sourceEventId,
        occurredAt: enrichedPayload.occurredAt,
        dimensions: enrichedPayload.eventData,
        numericValue: enrichedPayload.conversionValue,
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: 'analytics_event_record_failed',
        line_account_id: lineAccountId,
        event_type: mappedType,
        reason: error instanceof Error ? error.message : 'unknown',
      }));
    }
  }

  // Phase 2: evaluate automations.
  await processAutomations(db, eventType, enrichedPayload, lineAccessToken, lineAccountId);

  // V6は発生元の不変IDとアカウントが分かるイベントだけを受け付ける。
  // 旧イベントの時刻などからIDを推測すると再配達で二重実行になるため、
  // 接続元が明示していないイベントは移行PRで接続するまで実行しない。
  if (lineAccountId && enrichedPayload.sourceEventId) {
    await dispatchAutomationEventWithLogging(db, {
      lineAccountId,
      eventType,
      sourceEventId: enrichedPayload.sourceEventId,
      friendId: enrichedPayload.friendId,
      eventData: enrichedPayload.eventData,
      lineAccessToken,
    });
  }

  // Phase 3: リッチメニューの出し分けを見直す。
  //
  // オートメーションの後に置くのは、オートメーションでタグを付ける構成が
  // 多いため。先に見直すと、いま付いたばかりのタグが条件に反映されない。
  await reevaluateRichMenuTargeting(db, eventType, enrichedPayload, lineAccessToken, lineAccountId);
}

/**
 * 友だちごとに出すメニューを選び直す。
 *
 * 失敗しても呼び出し元には投げ返さない。メニューの出し分けは、そのとき
 * 起きていること（メッセージへの返信やタグ付け）の付随処理なので、
 * ここで転ぶと本体まで巻き添えになる。
 */
async function reevaluateRichMenuTargeting(
  db: D1Database,
  eventType: string,
  payload: EventPayload,
  lineAccessToken?: string,
  lineAccountId?: string | null,
): Promise<void> {
  if (!isTargetingTrigger(eventType)) return;
  if (!payload.friendId || !lineAccessToken || !lineAccountId) return;
  try {
    await applyRichMenuTargeting(db, payload.friendId, lineAccountId, lineAccessToken);
  } catch (err) {
    console.error('[eventBus] rich menu targeting failed:', err);
  }
}

/** 送信Webhookへの通知 */
async function fireOutgoingWebhooks(
  db: D1Database,
  eventType: string,
  payload: EventPayload,
  lineAccountId?: string | null,
): Promise<void> {
  try {
    if (lineAccountId == null) {
      console.log(JSON.stringify({
        event: 'outgoing_webhook_line_account_unknown',
        eventType,
        hasFriendId: Boolean(payload.friendId),
      }));
    }
    const webhooks = await getActiveOutgoingWebhooksByEvent(db, eventType, lineAccountId);
    for (const wh of webhooks) {
      let interactionId: string | null = null;
      const started = Date.now();
      try {
        const body = JSON.stringify({
          event: eventType,
          timestamp: jstNow(),
          data: payload,
        });
        const idempotencyKey = payload.sourceEventId
          ? `outgoing_webhook:${wh.id}:${payload.sourceKind ?? eventType}:${payload.sourceEventId}`
          : crypto.randomUUID();
        if (lineAccountId) {
          try {
            const interaction = await createWebhookInteraction(db, {
              lineAccountId,
              direction: 'outgoing',
              webhookId: wh.id,
              webhookName: wh.name,
              eventType,
              triggerSummary: eventType,
              requestBodyJson: body,
              idempotencyKey,
            });
            interactionId = interaction.id;
          } catch (logError) {
            // 記録の一時障害で、本体の外部通知まで止めない。
            console.error(`送信Webhook ${wh.id} の記録開始に失敗:`, logError);
          }
        }
        // 以前は fetch を投げっぱなしにしていて、相手が 500 を返しても
        // 成功として扱っていた（例外にならないため）。deliverWebhook は
        // 応答の状態まで見て、必要なら送り直す。
        const result = await deliverWebhook(wh, body, { idempotencyKey });
        if (!result.ok) {
          console.error(
            `送信Webhook ${wh.id} 失敗 (${result.attempts}回試行, 最後の応答=${result.lastStatus ?? '接続不可'})`,
          );
        }
        if (interactionId && lineAccountId) {
          try {
            await finishWebhookInteraction(db, interactionId, lineAccountId, {
              status: result.ok ? 'succeeded' : 'failed',
              responseStatus: result.lastStatus,
              attemptCount: result.attempts,
              durationMs: Date.now() - started,
              failureReason: result.ok ? null : outgoingFailureReason(result.lastStatus),
            });
          } catch (logError) {
            // 届いた通知を、台帳更新の失敗だけで「送信失敗」とは扱わない。
            console.error(`送信Webhook ${wh.id} の結果記録に失敗:`, logError);
          }
        }
        try {
          await recordDeliveryOutcome(db, wh.id, result.ok);
        } catch (outcomeError) {
          // 連続失敗数の更新は補助情報。配送結果そのものを巻き戻さない。
          console.error(`送信Webhook ${wh.id} の連続失敗数を更新できませんでした:`, outcomeError);
        }
      } catch (err) {
        if (interactionId && lineAccountId) {
          try {
            await finishWebhookInteraction(db, interactionId, lineAccountId, {
              status: 'failed',
              responseStatus: null,
              attemptCount: 1,
              durationMs: Date.now() - started,
              failureReason: 'unknown',
            });
          } catch (logError) {
            console.error(`送信Webhook ${wh.id} の失敗記録に失敗:`, logError);
          }
        }
        console.error(`送信Webhook ${wh.id} への通知失敗:`, err);
      }
    }
  } catch (err) {
    console.error('fireOutgoingWebhooks error:', err);
  }
}

function outgoingFailureReason(status: number | null): WebhookInteractionFailureReason {
  if (status === null) return 'connection_failed';
  if (status === 429) return 'response_429';
  if (status >= 500) return 'response_5xx';
  if (status >= 400) return 'response_4xx';
  return 'unknown';
}

/** スコアリングルール適用 */
async function processScoring(
  db: D1Database,
  eventType: string,
  payload: EventPayload,
  lineAccountId?: string | null,
  lineAccessToken?: string,
): Promise<void> {
  if (!payload.friendId) return;
  try {
    if (lineAccountId && payload.sourceEventId && payload.sourceKind && payload.occurredAt) {
      const v6 = await applyActionScoreEvent(db, {
        lineAccountId,
        friendId: payload.friendId,
        eventType,
        source: payload.sourceKind,
        sourceEventId: payload.sourceEventId,
        subjectKey: typeof payload.eventData?.subjectKey === 'string'
          ? payload.eventData.subjectKey
          : null,
        occurredAt: payload.occurredAt,
        lineAccessToken,
      });
      // 公開後または明示停止後は旧ルールへ戻さず、二重加点を防ぐ。
      if (v6.configured) return;
    }
    await applyScoring(db, payload.friendId, eventType);
  } catch (err) {
    console.error('processScoring error:', err);
  }
}

/** 自動化ルール(IF-THEN)実行 */
async function processAutomations(
  db: D1Database,
  eventType: string,
  payload: EventPayload,
  lineAccessToken?: string,
  lineAccountId?: string | null,
): Promise<void> {
  try {
    const allAutomations = await getActiveAutomationsByEvent(db, eventType);
    // Filter by account: match this account's automations + unassigned (backward compat)
    const automations = allAutomations.filter(
      (a) => !a.line_account_id || !lineAccountId || a.line_account_id === lineAccountId,
    );

    for (const automation of automations) {
      const conditions = JSON.parse(automation.conditions) as Record<string, unknown>;
      const actions = JSON.parse(automation.actions) as Array<{ type: string; params: Record<string, string> }>;

      // 条件チェック（簡易版: 条件が空なら常にマッチ）
      if (!matchConditions(conditions, payload)) continue;

      const results: Array<{ action: string; success: boolean; error?: string }> = [];

      for (const action of actions) {
        try {
          await executeAction(db, action, payload, lineAccessToken, lineAccountId);
          results.push({ action: action.type, success: true });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          results.push({ action: action.type, success: false, error: errorMsg });
        }
      }

      const allSuccess = results.every((r) => r.success);
      const anySuccess = results.some((r) => r.success);

      await createAutomationLog(db, {
        automationId: automation.id,
        friendId: payload.friendId,
        eventData: JSON.stringify(payload.eventData ?? {}),
        actionsResult: JSON.stringify(results),
        status: allSuccess ? 'success' : anySuccess ? 'partial' : 'failed',
      });
    }
  } catch (err) {
    console.error('processAutomations error:', err);
  }
}

/** 条件マッチング */
function matchConditions(
  conditions: Record<string, unknown>,
  payload: EventPayload,
): boolean {
  // 条件が空 → 常にマッチ
  if (Object.keys(conditions).length === 0) return true;

  // score_threshold チェック
  if (conditions.score_threshold !== undefined && payload.eventData) {
    const currentScore = payload.eventData.currentScore as number | undefined;
    if (currentScore !== undefined && currentScore < (conditions.score_threshold as number)) {
      return false;
    }
  }

  // tag_id チェック
  if (conditions.tag_id !== undefined && payload.eventData) {
    if (payload.eventData.tagId !== conditions.tag_id) return false;
  }

  // keyword チェック（message_received / postback_received イベント用）
  if (conditions.keyword !== undefined && payload.eventData) {
    const text = payload.eventData.text as string | undefined;
    if (!text || !text.includes(conditions.keyword as string)) return false;
  }

  // keyword_exact（完全一致）
  if (conditions.keyword_exact) {
    const rawText = payload.eventData?.text as string | undefined;
    const text = (rawText || '').trim();
    if (text !== conditions.keyword_exact) {
      return false;
    }
  }

  return true;
}

/** アクション実行 */
async function executeAction(
  db: D1Database,
  action: { type: string; params: Record<string, string> },
  payload: EventPayload,
  lineAccessToken?: string,
  lineAccountId?: string | null,
): Promise<void> {
  const friendId = payload.friendId;
  if (!friendId && action.type !== 'send_webhook') {
    throw new Error('friendId is required for this action');
  }

  switch (action.type) {
    case 'add_tag':
      await addTagToFriend(db, friendId!, action.params.tagId);
      break;

    case 'remove_tag':
      await removeTagFromFriend(db, friendId!, action.params.tagId);
      break;

    case 'start_scenario':
      await enrollFriendInScenario(db, friendId!, action.params.scenarioId);
      break;

    case 'send_message': {
      if (!lineAccessToken || !friendId) break;
      const friend = await db
        .prepare('SELECT line_user_id FROM friends WHERE id = ?')
        .bind(friendId)
        .first<{ line_user_id: string }>();
      if (!friend) break;
      const lineClient = new LineClient(lineAccessToken);

      // template_id が set なら templates から content/type を resolve、
      // なければ inline params を使う。template が見つからない (削除済 等) は
      // inline fallback (content が空なら下流の JSON.parse が throw → automation
      // 全体は partial 扱い)。
      let resolvedType = action.params.messageType || 'text';
      let resolvedContent = action.params.content ?? '';
      const tplId = action.params.template_id;
      if (tplId) {
        const { getTemplateById } = await import('@line-crm/db');
        const tpl = await getTemplateById(db, tplId);
        if (tpl) {
          resolvedType = tpl.message_type;
          resolvedContent = tpl.message_content;
        }
      }

      let msg: Message;
      let logContent: string;
      if (resolvedType === 'flex') {
        const contents = JSON.parse(resolvedContent);
        msg = { type: 'flex', altText: action.params.altText || extractFlexAltText(contents), contents };
        logContent = JSON.stringify(contents);
      } else if (resolvedType === 'image') {
        // template に "originalContentUrl" / "previewImageUrl" を持つ JSON が入る前提。
        // parse 失敗時は text fallback ではなく throw → automation 側で partial 扱いにする。
        const parsed = JSON.parse(resolvedContent) as { originalContentUrl: string; previewImageUrl: string };
        msg = {
          type: 'image',
          originalContentUrl: parsed.originalContentUrl,
          previewImageUrl: parsed.previewImageUrl,
        };
        logContent = JSON.stringify(parsed);
      } else {
        msg = { type: 'text', text: resolvedContent };
        logContent = resolvedContent;
      }

      let deliveryType: 'reply' | 'push';
      if (payload.replyToken) {
        try {
          await lineClient.replyMessage(payload.replyToken, [msg]);
          payload.replyToken = undefined;
          deliveryType = 'reply';
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const isTokenError = errMsg.includes('400') || errMsg.includes('Invalid reply token');
          if (isTokenError) {
            await lineClient.pushMessage(friend.line_user_id, [msg]);
            deliveryType = 'push';
          } else {
            throw err;
          }
        }
      } else {
        await lineClient.pushMessage(friend.line_user_id, [msg]);
        deliveryType = 'push';
      }

      // log は実際に送信した msg の type を反映する。msgType が 'image' 等で
      // else 経路に入った場合、actual message は text なので 'text' で記録すべき。
      // params の messageType をそのまま使うと admin 側で画像/Flex プレースホルダ
      // が出てしまう。
      await logOutgoingMessage(db, {
        friendId,
        messageType: msg.type,
        content: logContent,
        deliveryType,
        source: 'automation',
        lineAccountId,
      });
      break;
    }

    case 'send_webhook': {
      const url = action.params.url;
      if (url) {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ friendId, ...payload.eventData }),
        });
      }
      break;
    }

    case 'switch_rich_menu': {
      if (!lineAccessToken || !friendId) break;
      const friend = await db
        .prepare('SELECT line_user_id FROM friends WHERE id = ?')
        .bind(friendId)
        .first<{ line_user_id: string }>();
      if (!friend) break;
      const lineClient = new LineClient(lineAccessToken);
      await lineClient.linkRichMenuToUser(friend.line_user_id, action.params.richMenuId);
      break;
    }

    case 'remove_rich_menu': {
      if (!lineAccessToken || !friendId) break;
      const friend = await db
        .prepare('SELECT line_user_id FROM friends WHERE id = ?')
        .bind(friendId)
        .first<{ line_user_id: string }>();
      if (!friend) break;
      const lineClient = new LineClient(lineAccessToken);
      await lineClient.unlinkRichMenuFromUser(friend.line_user_id);
      break;
    }

    case 'set_metadata': {
      if (!friendId) break;
      const existing = await db
        .prepare('SELECT metadata FROM friends WHERE id = ?')
        .bind(friendId)
        .first<{ metadata: string }>();
      const current = JSON.parse(existing?.metadata || '{}') as Record<string, unknown>;
      // {{message}} を受信メッセージ内容に置換してからパース
      // JSON文字列内に埋め込むため、JSON仕様に準拠して全制御文字をエスケープ
      const escapeForJsonString = (s: string): string =>
        s
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t')
          .replace(/[\u0000-\u001f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
      const messageText = (payload.eventData?.text as string | undefined) || '';
      const raw = (action.params.data || '{}')
        .replace(/\{\{message\}\}/g, escapeForJsonString(messageText));
      const patch = JSON.parse(raw) as Record<string, unknown>;
      const merged = { ...current, ...patch };
      await db
        .prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(merged), jstNow(), friendId)
        .run();
      break;
    }

    default:
      console.warn(`未知のアクションタイプ: ${action.type}`);
  }
}

/** 送信メッセージを messages_log に記録（失敗しても例外を上げない） */
export async function logOutgoingMessage(
  db: D1Database,
  params: {
    friendId: string;
    messageType: string;
    content: string;
    deliveryType: 'reply' | 'push';
    source: string;
    lineAccountId?: string | null;
  },
): Promise<string | null> {
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, line_account_id, created_at)
         VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        params.friendId,
        params.messageType,
        params.content,
        params.deliveryType,
        params.source,
        params.lineAccountId ?? null,
        jstNow(),
      )
      .run();
    return id;
  } catch (err) {
    console.error('logOutgoingMessage failed:', err);
    return null;
  }
}
