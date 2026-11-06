// -----------------------------------------------------------------------------
// アフィリエイト (Affiliate) — アフィリエイト管理
// -----------------------------------------------------------------------------

export interface Affiliate {
  folderId?: string | null;
  /** 主キー (UUIDv4) */
  id: string;
  /** 所属テナント */
  tenantId: string;
  /** 所属LINE公式アカウント */
  lineAccountId: string | null;
  /** アフィリエイト名 */
  name: string;
  /** トラッキングコード (ユニーク) */
  code: string;
  /** コミッション率 (0-100) */
  rewardMode?: 'none' | 'fixed' | 'rate';
  commissionRate: number;
  /** 有効/無効 */
  isActive: boolean;
  /** 連絡先。報酬の連絡に使う。null なら未登録 */
  email?: string | null;
  /** 成果が確定するまでの保留日数。null なら即確定 */
  holdDays?: number | null;
  /** 支払いサイクルの覚書。計算には使わない */
  payoutCycle?: string | null;
  /** 成果が出たときに本人へ知らせるか */
  notifyOnConversion?: boolean;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// アフィリエイトクリック (AffiliateClick) — クリック記録
// -----------------------------------------------------------------------------

export interface AffiliateClick {
  /** 主キー (UUIDv4) */
  id: string;
  /** アフィリエイトID */
  affiliateId: string;
  /** リファラURL */
  url: string | null;
  /** IPアドレス */
  ipAddress: string | null;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}
