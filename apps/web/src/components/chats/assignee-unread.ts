import type { InboxStats } from '@/lib/api'

/**
 * 担当者ごとの未読数（設計 `YZaDK`／`/chats` の「担当者で絞り込む」）。
 *
 * **画面に見えている行から数えない。** 一覧はページ送りされるので、
 * 2ページ目の未読が落ちる。数は `GET /api/chats/stats` の集計を使う。
 */

export const NOT_AVAILABLE = '—'

export type AssigneeOption = {
  value: string
  name: string
  /** 未読数。集計が読めていないときは `null`。**0とは別。** */
  unread: number | null
  label: string
}

export type Operator = { id: string; name: string }

function labelOf(name: string, unread: number | null): string {
  return `${name} ${unread === null ? NOT_AVAILABLE : unread}`
}

/**
 * 選択肢を組み立てる。
 *
 * - `assigneeUnread` に出てこない担当者は **実値0**（0件は配列に載らない契約）
 * - 集計が読めていないとき（`null`）は **数だけ `—`**。
 *   **選択肢そのものは消さない**——担当者一覧は `/api/operators` の結果で、
 *   集計の失敗とは別の口。消すと、選んでいた担当者が画面から消える
 * - 「すべて」は担当者ではないので数を付けない
 */
export function assigneeOptions(
  operators: ReadonlyArray<Operator>,
  assigneeUnread: InboxStats['assigneeUnread'] | null,
): AssigneeOption[] {
  const byId = new Map<string | null, number>()
  for (const row of assigneeUnread ?? []) byId.set(row.operatorId, row.unread)

  const unreadOf = (operatorId: string | null): number | null => {
    if (assigneeUnread === null) return null
    return byId.get(operatorId) ?? 0
  }

  const unassigned = unreadOf(null)
  return [
    { value: 'all', name: 'すべて', unread: null, label: 'すべて' },
    {
      value: 'unassigned',
      name: '未割り当て',
      unread: unassigned,
      label: labelOf('未割り当て', unassigned),
    },
    ...operators.map((operator) => {
      const unread = unreadOf(operator.id)
      return { value: operator.id, name: operator.name, unread, label: labelOf(operator.name, unread) }
    }),
  ]
}

/**
 * 集計を読み直す必要があるか。
 *
 * **アカウントを切り替えたら、前の集計はその場で捨てる。** 読み終わるまで
 * 残すと、別のアカウントの未読数を見たまま担当者を選ぶことになる。
 */
export function shouldDropStats(
  previousAccountId: string | null,
  nextAccountId: string | null,
): boolean {
  return previousAccountId !== nextAccountId
}
