/**
 * ベル・通知一覧が読む知らせの種類と、口の形。
 * LINE の鍵の知らせは Worker が書き、画面はこの種類と形だけを見て分ける。
 */

/** LINE の鍵（チャネルアクセストークン）の知らせ。同じアカウント・同じ種類・同じ期限では 1 回だけ書く。 */
export const LINE_TOKEN_NOTICE_EVENT_TYPES = [
  /** 残り 7 日以下で、自動の取り替えが成功していない。 */
  'line_token_expiring',
  /** 取り替えがチャネルの情報の不一致で断られた。人が入れ直すしかない。 */
  'line_token_refresh_failed',
  /** 期限が切れた。配信・返信が止まっている。 */
  'line_token_expired',
] as const;

export type LineTokenNoticeEventType = (typeof LINE_TOKEN_NOTICE_EVENT_TYPES)[number];

/** 取り替えに失敗した理由。`unexpected` は発行の後の保存などで止まったもの。 */
export type LineTokenRefreshFailureReason =
  | 'credentials'
  | 'rate_limited'
  | 'temporary'
  | 'network'
  | 'invalid_response'
  | 'unexpected';

/** 鍵の知らせの metadata。鍵・チャネルシークレットの値は入れない。 */
export interface LineTokenNoticeMetadata {
  /** 知らせを書いた時の期限。期限の無い鍵は null。重ねない判定の鍵にもなる。 */
  expiresAt: string | null;
  /** 書いた時の残り日数（切り捨て）。期限の無い鍵は null。 */
  daysLeft: number | null;
  reason: LineTokenRefreshFailureReason;
  failedAt: string;
}

export function isLineTokenNoticeEventType(value: string): value is LineTokenNoticeEventType {
  return (LINE_TOKEN_NOTICE_EVENT_TYPES as readonly string[]).includes(value);
}

/** ベル・通知一覧のタブ。「アップデート」は外し、「すべて」の中にだけ出す。 */
export const NOTIFICATION_CENTER_TABS = ['all', 'unread', 'system'] as const;
export type NotificationCenterTab = (typeof NOTIFICATION_CENTER_TABS)[number];

/**
 * 「システム」に入る知らせ。運用の異常（category `error`）と鍵の知らせ。
 * 鍵の知らせは category `error` で書くので、今は category だけで決まる。
 */
export function isSystemNotification(item: { category: string; eventType: string }): boolean {
  return item.category === 'error' || isLineTokenNoticeEventType(item.eventType);
}

/**
 * `GET /api/notifications/center` の問い合わせ。
 * - `unread=1`：未読だけを口で絞る（画面で 5 件に切ると 6 件目以降の未読が埋もれるため）。
 * - 「システム」タブは `category=error` を送る。
 */
export interface NotificationCenterQuery {
  lineAccountId: string;
  category?: 'error' | 'update';
  unread?: '1';
  limit?: number;
  offset?: number;
}

/** タブから口の問い合わせへ。 */
export function notificationCenterQueryForTab(tab: NotificationCenterTab): Pick<NotificationCenterQuery, 'category' | 'unread'> {
  if (tab === 'unread') return { unread: '1' };
  if (tab === 'system') return { category: 'error' };
  return {};
}
