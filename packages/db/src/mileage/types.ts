import type { MileageFriendHistorySummary } from '@line-crm/shared';
import type { SegmentCondition } from '@line-crm/shared';


export type MileageEntryType =
  | 'grant'
  | 'reversal'
  | 'spend'
  | 'expiration'
  | 'adjustment';
export type MileageEntryStatus = 'pending' | 'available' | 'void';

export interface EngagementEvent {
  id: string;
  program_id: string;
  idempotency_key: string;
  event_type: string;
  source: string;
  source_event_id: string | null;
  actor_user_id: string | null;
  actor_friend_id: string | null;
  subject_user_id: string | null;
  subject_friend_id: string | null;
  identity_provider: string | null;
  identity_subject: string | null;
  metadata: string | null;
  occurred_at: string;
  created_at: string;
}

export interface MileageLedgerEntry {
  id: string;
  program_id: string;
  beneficiary_user_id: string | null;
  beneficiary_friend_id: string | null;
  engagement_event_id: string | null;
  mileage_rule_id: string | null;
  entry_type: MileageEntryType;
  status: MileageEntryStatus;
  amount: number;
  reason: string;
  source: string;
  source_event_id: string | null;
  idempotency_key: string;
  reverses_entry_id: string | null;
  metadata: string | null;
  occurred_at: string;
  created_at: string;
}

export interface RecordEngagementEventInput {
  programId?: string;
  idempotencyKey: string;
  eventType: string;
  source: string;
  sourceEventId?: string | null;
  actorUserId?: string | null;
  actorFriendId?: string | null;
  subjectUserId?: string | null;
  subjectFriendId?: string | null;
  identityProvider?: string | null;
  identitySubject?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string;
}

export interface EnqueueMileageEventInput {
  eventType: string;
  source: string;
  sourceEventId: string;
  friendId: string;
  subjectKey?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string;
}

export interface PostMileageEntryInput {
  programId?: string;
  beneficiaryUserId?: string | null;
  beneficiaryFriendId?: string | null;
  engagementEventId?: string | null;
  mileageRuleId?: string | null;
  entryType: MileageEntryType;
  status?: MileageEntryStatus;
  amount: number;
  reason: string;
  source: string;
  sourceEventId?: string | null;
  idempotencyKey: string;
  reversesEntryId?: string | null;
  /** 付与取消の台帳と未使用内訳を同じ取引で閉じる。 */
  voidReversedGrantLot?: boolean;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string;
}

export type MileageAdjustmentErrorCode =
  | 'friend_not_found'
  | 'insufficient_balance'
  | 'idempotency_conflict';

export interface PostMileageAdjustmentInput {
  programId?: string;
  friendId: string;
  amount: number;
  reason: string;
  reasonCategory: string;
  sourceReferenceId?: string | null;
  idempotencyKey: string;
  executedByStaffId: string;
  executedByStaffName: string;
  lineAccountId: string;
  /** Positive adjustments create an expiring grant lot through the existing ledger trigger. */
  expiresAt?: string | null;
  /** Included in the idempotency fingerprint so a retry cannot add or remove delivery. */
  notifyFriend?: boolean;
  occurredAt?: string;
}

export interface MileageAdjustmentResult {
  entry: MileageLedgerEntry;
  balanceBefore: number;
  balanceAfter: number;
  replayed: boolean;
}

export type MileageAdjustmentMetadata = {
  adjustmentFingerprint?: string;
  balanceBefore?: number;
  balanceAfter?: number;
};

export interface AdjustmentLotConsumption {
  lotId: string;
  amount: number;
}

export interface MileageSummary {
  programId: string;
  programName: string;
  available: number;
  pending: number;
  lifetimeEarned: number;
  spent: number;
}

