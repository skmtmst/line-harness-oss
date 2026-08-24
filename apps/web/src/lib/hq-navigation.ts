export const ACCOUNT_SELECTION_KEY = 'lh_selected_account'
export const AUTH_SELECTION_CLEARED_KEY = 'lh_auth_selection_cleared'

export const HQ_OPEN_TARGETS = {
  tags: { label: 'タグ', destination: '/tags' },
  templates: { label: 'テンプレート管理', destination: '/templates' },
  'rich-menus': { label: 'リッチメニュー管理', destination: '/rich-menus' },
  'form-submissions': { label: '回答フォーム管理', destination: '/form-submissions' },
} as const

export type HqOpenTargetKey = keyof typeof HQ_OPEN_TARGETS
export type HqOpenTarget = (typeof HQ_OPEN_TARGETS)[HqOpenTargetKey] & { key: HqOpenTargetKey }

export function hqOpenHref(target: HqOpenTargetKey): string {
  return `/hq/open?target=${target}`
}

/** 許可済みの値だけを行き先へ解決し、任意URLは決して受け付けない。 */
export function resolveHqOpenTarget(value: string | null): HqOpenTarget | null {
  if (!value || !Object.prototype.hasOwnProperty.call(HQ_OPEN_TARGETS, value)) return null
  const key = value as HqOpenTargetKey
  return { key, ...HQ_OPEN_TARGETS[key] }
}

export type RootLandingDecision =
  | { action: 'show-dashboard' }
  | { action: 'select-account'; accountId: string }
  | { action: 'go-hq' }
  | { action: 'wait' }

/** ログイン直後の着地点を、前回値ではなく見える店舗数だけで決める。 */
export function decideRootLanding(
  loading: boolean,
  selectedAccountId: string | null,
  visibleAccountIds: string[],
): RootLandingDecision {
  if (loading) return { action: 'wait' }
  if (selectedAccountId) return { action: 'show-dashboard' }
  if (visibleAccountIds.length === 1) {
    return { action: 'select-account', accountId: visibleAccountIds[0] }
  }
  return { action: 'go-hq' }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * 1回の認証セッションにつき一度だけ前回の店舗選択を捨てる。
 * AuthGuard は画面遷移ごとにセッションを再確認するため、毎回消すと
 * 同じセッション内の店舗ログインまで解除してしまう。
 */
export function clearSelectionAfterAuthentication(
  local: StorageLike,
  session: StorageLike,
): boolean {
  if (session.getItem(AUTH_SELECTION_CLEARED_KEY) === '1') return false
  local.removeItem(ACCOUNT_SELECTION_KEY)
  session.setItem(AUTH_SELECTION_CLEARED_KEY, '1')
  return true
}
