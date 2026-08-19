import {
  getRichMenuAreaTapTarget,
  getTemplateById,
  addScore,
  type RichMenuAreaTapTarget,
} from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';
import { attachTagAndFireSideEffects } from './friend-tag-attach.js';
import { buildMessage } from './line-message.js';
import { logOutgoingMessage } from './event-bus.js';

// リッチメニューのボタンが押されたときに、こちら側でやること。
//
//   ・設定されたタグを付ける
//   ・設定されたスコアを足す
//   ・「テンプレートを送る」ボタンなら、そのテンプレートを送る
//
// タグ付けとスコア加算は、既に他の経路（自動応答・オートメーション・計測リンク）で
// 使っている仕組みをそのまま呼ぶ。リッチメニュー用に別のタグ付けを作らない。
//
// ひとつ失敗しても残りは続ける。ボタンを押した人から見て「タグは付いたのに
// メッセージが来ない」ほうが、全部止まるより実害が小さい。

export type RichMenuTapResult = {
  /** 押されたボタンの設定。見つからなければ null（消されたボタンの取り違え等）。 */
  target: RichMenuAreaTapTarget | null;
  /** テンプレート送信で replyToken を使ったか。使った場合、下流は push に切り替える。 */
  replyTokenConsumed: boolean;
};

export async function handleRichMenuTap(
  db: D1Database,
  lineClient: LineClient,
  friend: { id: string; line_user_id: string },
  areaId: string,
  options: { lineAccountId?: string | null; replyToken?: string },
): Promise<RichMenuTapResult> {
  const target = await getRichMenuAreaTapTarget(db, areaId);
  if (!target) return { target: null, replyTokenConsumed: false };

  const lineAccountId = options.lineAccountId ?? null;

  for (const tagId of target.tagIds) {
    try {
      await attachTagAndFireSideEffects(db, friend.id, tagId);
    } catch (err) {
      console.error(`[richMenuTap] failed to attach tag ${tagId}`, err);
    }
  }

  if (typeof target.scoreChange === 'number' && target.scoreChange !== 0) {
    try {
      await addScore(db, {
        friendId: friend.id,
        scoreChange: target.scoreChange,
        reason: `リッチメニュー: ${target.label ?? 'ボタン'}`,
      });
    } catch (err) {
      console.error('[richMenuTap] failed to add score', err);
    }
  }

  let replyTokenConsumed = false;
  if (target.intent === 'template' && target.templateId) {
    try {
      const tpl = await getTemplateById(db, target.templateId);
      if (tpl) {
        const message = buildMessage(tpl.message_type, tpl.message_content);
        let deliveryType: 'reply' | 'push' = 'push';
        if (options.replyToken) {
          try {
            await lineClient.replyMessage(options.replyToken, [message]);
            deliveryType = 'reply';
            replyTokenConsumed = true;
          } catch (err) {
            // reply は 1 回きり・有効期限つき。失敗したら push で送り直す。
            console.warn('[richMenuTap] reply failed, falling back to push', err);
            await lineClient.pushMessage(friend.line_user_id, [message]);
          }
        } else {
          await lineClient.pushMessage(friend.line_user_id, [message]);
        }
        await logOutgoingMessage(db, {
          friendId: friend.id,
          messageType: message.type,
          content: tpl.message_content,
          deliveryType,
          source: 'rich_menu',
          lineAccountId,
        });
      } else {
        console.warn(`[richMenuTap] template ${target.templateId} not found`);
      }
    } catch (err) {
      console.error('[richMenuTap] failed to send template', err);
    }
  }

  return { target, replyTokenConsumed };
}
