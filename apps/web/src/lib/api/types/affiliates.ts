/** Affiliate offer (案件) as returned by the worker. */
export type AffiliateOffer = {
  id: string
  folderId?: string | null
  name: string
  description: string | null
  rewardAmount: number | null
  rewardMiles: number
  mileageProgramId: string
  lineAccountId: string | null
  tagId: string | null
  scenarioId: string | null
  isActive: boolean
  createdAt: string
}

/** 案件の決まりの版 (#823)。保存するたびに増え、前の版は変わらない。 */
export type OfferVersion = {
  id: string
  offerId: string
  versionNumber: number
  rewardAmount: number
  rewardMiles: number
  windowDays: number
  capTotal: number | null
  capMonthlyPerAffiliate: number | null
  receptionFrom: string | null
  receptionTo: string | null
  effectiveFrom: string | null
  createdAt: string
}

/** 今の決まりと上限の残り (#823)。空は「上限なし」。 */
export type OfferCapStatus = {
  version: OfferVersion | null
  capped: boolean
  capTotal: number | null
  totalUsed: number
  totalRemaining: number | null
  capMonthlyPerAffiliate: number | null
  monthlyUsed: number
  monthlyRemaining: number | null
}

/** 付け方の判断の理由。画面には人の言葉で出す。#823 */
export type AttributionSkipReason =
  | 'out_of_window'
  | 'self_referral'
  | 'inactive_link'
  | 'inactive_affiliate'
  | 'other_account'
  | 'reception_closed'
  | 'capped_total'
  | 'capped_monthly'

/** 成果の付け方の記録 (#823)。候補1件ずつの結果を持つ。 */
export type AttributionDecisionView = {
  conversionEventId: string
  affiliateId: string | null
  refCode: string | null
  offerId: string | null
  offerVersionId: string | null
  reason: string
  windowDays: number
  candidates: Array<{
    affiliateId: string
    affiliateName: string
    refCode: string
    touchedAt: string
    offerId: string | null
    offerName: string | null
    chosen: boolean
    skipReason: AttributionSkipReason | null
    windowDays: number
  }>
  createdAt: string
}

/** Approval queue row as returned by /api/conversions/approvals */
export type ConversionApprovalItem = {
  eventId: string
  createdAt: string
  friendId: string
  friendName: string | null
  affiliateId: string
  affiliateName: string | null
  /** 案件ID。名前は同じものを作れるので、集計はこちらで結ぶ */
  offerId: string | null
  offerName: string | null
  /** 案件の付与マイル。案件に結びつかない成果は null */
  offerRewardMiles: number | null
  conversionPointName: string | null
  value: number | null
  approvalStatus: 'pending' | 'approved' | 'rejected'
  duplicateFlag: boolean
  /** 承認済みで案件の付帯動作(タグ付与・シナリオ開始)が未完の行だけ true */
  offerActionsIncomplete: boolean
  /** 成果地点が属するLINEアカウント。アカウント絞りはこの値で数える。未割当は null */
  lineAccountId: string | null
  /** アカウント名。削除済み・未割当は null */
  lineAccountName: string | null
  /** 成果の起こりになった注文番号。注文由来でない成果は null */
  orderNumber: string | null
  /** その注文の最新状態。注文が見つからない・注文由来でない成果は null */
  orderStatus: 'current' | 'refunded' | 'cancelled' | null
  /** 同じ注文・同じ成果地点の帰属成果がほかにもあるとき true（二重計上の候補） */
  sameOrderDuplicate: boolean
  /** 承認時に固定された報酬額。承認前・計算不可は null（未確定） */
  rewardAmount: number | null
  /** 支払い確定の行の状態。settled/paid/reversed 等。無ければ null */
  rewardEntryStatus: 'pending' | 'approved' | 'held' | 'payable' | 'settled' | 'paid' | 'reversed' | null
}

