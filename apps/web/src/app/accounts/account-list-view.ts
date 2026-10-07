import type { LineAccount } from '@line-crm/shared'

/**
 * 一覧に出す言葉。**画面から切り離して、試験で確かめられるようにする。**
 *
 * 設計 ★V6 33-1（`QT91v`）の列は
 * アカウント / 接続状態 / Webhook / 友だち / 既定 / 親アカウント / 操作。
 */

/** 接続状態。板 V7vn3：正常／確認停止中／アーカイブ。**色だけに頼らず、必ず文字で言う。** */
export function connectionLabel(account: LineAccount): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  if (account.archivedAt) return { label: 'アーカイブ', tone: 'neutral' }
  return account.isActive
    ? { label: '正常', tone: 'success' }
    : { label: '確認停止中', tone: 'warning' }
}

/**
 * Webhook の照合結果。板 V7vn3：正常／未確認。
 * 合っていない・登録が無い・まだ確かめていないは、どれも「未確認」にまとめる。
 * 直し方は詳しい画面で言い分ける。
 */
export function webhookLabel(
  account: LineAccount,
): { label: string; tone: 'success' | 'neutral' } {
  return account.webhook?.status === 'matched'
    ? { label: '正常', tone: 'success' }
    : { label: '未確認', tone: 'neutral' }
}

/** 絞り込みの区分。板 V7vn3 と同じ並び。 */
export type AccountFilter = 'all' | 'active' | 'inactive' | 'archived' | 'problem'

export const ACCOUNT_FILTERS: ReadonlyArray<{ value: AccountFilter; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'active', label: '稼働中' },
  { value: 'inactive', label: '停止中' },
  { value: 'problem', label: '接続に問題' },
  { value: 'archived', label: 'アーカイブ' },
]

/** 接続に問題がある＝Webhook が合っていない、または登録されていない。 */
export function hasConnectionProblem(account: LineAccount): boolean {
  return account.webhook?.status === 'mismatched' || account.webhook?.status === 'unconfigured'
}

export function matchesFilter(account: LineAccount, filter: AccountFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'active') return account.isActive && !account.archivedAt
  if (filter === 'inactive') return !account.isActive && !account.archivedAt
  if (filter === 'archived') return Boolean(account.archivedAt)
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
 * 親が無いものは `—`（`docs/v8-design-rules.md` §5 の未取得表示）。
 */
export function parentName(account: LineAccount, all: LineAccount[]): string {
  if (!account.parentLineAccountId) return '—'
  return all.find((a) => a.id === account.parentLineAccountId)?.name ?? '—'
}
