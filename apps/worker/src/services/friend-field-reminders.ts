import {
  getFriendFieldReminders,
  getFriendsWithFieldValue,
  hasReminderEnrollment,
  enrollFriendInReminder,
} from '@line-crm/db';
import { nextAnniversary, isSameJstDay, toJstParts } from '@line-crm/shared';

/**
 * 友だち情報欄の日付を見て、リマインダのゴール日を立てる。
 *
 * 画面には前から「誕生日や次回お届け日など、友だち情報欄の日付を起点にできます」と
 * 書いてあったが、その経路が無かった。これで誕生日・次回お届け日・契約更新日が
 * 作れるようになる。
 *
 * 毎日1回動かす。やることは「ゴール日を立てる」だけで、送るのは
 * リマインダ配信（processReminderDeliveries）の仕事。分けているのは、
 * 「3日前に送る」通を送るには、ゴール日が**その3日以上前**に立っている
 * 必要があるため。当日に立てても、前もって送る通が1つも間に合わない。
 *
 * **毎年くり返す設定（誕生日）は、年で比べない。** 値は `1990-05-03` のように
 * 過去の日付で入っているので、年ごと比べると一度も当たらない。月日だけを見て
 * 「次に来るその日」を出す。
 */
export async function processFriendFieldReminders(
  db: D1Database,
  now: Date = new Date(),
): Promise<{ enrolled: number; skipped: number }> {
  let enrolled = 0;
  let skipped = 0;

  const reminders = await getFriendFieldReminders(db);
  if (reminders.length === 0) return { enrolled, skipped };

  for (const reminder of reminders) {
    if (!reminder.trigger_field_id) continue;
    try {
      const friends = await getFriendsWithFieldValue(db, reminder.trigger_field_id);

      for (const friend of friends) {
        // 毎年くり返すなら「次に来るその日」、くり返さないなら「その日が今日か」。
        const targetDate = reminder.repeat_yearly === 1
          ? nextAnniversary(friend.value, now)
          : isSameJstDay(friend.value, now)
            ? toJstParts(now).date
            : null;
        if (!targetDate) {
          skipped++;
          continue;
        }

        // ゴール日は日本時間の 0:00 として持つ。何時にするかは通ごとの設定で決まる。
        const targetDateTime = `${targetDate}T00:00:00+09:00`;

        if (await hasReminderEnrollment(db, friend.friend_id, reminder.id, targetDateTime)) {
          skipped++;
          continue;
        }

        await enrollFriendInReminder(db, {
          friendId: friend.friend_id,
          reminderId: reminder.id,
          targetDate: targetDateTime,
        });
        enrolled++;
      }
    } catch (err) {
      // 1つのリマインダで転んでも、残りは続ける。
      console.error(`[friendFieldReminders] reminder ${reminder.id} failed`, err);
    }
  }

  return { enrolled, skipped };
}
