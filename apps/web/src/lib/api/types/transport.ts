export type ApiAccountEventDetail = {
  /** 呼び出した時点の対象。未指定・複数店舗のときは null。 */
  accountId: string | null
  accountIds?: string[]
  featureContext?: import('../../feature-disabled-context').FeatureDisabledContext
}

export type FeatureDisabledEventDetail = Partial<ApiAccountEventDetail> & {
  featureId?: string
}

/**
 * fetchApi の呼び出し側だけが決める挙動。
 * 機能の本体画面ではない場所（流入計測のプール候補など）から補助データとして
 * 任意機能のAPIを呼ぶとき、その機能がオフでも画面全体を共通ゲートへ
 * 切り替えないよう FEATURE_DISABLED の合図を出さない。
 */
export interface FetchApiOptions extends RequestInit {
  suppressFeatureDisabledEvent?: boolean
  /** IDだけを持つ経路など、URLに対象アカウントがない呼び出し用。 */
  accountId?: string | null
}
