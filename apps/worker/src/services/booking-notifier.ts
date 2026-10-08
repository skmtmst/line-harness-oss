import { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import { normalizeTimeZone, tzDateStr, tzHHMM } from './availability.js';

export type NotificationKind =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'changed'
  | 'day_before'
  | 'hours_before'
  | 'waitlist_invite';

export interface NotificationContext {
  menuName: string;
  staffName: string;
  /** 店舗の時間帯で書いた予約日時（例: "2026-05-10 14:00"）。日本時間に固定しない (R332)。 */
  startsAt: string;
  /** 店舗暦日で送信日から予約日までの日数。0=本日、1=明日、それ以上は日付に任せる (R333)。 */
  daysUntil: number;
  /** 送信時点から予約開始までの実際の残り時間（時間。1時間未満は1）。設定値ではなく実測 (R333)。 */
  hoursUntil: number;
  /** キャンセル待ちの招待だけ使う仮押さえ分数。それ以外は入れない。 */
  holdMinutes?: number;
}

/**
 * 店舗の時間帯で予約日時を "YYYY-MM-DD HH:MM" に整形する。
 * 通知・リマインダーの日時欄は全経路これを通し、日本時間固定を止める。
 */
export function formatStartsAtForStore(startsAtUtcIso: string, timeZone: string): string {
  const tz = normalizeTimeZone(timeZone);
  const d = new Date(startsAtUtcIso);
  return `${tzDateStr(tz, d)} ${tzHHMM(tz, d)}`;
}

/**
 * 送信時点の文面部品。店舗の暦日で「本日/明日」を数え、
 * 残り時間は設定値ではなく送信時点と開始時点の差から実測する。
 * 送るのが遅れても、通知設定を変えても、文面が実予約とずれないようにする (R333)。
 */
export function notificationTiming(
  startsAtUtcIso: string,
  timeZone: string,
  now: Date,
): { daysUntil: number; hoursUntil: number } {
  const tz = normalizeTimeZone(timeZone);
  const startsAt = new Date(startsAtUtcIso);
  const todayUtc = Date.parse(`${tzDateStr(tz, now)}T00:00:00Z`);
  const bookingDayUtc = Date.parse(`${tzDateStr(tz, startsAt)}T00:00:00Z`);
  return {
    daysUntil: Math.max(0, Math.round((bookingDayUtc - todayUtc) / 86_400_000)),
    hoursUntil: Math.max(1, Math.round((startsAt.getTime() - now.getTime()) / 3_600_000)),
  };
}

export function renderNotificationText(
  kind: NotificationKind,
  ctx: NotificationContext,
): string {
  const detail = `\nメニュー: ${ctx.menuName}\n担当: ${ctx.staffName}\n日時: ${ctx.startsAt}`;
  // 「本日」「明日」は店舗暦日での実際のずれ。2日以上離れている・遅れて
  // 当日を過ぎた場合は曖昧な言い方を避け、日時欄だけで伝える (R333)。
  const relDay = ctx.daysUntil === 0 ? '本日' : ctx.daysUntil === 1 ? '明日' : null;
  switch (kind) {
    case 'requested':
      return `予約リクエストを受け付けました。${detail}\n\nお店からの返信をお待ちください。`;
    case 'approved':
      return `予約が確定しました。${detail}\n\n変更・キャンセルはお店に直接ご連絡ください。`;
    case 'rejected':
      return `申し訳ありません、ご希望の枠でお取りできませんでした。\n別の日時で再度お試しください。`;
    case 'expired':
      return `予約リクエストが 24 時間返信が無かったため、期限切れになりました。${detail}`;
    case 'changed':
      return `ご予約内容が変更になりました。${detail}\n\n変更後の日時をご確認ください。`;
    case 'day_before':
      return `${relDay ? `${relDay}のご予約` : 'ご予約'}のお知らせです。${detail}`;
    case 'hours_before':
      return `${relDay ? `${relDay}のご予約` : 'ご予約'}まであと ${ctx.hoursUntil} 時間です。${detail}`;
    case 'waitlist_invite': {
      const hold = Number(ctx.holdMinutes ?? 30);
      return `キャンセルが出ました。${detail}\n\n${hold}分以内にご予約ください。この枠は今だけあなたが優先です。`;
    }
  }
}

export interface SendNotificationParams {
  channelAccessToken: string;
  toLineUserId: string;
  kind: NotificationKind;
  ctx: NotificationContext;
  /**
   * R323: LINE の再試行キー (X-Line-Retry-Key)。同じ操作の再送・回収で
   * 同じ値を渡すと、LINE 側の到達ずみ再送は 409 で冪等に吸収される
   * (client が成功として扱う)。未指定なら付けずに従来どおり送る。
   */
  retryKey?: string;
  /** 組み立て済みの通知。予約リマインダの再送は保存した本文をそのまま使う。 */
  messages?: Message[];
}

export async function sendBookingNotification(params: SendNotificationParams): Promise<void> {
  const messages = params.messages ?? [{ type: 'text' as const, text: renderNotificationText(params.kind, params.ctx) }];
  const client = new LineClient(params.channelAccessToken);
  await client.pushMessage(params.toLineUserId, messages, params.retryKey);
}

export type BookingNotificationSender = (params: SendNotificationParams) => Promise<void>;
