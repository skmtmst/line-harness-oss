/**
 * リマインダ配信処理 — cronトリガーで定期実行
 *
 * ゴール日時から決まる配信時刻が現在時刻以前で、まだ配信されていない通を送る。
 * 配信時刻の決め方は2つある（153）。
 *   'time'      … ゴールの○日前の●時
 *   'countdown' … ゴールから何分ずらすか
 * どちらで動くかはリマインダごとに決まっていて、途中で変わらない。
 */

import {
  getPendingReminderDeliveries,
  completeReminderIfDone,
  getFriendById,
  jstNow,
} from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';
import { addJitter, sleep } from './stealth.js';
import { buildMessage } from './line-message.js';
import { expandVariables, resolveMetadata } from './step-delivery.js';
import { resolveInterpolationExtra } from './interpolation-context.js';
import { resolveReminderSendAt } from '@line-crm/shared';

export async function processReminderDeliveries(
  db: D1Database,
  lineClient: LineClient,
): Promise<void> {
  const now = new Date();
  const pending = await getPendingReminderDeliveries(db);

  /*
   * 配信時刻が来た通だけに絞る。
   *
   * 時刻の決め方は2つあり（153）、どちらもゴール日時を起点にする。
   *   'time'      … ゴールの○日前の●時（日本時間の暦で数える）
   *   'countdown' … ゴールから何分ずらすか
   * 判定に使う「いま」と、本文の {{date}} に使う「届く日時」を分けているのは、
   * cron が遅れて動いても本文の日付がずれないようにするため。
   */
  const dueReminders = pending
    .map((fr) => ({
      ...fr,
      steps: fr.steps.filter(
        (step) =>
          resolveReminderSendAt(
            new Date(fr.target_date),
            {
              offsetDays: step.offset_days,
              sendAtTime: step.send_at_time,
              offsetMinutes: step.offset_minutes,
            },
            fr.delivery_mode === 'time' ? 'time' : 'countdown',
          ).getTime() <= now.getTime(),
      ),
    }))
    .filter((fr) => fr.steps.length > 0);

  for (let i = 0; i < dueReminders.length; i++) {
    const fr = dueReminders[i];
    try {
      // ステルス: バースト回避のためランダム遅延
      if (i > 0) {
        await sleep(addJitter(50, 200));
      }

      const friend = await getFriendById(db, fr.friend_id);
      if (!friend || !friend.is_following) {
        continue;
      }

      // Resolve correct lineClient for this friend's account
      let deliveryClient = lineClient;
      const friendAccountId = (friend as unknown as Record<string, string | null>).line_account_id;
      if (friendAccountId) {
        const { getLineAccountById } = await import('@line-crm/db');
        const account = await getLineAccountById(db, friendAccountId);
        if (account) {
          const { LineClient: LC } = await import('@line-crm/line-sdk');
          deliveryClient = new LC(account.channel_access_token);
        }
      }

      for (const step of fr.steps) {
        /*
         * 差し込みを通す。
         *
         * 作成画面は「{{name}} や {{予約日時}} は一人ひとりの内容へ置き換わります」と
         * 書いているのに、通していなかった。{{name}} が文字のまま相手に届いていた。
         *
         * {{date}} の起点は「この通が届く日時」。いまの時刻ではなく、ゴール日時から
         * 決まる配信時刻を渡す。cron が遅れて動いても、本文の日付がずれない。
         */
        const sendAt = resolveReminderSendAt(
          new Date(fr.target_date),
          {
            offsetDays: step.offset_days,
            sendAtTime: step.send_at_time,
            offsetMinutes: step.offset_minutes,
          },
          fr.delivery_mode === 'time' ? 'time' : 'countdown',
        );
        const resolvedMeta = await resolveMetadata(db, friend);
        const extra = await resolveInterpolationExtra(db, friend.id, step.message_content);
        const expanded = expandVariables(
          step.message_content,
          { ...friend, metadata: resolvedMeta },
          undefined,
          step.message_type,
          { ...extra, deliveredAt: sendAt },
        );
        const message = buildMessage(step.message_type, expanded);
        await deliveryClient.pushMessage(friend.line_user_id, [message]);

        // Mark as delivered AFTER successful send.
        // INSERT OR IGNORE prevents duplicate records if parallel workers both sent.
        // Prefer possible duplicate send over silent message loss on crash.
        const lockId = crypto.randomUUID();
        await db
          .prepare(`INSERT OR IGNORE INTO friend_reminder_deliveries (id, friend_reminder_id, reminder_step_id) VALUES (?, ?, ?)`)
          .bind(lockId, fr.id, step.id)
          .run();

        // メッセージログに記録
        const logId = crypto.randomUUID();
        await db
          .prepare(
            `INSERT INTO messages_log (id, friend_id, direction, message_type, content, source, created_at)
             VALUES (?, ?, 'outgoing', ?, ?, 'reminder', ?)`,
          )
          .bind(logId, friend.id, step.message_type, step.message_content, jstNow())
          .run();
      }

      // 全ステップ配信済みかチェック
      await completeReminderIfDone(db, fr.id, fr.reminder_id);
    } catch (err) {
      console.error(`リマインダ配信エラー (friend_reminder ${fr.id}):`, err);
    }
  }
}
