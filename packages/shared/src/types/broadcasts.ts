import type { MessageType } from './messages.js';

// -----------------------------------------------------------------------------
// 一斉配信 (Broadcast)
// -----------------------------------------------------------------------------

/** 配信対象種別 */
export type BroadcastTargetType = "all" | "tag" | "segment" | "multi-account-dedup";

/** 配信ステータス */
export type BroadcastStatus = "draft" | "scheduled" | "sending" | "sent";

export interface Broadcast {
  /** 主キー (UUIDv4) */
  id: string;
  /** 配信タイトル (管理用ラベル) */
  title: string;
  /** メッセージ種別 */
  messageType: MessageType;
  /** メッセージ内容 */
  messageContent: string;
  /** 配信対象種別 */
  targetType: BroadcastTargetType;
  /** 対象タグID (targetType が 'tag' の場合のみ使用) */
  targetTagId: string | null;
  /** 配信ステータス */
  status: BroadcastStatus;
  /** 予約配信日時 (ISO 8601、即時配信の場合は null) */
  scheduledAt: string | null;
  /** 配信完了日時 (ISO 8601) */
  sentAt: string | null;
  /** 配信対象人数 */
  totalCount: number;
  /** 配信成功人数 */
  successCount: number;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}