export interface MileageHistoryItem {
  id: string;
  entryType: MileageEntryType;
  status: MileageEntryStatus;
  amount: number;
  reason: string | null;
  source: string;
  sourceEventId: string | null;
  sourceReferenceId: string | null;
  ruleName: string | null;
  mode: 'automatic' | 'manual';
  executedByStaffName: string | null;
  occurredAt: string;
  /** この記録が属する LINE アカウント（不明なら null）。 */
  lineAccountId: string | null;
  /*
   * true の行は、見ている担当者の権限外アカウントの記録。
   * 残高は名寄せした本人で共通だが、調整の理由・実行者・元イベントは
   * アカウントの閲覧権限で区切るため、この行では伏せてある（R387）。
   */
  restricted: boolean;
  /** R380: 手動調整につけた友だち通知の状態。通知なし・権限外の行は null。 */
  notificationStatus: string | null;
  notificationErrorCode: string | null;
}

export interface MileageSelfInsights {
  /** Number of LINE Official Accounts currently linked to this person. */
  accountCount: number;
  /** Non-void mileage grants, useful as a simple engagement counter. */
  rewardedActions: number;
  /** Available miles earned because an introduced friend took a quality action. */
  referralMiles: number;
  /** Distinct introduced people who produced at least one quality reward. */
  qualityReferralCount: number;
  lastEarnedAt: string | null;
}

export interface MileageConnectedAccount {
  accountId: string;
  accountName: string;
  friendId: string;
}

export interface MileageEarningOpportunity {
  id: string;
  type: 'webinar' | 'friend_add';
  title: string;
  description: string;
  rewardMiles: number;
  nextRewardMiles: number;
  progressPercent: number;
  ctaLabel: string;
  url: string;
  targetAccountId?: string;
  completed?: boolean;
  mileageStatus?: 'credited' | 'pending' | 'waiting';
  creditedMiles?: number;
}

