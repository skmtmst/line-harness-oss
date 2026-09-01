/** V6 3-3-A 統合ユーザー詳細の読み取り・更新契約。 */
export type MergedPersonStatus = "active" | "review" | "archived";

export type MergedPersonProfileSource =
  | "friend"
  | "friend_field"
  | "form"
  | "ec"
  | "manual";

export type MergedPersonProfileUpdateMode = "auto" | "fixed";

export type MergedPersonDeliveryPurpose =
  | "broadcast"
  | "scenario"
  | "reminder"
  | "transactional"
  | "manual";

export type MergedPersonEventType =
  | "candidate"
  | "link"
  | "unlink"
  | "profile"
  | "priority"
  | "migration";

export type MergedPersonJsonValue =
  | string
  | number
  | boolean
  | null
  | MergedPersonJsonValue[]
  | { [key: string]: MergedPersonJsonValue };

export interface MergedPersonLinkedFriend {
  /** API操作用。画面本文へは表示しない。 */
  friendId: string;
  displayName: string;
  lineAccountId: string;
  lineAccountName: string;
  isFollowing: boolean;
  linkedAt: string;
  linkMethod: string;
  /** null は移行前の既存リンクなど、確信度を記録していない状態。 */
  confidence: number | null;
  /** #598 の候補画面へ戻すための操作用ID。本文へは表示しない。 */
  candidateId: string | null;
  candidateVersion: number | null;
}

export interface MergedPersonProfileValue {
  fieldKey: string;
  fieldLabel: string;
  /** 平文のメール・電話を含まない、画面へ出してよい値。 */
  valuePreview: string | null;
  sourceType: MergedPersonProfileSource;
  sourceLabel: string;
  /** 操作用。画面本文へは表示しない。 */
  sourceFriendId: string | null;
  verifiedAt: string | null;
  selectedByName: string;
  selectedAt: string;
  updateMode: MergedPersonProfileUpdateMode;
}

export interface MergedPersonDeliveryPriority {
  purpose: MergedPersonDeliveryPurpose;
  friendId: string;
  lineAccountId: string;
  lineAccountName: string;
  priority: number;
  isActive: boolean;
  reason: string;
}

export interface MergedPersonHistoryItem {
  id: string;
  eventType: MergedPersonEventType;
  summary: string;
  actorName: string;
  occurredAt: string;
}

export interface MergedPersonDetail {
  id: string;
  status: MergedPersonStatus;
  revision: number;
  primaryDisplayName: string;
  linkedFriends: MergedPersonLinkedFriend[];
  profileValues: MergedPersonProfileValue[];
  deliveryPriorities: MergedPersonDeliveryPriority[];
  history: MergedPersonHistoryItem[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface MergedPersonProfileSelectionInput {
  fieldKey: string;
  fieldLabel: string;
  /** 監査と後続処理用。詳細APIの返事には含めない。 */
  value: MergedPersonJsonValue;
  /** 画面へ返してよいマスク済みの値。 */
  valuePreview: string | null;
  sourceType: MergedPersonProfileSource;
  sourceId: string | null;
  sourceLabel: string;
  sourceFriendId: string | null;
  verifiedAt: string | null;
  updateMode: MergedPersonProfileUpdateMode;
}

export interface UpdateMergedPersonRequest {
  expectedRevision: number;
  primaryDisplayName?: string;
  status?: MergedPersonStatus;
  profileSelections?: MergedPersonProfileSelectionInput[];
}

export interface MergedPersonDeliveryPriorityInput {
  purpose: MergedPersonDeliveryPurpose;
  friendId: string;
  priority: number;
  isActive: boolean;
  reason: string;
}

export interface UpdateMergedPersonDeliveryPrioritiesRequest {
  expectedRevision: number;
  priorities: MergedPersonDeliveryPriorityInput[];
}
