import {
  getRichMenuAreaTapTarget,
  getTemplateById,
  addScore,
  recordRichMenuAreaTap,
  type RichMenuAreaTapTarget,
} from '@line-crm/db';
import type { LineClient, Message } from '@line-crm/line-sdk';
import { attachTagAndFireSideEffects } from './friend-tag-attach.js';
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

/**
 * テンプレートの中身を、LINE に送れる形にする。
 *
 * 同じ変換がオートメーションの「メッセージを送る」にもある。共通の変換関数が
 * codex/development に入ったら、そちらへ寄せる。
 *
 * altText はテンプレート名を使う。通知や機種によっては本文が出ず、これしか
 * 見えないことがあるので、「メッセージ」のような固定文言にはしない。
 */
function buildTemplateMessage(
  messageType: string,
  content: string,
  templateName: string,
): Message | null {
  try {
    if (messageType === 'flex') {
      return { type: 'flex', altText: templateName, contents: JSON.parse(content) };
    }
    if (messageType === 'image') {
      const parsed = JSON.parse(content) as {
        originalContentUrl?: string;
        previewImageUrl?: string;
      };
      if (!parsed.originalContentUrl || !parsed.previewImageUrl) return null;
      return {
        type: 'image',
        originalContentUrl: parsed.originalContentUrl,
        previewImageUrl: parsed.previewImageUrl,
      };
    }
    if (messageType === 'carousel') {
      // カルーセルは Flex ではなく template メッセージ。Flex として送ると 400 になり、
      // 400 は「直らない失敗」として扱われるので、その人への配信ごと止まる。
      const columns = JSON.parse(content) as unknown;
      if (!Array.isArray(columns) || columns.length === 0) return null;
      return {
        type: 'template',
        altText: templateName,
        template: { type: 'carousel', columns },
      };
    }
  } catch {
    // 中身が壊れているテンプレートは送らない。文字化けした JSON を
    // そのまま本文として送るより、送らないほうが害が小さい。
    return null;
  }
  return { type: 'text', text: content };
}

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

  // 押された記録。一覧の「今月のタップ」「最多タップ」はこれを数えている。
  // 記録に失敗しても、下のタグ付けやメッセージ送信は続ける。
  // 数え損ねるより、押した人への反応が返らないほうが困る。
  try {
    await recordRichMenuAreaTap(db, {
      areaId: target.areaId,
      pageId: target.pageId,
      groupId: target.groupId,
      areaLabel: target.label,
      friendId: friend.id,
      lineAccountId,
    });
  } catch (err) {
    console.error('[richMenuTap] failed to record tap', err);
  }

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
      const message = tpl
        ? buildTemplateMessage(tpl.message_type, tpl.message_content, tpl.name)
        : null;
      if (tpl && message) {
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
      } else if (!tpl) {
        console.warn(`[richMenuTap] template ${target.templateId} not found`);
      } else {
        console.warn(`[richMenuTap] template ${target.templateId} has unusable content`);
      }
    } catch (err) {
      console.error('[richMenuTap] failed to send template', err);
    }
  }

  return { target, replyTokenConsumed };
}
