import type { InboxStats } from '@/lib/api'

/**
 * 担当者ごとの未読数（設計 `YZaDK`／`/chats` の「担当者で絞り込む」）。
 *
 * **画面に見えている行から数えない。** 一覧はページ送りされるので、
 * 2ページ目の未読が落ちる。数は `GET /api/chats/stats` の集計を使う。
 */

export const NOT_AVAILABLE = '—'

/** 担当者ではない行。数を付けない。 */
export const ALL = 'all'
/** 担当がまだ決まっていない会話。集計では `operatorId` が `null` の行。 */
export const UNASSIGNED = 'unassigned'

export type AssigneeOption = {
  value: string
  name: string
  /** 未読数。集計が読めていないときは `null`。**0とは別。** */
  unread: number | null
  label: string
}

export type Operator = { id: string; name: string }

/** 未読数の引き方。**数の規則はここ1つだけにする。** */
export type UnreadLookup = (value: string) => number | null

/**
 * 選び口の行に添える未読数を引く。
 *
 * - 集計が読めていないとき（`null`）は **どの行も `null`**。
 *   数だけ `—` にして、**選択肢そのものは消さない**——担当者一覧は
 *   `/api/operators` の結果で、集計の失敗とは別の口。消すと、
 *   選んでいた担当者が画面から消える
 * - 集計に出てこない担当者は **実値0**（0件は配列に載らない契約）
 * - 「すべて」は担当者ではないので数を付けない
 */
export function unreadLookup(
  assigneeUnread: InboxStats['assigneeUnread'] | null,
): UnreadLookup {
  if (assigneeUnread === null) return () => null
  const byId = new Map<string, number>()
  for (const row of assigneeUnread) {
    byId.set(row.operatorId ?? UNASSIGNED, row.unread)
  }
  return (value) => (value === ALL ? null : byId.get(value) ?? 0)
}

/** 名前の右に数を添える。読み上げ名は「Kenta 3」になる。 */
export function assigneeLabel(name: string, unread: number | null): string {
  return unread === null ? `${name} ${NOT_AVAILABLE}` : `${name} ${unread}`
}

/**
 * 選択肢を組み立てる。数の規則は `unreadLookup` に寄せてある。
 *
 * 選び口の部品（`OperatorDropdown`）は行を自前で並べるので、
 * こちらは**規則を1か所に置くため**と、その規則を試験で押さえるために使う。
 */
export function assigneeOptions(
  operators: ReadonlyArray<Operator>,
  assigneeUnread: InboxStats['assigneeUnread'] | null,
): AssigneeOption[] {
  const unreadOf = unreadLookup(assigneeUnread)
  const row = (value: string, name: string): AssigneeOption => {
    const unread = unreadOf(value)
    return { value, name, unread, label: value === ALL ? name : assigneeLabel(name, unread) }
  }
  return [
    row(ALL, 'すべて'),
    row(UNASSIGNED, '未割り当て'),
    ...operators.map((operator) => row(operator.id, operator.name)),
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
