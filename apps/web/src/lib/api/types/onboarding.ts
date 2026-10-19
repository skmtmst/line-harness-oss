/** はじめの設定の段。設計 ★管理画面 34-1（`RAW35`）。 */
export type GettingStartedStep = import('@line-crm/shared').GettingStartedStep

/** レシピ。設計 ★管理画面 34-2（`y0P0Qx`）。 */
export interface Recipe {
  id: string
  name: string
  purpose: string
  creates: string
  version: number
  origin: 'builtin' | 'org'
  requiredFeatures: string[]
  /** オフの機能。**空配列は「全部オン」。** */
  missingFeatures: string[]
  /** 作られるものの内訳。**決まっていなければ null**（0 件の表を描かない）。 */
  items: Array<{ kind: string; name: string; note: string }> | null
  itemCount: number | null
  cloneCount: number
}

export interface ManualLink {
  key: string
  keyKind: 'screen' | 'task'
  name: string
  url: string | null
  /** **確かめていない URL は `ok` にならない。** */
  status: 'ok' | 'broken' | 'unset'
  lastCheckedAt: string | null
  lastHttpStatus: number | null
  lastError: string | null
  version: number
}
