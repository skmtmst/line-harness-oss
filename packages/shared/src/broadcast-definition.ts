import type { Broadcast } from './types/broadcasts.js';
import type { LineMessageType } from './types/messages.js';
export interface SegmentRule {
  /** 有効な種類と値の組み合わせは、保存時に条件ビルダーで検証する。 */
  type: string;
  value: unknown
}

export interface SegmentCondition {
  operator: 'AND' | 'OR'
  rules: SegmentRule[]
  /**
   * 入れ子のグループ。Lステップの「いずれか1つ以上を満たす必要がある条件
   * (or条件)」にあたる。親の operator でこの結果とつなぐ。
   *
   * 省略できる。以前の形（rules だけ）で保存された条件がそのまま動く。
   */
  groups?: SegmentCondition[]
}


/** 店と統括で共通の一斉配信の吹き出し。 */
export type BroadcastBubbleType = 'text' | 'sticker' | 'image' | 'flex' | 'location' | 'audio' | 'carousel' | 'rich_message' | 'rich_video' | 'video' | 'card_message' | 'coupon' | 'research';
export type BroadcastBubble = { id: string; type: BroadcastBubbleType; content: Record<string, unknown> };
export type BroadcastMessageButton = { label: string; type: 'url' | 'pdf'; value: string };
export type BroadcastDeliveryLimit = { upToRemainingQuota: boolean; maxRecipients?: number };
export type BroadcastMessageOptions = { buttons?: BroadcastMessageButton[]; deliveryLimit?: BroadcastDeliveryLimit };

/** 未指定は全員へ送る既存の設定。壊れた上限を全員へ戻さない。 */
export function parseBroadcastDeliveryLimit(value: unknown): BroadcastDeliveryLimit | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('送る人数の上限を確認してください。');
  const limit = value as Record<string, unknown>;
  if (typeof limit.upToRemainingQuota !== 'boolean'
    || Object.keys(limit).some(key => !['upToRemainingQuota', 'maxRecipients'].includes(key))
    || (limit.maxRecipients !== undefined && (!Number.isSafeInteger(limit.maxRecipients) || Number(limit.maxRecipients) < 1))
    || (!limit.upToRemainingQuota && limit.maxRecipients === undefined)) {
    throw new Error('上限人数は1以上の整数を入れるか、残りの枠まで送る設定を選んでください。');
  }
  return { upToRemainingQuota: limit.upToRemainingQuota,
    ...(limit.maxRecipients === undefined ? {} : { maxRecipients: limit.maxRecipients as number }) };
}
export type BroadcastDefinitionInput = Pick<Broadcast,'title' | 'messageContent'> & {
  messageType: LineMessageType; messageBubbles?: BroadcastBubble[];
  messageBubblesJson?: string | null; altText?: string | null;
  targetType?: Broadcast['targetType']; targetTagId?: string | null;
  segmentConditions?: SegmentCondition | null; excludedTagIds?: string[]; savedSearchId?: string | null;
  scheduledAt?: string | null; status?: Broadcast['status']; lineAccountId?: string | null;
  accountIds?: string[]; dedupPriority?: string[]; trackLinks?: boolean;
  stealthSpreadMinutes?: number; folderId?: string | null; measureOpens?: boolean;
  saveAsDraft?: boolean; draftStep?: 'basic' | 'audience' | 'message' | 'schedule' | 'confirm' | null;
  internalMemo?: string | null; messageOptions?: BroadcastMessageOptions | null;
  afterActionVersionId?: string | null; confirmedRecipientCount?: number;
};
export type BroadcastApprovalState = {
  approval: {status:'none'|'pending'|'approved'|'rejected'|'cancelled'|'expired';requestedByStaffId:string|null;requestedAt:string|null;
    approverStaffId:string|null;note:string|null;decidedByStaffId:string|null;decidedAt:string|null;rejectReason:string|null;confirmedCount:number|null};
  gate:{required:boolean;recipientCount:number;threshold:number;singleOperator:boolean;operatorCount:number};
  viewer:{isApprover:boolean;canApprove:boolean;isRequester:boolean};
};
