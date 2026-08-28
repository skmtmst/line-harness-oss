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
  claimReminderDeliveryRun,
  completeReminderDeliveryRunStatement,
  getPendingReminderDeliveries,
  completeReminderIfDone,
  failReminderDeliveryRun,
  getFriendById,
  getLineAccountById,
  getTemplateById,
  skipReminderDeliveryRun,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { addJitter, sleep } from './stealth.js';
import { buildMessage } from './line-message.js';
import { expandVariables, resolveMetadata } from './step-delivery.js';
import { resolveInterpolationExtra } from './interpolation-context.js';
import { resolveReminderSendAt } from '@line-crm/shared';

const LEASE_MINUTES = 5;
// 初回送信 + 自動再試行5回。無限に回さず、6回目の失敗で手動確認へ渡す。
const MAX_RETRY_CYCLE_ATTEMPTS = 6;
const RETRY_DELAYS_MINUTES = [5, 15, 60, 180, 720] as const;

type PushClient = Pick<LineClient, 'pushMessageWithRequestId'>;

export interface ReminderDeliveryOptions {
  now?: Date;
  pause?: (milliseconds: number) => Promise<void>;
  resolveClient?: (accountId: string | null, fallback: PushClient) => Promise<PushClient>;
}

export interface ReminderDeliveryResult {
  succeeded: number;
  skipped: number;
  retrying: number;
  failed: number;
}

type SafeDeliveryError = { code: string; message: string; retryable: boolean };

/** Provider本文や秘密値を管理画面へ出さず、運用者が次の行動を選べる言葉へ直す。 */
export function classifyReminderDeliveryError(error: unknown): SafeDeliveryError {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw === 'REMINDER_LINE_ACCOUNT_NOT_FOUND') {
    return { code: 'line_account_not_found', message: '送信に使うLINEアカウント設定を確認してください。', retryable: false };
  }
  const status = Number(/LINE API error:\s*(\d{3})/.exec(raw)?.[1] ?? 0);
  if (status === 429) {
    return { code: 'line_rate_limited', message: 'LINE側の送信上限に達しました。時間を置いて再試行します。', retryable: true };
  }
  if ([401, 403].includes(status)) {
    return { code: 'line_authentication_failed', message: 'LINE連携の認証を確認してください。', retryable: false };
  }
  if ([400, 404, 422].includes(status)) {
    return { code: 'line_rejected', message: '送信内容または宛先を確認してください。', retryable: false };
  }
  if (status >= 500 || /fetch|network|timeout|socket/i.test(raw)) {
    return { code: 'line_temporary_failure', message: 'LINEへの送信に一時的に失敗しました。自動で再試行します。', retryable: true };
  }
  return { code: 'delivery_failed', message: '送信に失敗しました。設定とLINE連携を確認してください。', retryable: true };
}

async function defaultResolveClient(
  db: D1Database,
  accountId: string | null,
  _fallback: PushClient,
): Promise<PushClient> {
  // 所属不明の友だちを「既定アカウント」で送ると、別店舗名義の誤送信になる。
  // 古いデータは履歴へ残すが、送信元アカウントを推測しない。
  if (!accountId) throw new Error('REMINDER_LINE_ACCOUNT_NOT_FOUND');
  const account = await getLineAccountById(db, accountId);
  if (!account) throw new Error('REMINDER_LINE_ACCOUNT_NOT_FOUND');
  return new LineClient(account.channel_access_token);
}

function retryAtFor(runAttempt: number, now: Date, retryable: boolean): string | null {
  if (!retryable || runAttempt >= MAX_RETRY_CYCLE_ATTEMPTS) return null;
  const delay = RETRY_DELAYS_MINUTES[Math.max(0, runAttempt - 1)] ?? RETRY_DELAYS_MINUTES.at(-1)!;
  return new Date(now.getTime() + delay * 60_000).toISOString();
}

