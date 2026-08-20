import {
  getTemplateById,
  recordCarouselTap,
  hasCarouselTap,
} from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';
import { runActionRows, type ScenarioActionRow } from './scenario-actions.js';
import { pickCarouselActions, type CarouselTapPostback } from '../lib/carousel-tap.js';
import { logOutgoingMessage } from './event-bus.js';

/**
 * カルーセルの選択肢が押されたときに、こちら側でやること。
 *
 *   ・押された回数を記録する
 *   ・「1人につき1回まで」の制限にかかっていれば、決めたテキストを返して終わる
 *   ・設定されたアクション（タグ付け・友だち情報・対応マーク・シナリオ・共通情報）を順に実行する
 *
 * アクションの実行は、シナリオ・自動応答と同じ runActionRows を呼ぶ。
 * カルーセル専用の実行は作らない。
 */

export type CarouselTapResult =
  | { kind: 'not_found' }
  | { kind: 'blocked'; replyTokenConsumed: boolean }
  | { kind: 'ran'; executed: number };

/** 保存されている形を、アクション実行が受け取れる行に読み替える。 */
function toActionRows(stored: unknown[]): ScenarioActionRow[] {
  return stored.flatMap((item, index): ScenarioActionRow[] => {
    if (!item || typeof item !== 'object') return [];
    const r = item as Record<string, unknown>;
    const actionType = r.actionType ?? r.action_type;
    const config = r.config ?? r.config_json;
    if (typeof actionType !== 'string' || config === undefined) return [];
    return [
      {
        id: `carousel-action-${index}`,
        // カルーセルはシナリオに属さない。「1つ前のシナリオを再開」の起点が無い。
        scenario_id: '',
        hook: 'step_sent',
        step_id: null,
        choice_index: null,
        sort_order: index,
        action_type: actionType as ScenarioActionRow['action_type'],
        config_json: typeof config === 'string' ? config : JSON.stringify(config),
        condition_json:
          typeof r.condition === 'string'
            ? r.condition
            : r.condition
              ? JSON.stringify(r.condition)
              : null,
        // 押されるたびに動かす。1回だけにしたい場合は、カルーセル側の
        // 「押せる回数」で止める。
        repeat_on_refire: 1,
      },
    ];
  });
}

export async function handleCarouselTap(
  db: D1Database,
  lineClient: LineClient,
  friend: { id: string; line_user_id: string },
  tap: CarouselTapPostback,
  options: { lineAccountId?: string | null; replyToken?: string },
): Promise<CarouselTapResult> {
  const template = await getTemplateById(db, tap.templateId);
  if (!template) return { kind: 'not_found' };

  const lineAccountId = options.lineAccountId ?? null;

  /*
   * 押せる回数の制限。
   *
   * 記録より先に見る。記録してから見ると、1回目の押下で自分の記録に
   * 引っかかって、いきなり「すでに押されています」になる。
   */
  if (template.carousel_tap_limit_mode === 'once') {
    const already = await hasCarouselTap(db, tap.templateId, friend.id);
    if (already) {
      let replyTokenConsumed = false;
      const text = template.carousel_tap_limit_text?.trim();
      if (text && options.replyToken) {
        try {
          await lineClient.replyMessage(options.replyToken, [{ type: 'text', text }]);
          replyTokenConsumed = true;
          await logOutgoingMessage(db, {
            friendId: friend.id,
            messageType: 'text',
            content: text,
            deliveryType: 'reply',
            source: 'carousel',
            lineAccountId,
          });
        } catch (err) {
          console.error('[carouselTap] failed to reply the limit message', err);
        }
      }
      return { kind: 'blocked', replyTokenConsumed };
    }
  }

  const stored = pickCarouselActions(
    template.carousel_actions_json,
    tap.columnIndex,
    tap.actionIndex,
  );
  const rows = toActionRows(stored);

  // 押された記録。制限の判定にも、どの選択肢が効いたかの集計にも使う。
  try {
    await recordCarouselTap(db, {
      templateId: tap.templateId,
      columnIndex: tap.columnIndex,
      actionIndex: tap.actionIndex,
      friendId: friend.id,
      lineAccountId,
    });
  } catch (err) {
    console.error('[carouselTap] failed to record the tap', err);
  }

  if (rows.length === 0) return { kind: 'ran', executed: 0 };

  try {
    const result = await runActionRows(db, rows, friend.id);
    return { kind: 'ran', executed: result.executed };
  } catch (err) {
    console.error('[carouselTap] failed to run actions', err);
    return { kind: 'ran', executed: 0 };
  }
}
