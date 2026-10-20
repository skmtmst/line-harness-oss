

export interface Tag {
  id: string;
  name: string;
  color: string;
  line_account_id: string | null;
  description: string | null;
  normalized_name: string | null;
  manual_assignment_allowed: number;
  reapply_policy: 'first_only' | 'every_time';
  linked_enabled: number;
  status: 'active' | 'archived';
  version: number;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string | null;
  /**
   * @deprecated 099 で folders へ移送済み。folder_id を見ること。
   * 追加のみポリシーで列を落とせないため残っているだけで、読み書きしない。
   */
  group_id: string | null;
  /** 所属する分類。folders(kind='tag') の id */
  folder_id: string | null;
  mileage_reward: number;
  referral_mileage_reward: number;
  mileage_multiplier_bps: number | null;
  mileage_multiplier_priority: number;
  /** 友だち一覧の「★つきタグ」列に出すか。0 / 1（111 で追加） */
  is_starred: number;
  /** 一覧での並び順。小さいほど上（112 で追加） */
  display_order: number;
  created_at: string;
  /**
   * 属するフォルダの色（#RRGGBB）。folders.color を読んだもので、tags 側に
   * 保存はしない。
   *
   * 画面に出す印の色はこれ。タグ1つずつに色を持たせると、100枚あるタグで
   * 色がばらけて一覧での区別に使えなくなる。色はフォルダに1つだけ付けて、
   * 中のタグはそれを写す。JOIN していない読み方では undefined になる。
   */
  folder_color?: string | null;
}

/**
 * タグの分類。
 *
 * 099 で folders(kind='tag') へ移送した。形は変えずに、中で見るテーブルだけ
 * 差し替えている（画面とAPIの経路はそのまま）。sort_order は
 * folders.display_order を写したもの。
 */
export interface TagGroup {
  id: string;
  /** この分類を所有するLINE公式アカウント。旧データだけ null。 */
  account_id: string | null;
  name: string;
  sort_order: number;
  /** #RRGGBB。未設定は null。115 で folders.color を足した。 */
  color: string | null;
  created_at: string;
  updated_at: string;
}

export interface FriendTag {
  friend_id: string;
  tag_id: string;
  assigned_at: string;
}

export interface TagWithCount extends Tag {
  friend_count: number;
}

export type TagCleanupReason = 'unused' | 'duplicate_name';

export type TagAssignSource =
  | 'ec'
  | 'line_login'
  | 'form'
  | 'ec_purchase'
  | 'manual'
  | 'birthday';

export interface TagWithUsage extends TagWithCount {
  assign_source: TagAssignSource | null;
  used_in_broadcasts: number;
  used_in_forms: number;
  used_in_scenarios: number;
  used_in_auto_replies: number;
  used_in_saved_searches: number;
  other_action_count: number;
  /** 一覧の「整理候補」に入る理由。複数理由でもタグ自体は1件として数える。 */
  cleanup_reasons: TagCleanupReason[];
}

export type TagWithUsageRow = Omit<TagWithUsage, 'cleanup_reasons'>;

export type TagUsageCountRow = {
  tag_id: string;
  count: number;
};

export type TagUsageReferenceRow = {
  tag_id: string;
  entity_id: string;
};

export interface TagDeleteImpactReferences {
  broadcasts: number;
  forms: number;
  scenarios: number;
  autoReplies: number;
  savedSearches: number;
  automations: number;
  commonActions: number;
  richMenus: number;
  templates: number;
  webinars: number;
  reminders: number;
  entryRoutes: number;
  trackedLinks: number;
  bookingMenus: number;
  affiliateOffers: number;
  events: number;
  analyticsFunnels: number;
  friendAddSettings: number;
}

export interface TagDeleteImpact {
  tag: Pick<Tag, 'id' | 'name'>;
  /** タグを外される友だちの人数。運用設定とは分けて表示する。 */
  friendCount: number;
  /** このタグIDを現在も保存している運用設定の件数。 */
  references: TagDeleteImpactReferences;
  blockingReferenceCount: number;
  canDelete: boolean;
}

export type TagDeleteImpactRow = {
  id: string;
  name: string;
  friend_count: number;
  broadcasts: number;
  forms: number;
  scenarios: number;
  auto_replies: number;
  saved_searches: number;
  automations: number;
  common_actions: number;
  rich_menus: number;
  templates: number;
  webinars: number;
  reminders: number;
  entry_routes: number;
  tracked_links: number;
  booking_menus: number;
  affiliate_offers: number;
  events: number;
  analytics_funnels: number;
  friend_add_settings: number;
};

export interface CreateTagInput {
  name: string;
  color?: string;
  groupId?: string | null;
}

export interface CreateTagsBulkInput {
  name: string;
  groupId?: string | null;
}

export interface CreateTagsBulkResult {
  status: 'created' | 'skipped' | 'failed';
  tagId?: string;
}

// ─── 既存友だちへの遡及マイル：実行前の事前計算 ──────────────────
//
// N-047: 遡及実行の前に「何人に何マイル付くか」をサーバー側で確定させ、
// 実行時はこの結果と照合して、ズレていれば止める（プレビュー照合）。
// enqueueHistoricTagMileage が実際にキューへ積む対象と同じ条件で
// 数えるので、確認画面の数字と実際の付与が一致する。
export interface TagRetroactiveMileagePreview {
  tagId: string;
  lineAccountId: string | null;
  /** タグが付いている友だちの合計 */
  friendIds: string[];
  /** 本人マイルをまだ受け取っていない友だち */
  selfTargetIds: string[];
  /** 本人マイルをすでに受け取っている友だち */
  selfExcludedIds: string[];
  /** 紹介者マイルの対象になる友だち（まだ紹介者側へ付与されていないもの） */
  referralTargetIds: string[];
  /** 紹介者マイルの対象だが、すでに紹介者側へ付与済みの友だち */
  referralExcludedIds: string[];
}
