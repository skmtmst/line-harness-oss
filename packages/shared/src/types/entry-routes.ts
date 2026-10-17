// -----------------------------------------------------------------------------
// Entry Route (リファラルリンク) — 流入経路 1 件
// -----------------------------------------------------------------------------

export interface EntryRoute {
  id: string;
  refCode: string;
  genre: string | null;
  name: string;
  tagId: string | null;
  scenarioId: string | null;
  redirectUrl: string | null;
  poolId: string | null;
  introTemplateId: string | null;
  couponAssetId?: string | null;
  couponEnabled?: boolean;
  couponAudience?: 'new_friends' | 'all_friends';
  runAccountFriendAddScenarios: boolean;
  isActive: boolean;
  /** 受付を止めた時刻。受付中・記録の無い古い行は null。 */
  stoppedAt: string | null;
  /** 止めた理由。受付中は null。 */
  stoppedReason: string | null;
  /** 所属するLINEアカウント。未割当の古い行では null のことがある。 */
  lineAccountId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EntryRouteGenre {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** 本人確認済みLIFFの受け取り。使用操作はreceiptIdとrequestIdを送る。 */
export interface EntryRouteCouponReceived {
  receiptId: string;
  assetId: string;
  name: string;
  payload: Record<string, unknown>;
  receivedAt: string | null;
  usedCount: number;
  postbackData: string;
}

export interface CreateEntryRouteInput {
  refCode: string;
  genre?: string | null;
  name: string;
  tagId?: string | null;
  scenarioId?: string | null;
  redirectUrl?: string | null;
  poolId?: string | null;
  introTemplateId?: string | null;
  couponAssetId?: string | null;
  couponEnabled?: boolean;
  couponAudience?: 'new_friends' | 'all_friends';
  runAccountFriendAddScenarios?: boolean;
  isActive?: boolean;
  /** 作成時に所属させるLINEアカウント。Worker の必須検査と保存に使う。 */
  lineAccountId?: string | null;
}

export interface EntryRouteMonth {
  month: string;
  friendAddCount: number;
  remainingCount: number;
  blockedCount: number;
  conversionCount: number;
  conversionValueSum: number;
}

export interface EntryRouteFunnel {
  remainingCount?: number;
  blockedCount?: number;
  conversionValueSum?: number;
  valuePerFriend?: number | null;
  monthly?: EntryRouteMonth[];
  /** 実際の初回追加イベントの人数。既存友だちの読取を含めない。 */
  new_friend_add_count?: number;
  coupon_received_count?: number;
  coupon_used_count?: number;
  click_count: number;
  friend_add_count: number;
  form_submission_count: number;
  cv_count: number;
}