/** 支払台帳を作る前に安全に表示できる、承認済み報酬の読み取り専用集計。 */
export type AffiliatePaymentSummary = {
  affiliateId: string
  affiliateName: string
  code: string
  holdDays: number | null
  payoutCycle: string | null
  approvedConversions: number
  approvedReward: number
  heldConversions: number
  heldReward: number
  holdStatusUnknown: number
  unsettledConversions: number
  unsettledReward: number
  settledConversions: number
  settledReward: number
}

export type AffiliateArchiveImpact = {
  affiliateId: string
  affiliateName: string
  lifecycle: 'active' | 'paused' | 'archived'
  activeLinks: number
  unsettledConversions: number
  unsettledReward: number
  pendingConversions: number
  checkedAt: string
}

export type AffiliateSettlementPreview = {
  affiliateId: string
  affiliateName: string
  code: string
  amount: number
  conversionCount: number
  periodFrom: string | null
  periodTo: string
  closeDate: string | null
  paymentDate: string | null
  bankDestination: string | null
  breakdown: Array<{
    offerName: string
    conversions: number
    unitReward: number | null
    subtotal: number
  }>
}

/** アカウント単位で締める前に確認する、追記台帳の対象。 */
export type AffiliateAccountSettlementPreview = {
  lineAccountId: string
  periodFrom: string
  periodTo: string
  currency: 'JPY'
  totalAmount: number
  conversionCount: number
  affiliates: Array<{
    affiliateId: string
    affiliateName: string
    code: string
    /** 今回払う額。取消の差し引き後。 */
    amount: number
    /** 差し引き前の報酬額。 */
    grossAmount: number
    /** 今回差し引く取消額。無いときは 0。 */
    deduction: number
    conversionCount: number
    /** 管理画面へ口座番号を返さず、登録の有無だけを扱う。 */
    bankProfileRegistered: boolean
  }>
  /**
   * 報酬0円で締め対象から外れた成果(N-219)。除外自体は仕様どおりだが、
   * 件数と対象を運用者が締めの前に確認できるよう返す。
   * 古いWorkerでは付かないので、画面側は未設定でも動くこと。
   */
  excludedZeroAmount?: {
    count: number
    rows: Array<{
      conversionEventId: string
      affiliateId: string
      affiliateName: string
      code: string
      approvedAt: string
      rewardAmount: number
    }>
  }
  /**
   * 期間の始まりより前に承認され、まだ締められていない繰越分(R44)。
   * 古いWorkerでは付かないので、画面側は未設定でも動くこと。
   */
  carriedOver?: {
    count: number
    amount: number
  }
  /**
   * R288: 今回差し引く取消額の合計と、引ききれず次回へ繰り越す分。
   * 古いWorkerでは付かないので、画面側は未設定でも動くこと。
   */
  totalDeduction?: number
  carriedDeduction?: {
    count: number
    amount: number
  }
  previewVersion: string
}

/** R43: 締め済み台帳の再開情報（明細発行・CSV準備の続きに使う）。 */
export type AffiliateSettlementResume = {
  settlementId: string
  state: string
  version: number
  closedAt: string | null
  totalAmount: number
  conversionCount: number
  periodFrom: string
  periodTo: string
  affiliates: Array<{
    affiliateId: string
    affiliateName: string
    code: string
    amount: number
    conversionCount: number
    statementIssued: boolean
    bankProfileRegistered: boolean
  }>
  batch: { id: string; state: string; lineCount: number } | null
}

export type AffiliateAccountSettlementResult = {
  kind: 'created' | 'duplicate'
  settlementId: string
  totalAmount: number
  conversionCount: number
  version: number
  closedAt: string
}

export type AffiliatePayoutBatch = {
  id: string
  lineAccountId: string
  settlementId: string
  totalAmount: number
  currency: string
  lineCount: number
  state: string
  bankFormat: string | null
  fileChecksum: string | null
  version: number
  downloadExpiresAt: string | null
  createdAt: string
}

export type AffiliateStatement = {
  id: string
  lineAccountId: string
  affiliateId: string
  settlementId: string
  totalAmount: number
  status: string
  version: number
  expiresAt: string | null
  createdAt: string
}