export async function processReminderDeliveries(
  db: D1Database,
  lineClient: LineClient,
  options: ReminderDeliveryOptions = {},
): Promise<ReminderDeliveryResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MINUTES * 60_000).toISOString();
  const pending = await getPendingReminderDeliveries(db);
  const result: ReminderDeliveryResult = { succeeded: 0, skipped: 0, retrying: 0, failed: 0 };

  /*
   * 配信時刻が来た通だけに絞る。
   *
   * 時刻の決め方は2つあり（153）、どちらもゴール日時を起点にする。
   *   'time'      … ゴールの○日前の●時（日本時間の暦で数える）
   *   'countdown' … ゴールから何分ずらすか
   * 判定に使う「いま」と、本文の {{date}} に使う「届く日時」を分けているのは、
   * cron が遅れて動いても本文の日付がずれないようにするため。
   */
  // 未来の通もplannedとして先に台帳へ置く。実行結果画面の「配信予定」と
  // 「次の配信」を、送信時刻になる前から実値で確認できるようにする。
  // claim側の scheduled_at <= now 条件が、時刻前の外部送信を止める。
  for (let i = 0; i < pending.length; i++) {
    const enrollment = pending[i];
    if (i > 0) {
      await (options.pause ?? sleep)(addJitter(50, 200));
    }

    const friend = await getFriendById(db, enrollment.friend_id);
    const friendAccountId = friend
      ? (friend as unknown as Record<string, string | null>).line_account_id ?? null
      : null;
    const accountId = enrollment.line_account_id ?? friendAccountId;

    for (const step of enrollment.steps) {
      const sendAt = resolveReminderSendAt(
        new Date(enrollment.target_date),
        {
          offsetDays: step.offset_days,
          sendAtTime: step.send_at_time,
          offsetMinutes: step.offset_minutes,
        },
        enrollment.delivery_mode === 'time' ? 'time' : 'countdown',
      );
      const run = await claimReminderDeliveryRun(db, {
        lineAccountId: accountId,
        reminderId: enrollment.reminder_id,
        friendReminderId: enrollment.id,
        friendId: enrollment.friend_id,
        reminderStepId: step.id,
        scheduledAt: sendAt.toISOString(),
        now: nowIso,
        leaseExpiresAt,
      });
      // 別cronが送信中、再試行時刻前、または既に終端状態なら何もしない。
      if (!run) continue;

      if (!friend) {
        await skipReminderDeliveryRun(db, {
          id: run.id,
          code: 'friend_not_found',
          message: '友だち情報が見つからないため送信しませんでした。',
          now: nowIso,
        });
        result.skipped++;
        continue;
      }
      if (!friend.is_following) {
        await skipReminderDeliveryRun(db, {
          id: run.id,
          code: 'friend_not_following',
          message: 'ブロックまたは友だち解除のため送信しませんでした。',
          now: nowIso,
        });
        result.skipped++;
        continue;
      }

      try {
        const deliveryClient = await (options.resolveClient
          ? options.resolveClient(accountId, lineClient)
          : defaultResolveClient(db, accountId, lineClient));
        let messageType = step.message_type;
        let messageContent = step.message_content;
        if (step.template_id) {
          const template = await getTemplateById(db, step.template_id);
          if (template) {
            messageType = template.message_type;
            messageContent = template.message_content;
          }
        }

        const resolvedMeta = await resolveMetadata(db, friend);
        const extra = await resolveInterpolationExtra(db, friend.id, messageContent);
        const expanded = expandVariables(
          messageContent,
          { ...friend, metadata: resolvedMeta },
          undefined,
          messageType,
          { ...extra, deliveredAt: sendAt },
        );
        const message = buildMessage(messageType, expanded);
        const response = await deliveryClient.pushMessageWithRequestId(
          friend.line_user_id,
          [message],
          run.line_retry_key,
        );

        const deliveredId = crypto.randomUUID();
        const logId = crypto.randomUUID();
        await db.batch([
          db.prepare(
            `INSERT OR IGNORE INTO friend_reminder_deliveries
               (id, friend_reminder_id, reminder_step_id, delivered_at)
             VALUES (?, ?, ?, ?)`,
          ).bind(deliveredId, enrollment.id, step.id, nowIso),
          db.prepare(
            `INSERT INTO messages_log
               (id, friend_id, direction, message_type, content,
                template_id_at_send, delivery_type, source, line_account_id, created_at)
             VALUES (?, ?, 'outgoing', ?, ?, ?, 'push', 'reminder', ?, ?)`,
          ).bind(
            logId,
            friend.id,
            messageType,
            expanded,
            step.template_id,
            accountId,
            nowIso,
          ),
          completeReminderDeliveryRunStatement(db, {
            id: run.id,
            lineRequestId: response.requestId,
            messageLogId: logId,
            now: nowIso,
          }),
        ]);
        result.succeeded++;
      } catch (error) {
        const safe = classifyReminderDeliveryError(error);
        const retryAt = retryAtFor(run.retry_cycle_attempt_count, now, safe.retryable);
        const exhausted = safe.retryable && !retryAt;
        await failReminderDeliveryRun(db, {
          id: run.id,
          code: exhausted ? 'retry_exhausted' : safe.code,
          message: exhausted
            ? '自動再試行の上限に達しました。LINE連携を確認し、必要なら手動で再試行してください。'
            : safe.message,
          retryAt,
          now: nowIso,
        });
        if (retryAt) result.retrying++;
        else result.failed++;
        console.error(JSON.stringify({
          event: 'reminder_delivery_failed',
          reminderId: enrollment.reminder_id,
          friendReminderId: enrollment.id,
          runId: run.id,
          code: exhausted ? 'retry_exhausted' : safe.code,
          retryAt,
        }));
      }
    }

    await completeReminderIfDone(db, enrollment.id, enrollment.reminder_id);
  }

  return result;
}
