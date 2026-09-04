import type { LineAccount } from '@line-crm/shared'

/**
 * 一覧に出す言葉。**画面から切り離して、試験で確かめられるようにする。**
 *
 * 設計 ★V6 33-1（`QT91v`）の列は
 * アカウント / 接続状態 / Webhook / 友だち / 既定 / 親アカウント / 操作。
 */

/** 接続状態。**色だけに頼らず、必ず文字で言う。** */
export function connectionLabel(account: LineAccount): { label: string; tone: 'success' | 'neutral' } {
  return account.isActive
    ? { label: '稼働中', tone: 'success' }
    : { label: '停止中', tone: 'neutral' }
}

/**
 * Webhook の照合結果。
 *
 * **「確認していません」と「合っていません」を言い分ける。**
 * どちらも「届かないかもしれない」だが、運用者のやることが違う——
 * 前者は確かめる、後者は直す。
 */
export function webhookLabel(
  account: LineAccount,
): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  switch (account.webhook?.status) {
    case 'matched':
      return { label: '一致・利用中', tone: 'success' }
    case 'mismatched':
      return { label: 'URLが違います', tone: 'warning' }
    case 'unconfigured':
      return { label: '登録されていません', tone: 'warning' }
    default:
      // `unknown` と、そもそも `webhook` が付かないとき。
      return { label: '確認していません', tone: 'neutral' }
  }
}

/** 絞り込みの区分。設計のタブと同じ並び。 */
export type AccountFilter = 'all' | 'active' | 'inactive' | 'problem'

export const ACCOUNT_FILTERS: ReadonlyArray<{ value: AccountFilter; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'active', label: '稼働中' },
  { value: 'inactive', label: '停止中' },
  { value: 'problem', label: '接続に問題' },
]

/** 接続に問題がある＝Webhook が合っていない、または登録されていない。 */
export function hasConnectionProblem(account: LineAccount): boolean {
  return account.webhook?.status === 'mismatched' || account.webhook?.status === 'unconfigured'
}

export function matchesFilter(account: LineAccount, filter: AccountFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'active') return account.isActive
  if (filter === 'inactive') return !account.isActive
  return hasConnectionProblem(account)
}

/** 名前とチャネルIDで絞る。打つたびに取り直さない。 */
export function matchesQuery(account: LineAccount, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return account.name.toLowerCase().includes(q) || account.channelId.toLowerCase().includes(q)
}

/**
 * 親アカウントの名前。**IDをそのまま出さない。**
 * 親が無いものは `—`（`docs/v6-common-rules.md` の未取得表示）。
 */
export function parentName(account: LineAccount, all: LineAccount[]): string {
  if (!account.parentLineAccountId) return '—'
  return all.find((a) => a.id === account.parentLineAccountId)?.name ?? '—'
}