export interface MileageRuleRow {
  id: string;
  program_id: string;
  name: string;
  event_type: string;
  source: string | null;
  amount: number;
  initial_status: 'pending' | 'available';
  conditions: string | null;
  /**
   * R52: 公開版が持つ対象条件(JSON文字列)。live の `mileage_rules` に列はなく、
   * 公開版から組み立てた行だけが持つ(実行時のみ)。live 読みの行は
   * undefined で、従来どおり条件なしとして付与する。
   */
  target_conditions?: string | null;
  /**
   * m22o: 公開版が持つ期限・取消・通知。target_conditions と同じく
   * 公開版から組み立てた行だけが持つ(実行時のみ)。live 読みの行は
   * undefined で、従来どおり期限なし・取消なし・通知なしとして扱う。
   * 公開版(v1以降)の設定だけを使い、下書きは見ない。
   */
  expires_after_days?: number | null;
  cancellation_event_types?: string[] | null;
  notification?: { enabled: boolean; messageTemplate: string } | null;
  /** 334(#521): 帰属アカウント。NULL は変更不可の既存全店ルール。 */
  line_account_id?: string | null;
  is_active: number;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface MileageRuleConditions {
  /** Maximum rewarded actions for the same identity on one calendar day. */
  dailyCapActions?: number;
  /** Reward an identity only once for the supplied subjectKey (for example, a form). */
  uniquePerSubject?: boolean;
  /** Reward the supplied subjectKey once per identity and calendar day. */
  uniquePerSubjectPerDay?: boolean;
  /** Fixed bonuses such as registration/tenure are not multiplied by a tier. */
  ignoreMultiplier?: boolean;
  /** Send the grant to the person who introduced the actor through an ASP link. */
  beneficiary?: 'actor' | 'referrer';
  /** Reward a referrer only once for each referred person. */
  uniquePerReferredFriend?: boolean;
  /** Reward a referrer once per referred person and subject (for example, webinar). */
  uniquePerReferredFriendPerSubject?: boolean;
}

/**
 * 公開版の中身。is_active は含めない。停止・再開は live の稼働で見る。
 * R52: 下書きの対象条件(target_conditions)もここへ載せる。載せないと
 * 公開版だけ条件が消え、対象外の友だちへ付与される。
 * m22o: 期限・取消・通知も同じく公開版へ載せる。載せないと画面の設定が
 * 実際の付与に効かない。content_json は形を持たないので、列を足さずに載る。
 */
export interface PublishedEarningRuleContent {
  name: string;
  event_type: string;
  source: string | null;
  amount: number;
  initial_status: 'pending' | 'available';
  conditions: string | null;
  target_conditions: SegmentCondition | null;
  valid_from: string | null;
  valid_until: string | null;
  /** m22o: 付与したマイルの有効期限(日数)。null は期限なし。 */
  expires_after_days: number | null;
  /** m22o: このきっかけが来たら過去の付与を取り消す。空は取消なし。 */
  cancellation_event_types: string[];
  /** m22o: 付与の後の友だちへの通知。off なら送らない。 */
  notification: { enabled: boolean; messageTemplate: string };
}

export interface ApplyMileageRulesInput {
  eventType: string;
  source: string;
  sourceEventId: string;
  friendId: string;
  subjectKey?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string;
  /**
   * N-231 案1: 受付時に固定した適用版の集合。null は旧来互換でそのまま live を読む。
   * 空集合 {} は「所属ルールなし」(全店共通のみ)で、旧来の持ち主不明行と同じ結果になる。
   * 版 0 は「受付時に未公開」。後の初公開で残る v0 があれば v0、無ければ live。
   */
  publishedSnapshot?: Record<string, number> | null;
}

export interface MileageMultiplier {
  bps: number;
  tagId: string | null;
  tagName: string | null;
}

export interface ReferralMileageBeneficiary {
  affiliateId: string;
  refCode: string;
  friendId: string;
  userId: string | null;
}

export interface MileageQueueResult {
  claimed: number;
  processed: number;
  failed: number;
  granted: number;
}

export interface FollowingMileageReconcileResult {
  eventsCreated: number;
  queued: number;
}

export interface MileageAdminMember {
  identityKey: string;
  primaryFriendId: string;
  displayName: string;
  pictureUrl: string | null;
  accountCount: number;
  accountNames: string[];
  available: number;
  pending: number;
  lifetimeEarned: number;
  actionCount: number;
  messageCount: number;
  linkClickCount: number;
  formCount: number;
  bookingCount: number;
  webinarCount: number;
  instagramCount: number;
  followingDays: number;
  unfollowCount: number;
  referralMiles: number;
  qualityReferralCount: number;
  lastActivityAt: string | null;
}

export interface MileageAdminOverview {
  summary: {
    totalMembers: number;
    totalAvailable: number;
    activeMembers30d: number;
    totalActions: number;
    queuedEvents: number;
  };
  members: MileageAdminMember[];
  pagination: { total: number; limit: number; offset: number };
}

export interface MileageAdminHistoryItem {
  id: string;
  primaryFriendId: string;
  displayName: string;
  pictureUrl: string | null;
  entryType: MileageEntryType;
  status: MileageEntryStatus;
  amount: number;
  reason: string;
  source: string;
  hasSourceEvent: boolean;
  sourceReferenceId: string | null;
  ruleName: string | null;
  mode: 'automatic' | 'manual';
  executedByStaffName: string | null;
  lineAccountName: string;
  /** この記録が属する LINE アカウント（メタに残っていない古い行は null）。 */
  lineAccountId: string | null;
  /** 手動調整につけた友だち通知の状態。通知のない行は null。 */
  notificationStatus: string | null;
  notificationErrorCode: string | null;
  balanceAfter: number;
  occurredAt: string;
}

export interface MileageAdminHistory {
  friendSummary?: MileageFriendHistorySummary;
  items: MileageAdminHistoryItem[];
  pagination: { total: number; limit: number; offset: number };
}

export interface AffiliateConversionMileageContext {
  event_id: string;
  approval_status: 'approved' | 'rejected';
  approved_at: string | null;
  created_at: string;
  subject_friend_id: string;
  subject_user_id: string | null;
  beneficiary_friend_id: string | null;
  beneficiary_user_id: string | null;
  beneficiary_line_account_id: string | null;
  offer_id: string | null;
  offer_name: string | null;
  reward_miles: number | null;
  /** m22u R356: 承認時に凍結したマイル数。NULL の行は従来どおり現在値。 */
  frozen_miles: number | null;
  mileage_program_id: string | null;
}
