/**
 * 保存した検索の中身を、名前の下に出せる一行にする（設計 `ASsb3` 2-13）。
 *
 * **名前だけ並んでいると、どれを押せばよいか名前から推測することになる。**
 * 「VIPかつ未契約」が対応マークで絞っているのか担当者で絞っているのかは、
 * 押して当ててみるまで分からなかった。
 *
 * 出すのは**返ってきている条件だけ**。当たる件数は、いまの読み口では
 * 一覧を丸ごと数え直さないと出せないので入れない（数を作らない）。
 */
export type SavedViewConditions = {
  query: string
  channels: Array<'line' | 'email'>
  statuses: Array<'unread' | 'in_progress' | 'on_hold' | 'resolved'>
  assignees: string[]
  unread: 'all' | 'mine'
  messageTypes: string[]
  receivedFrom: string | null
  receivedTo: string | null
}

const STATUS_LABELS: Record<SavedViewConditions['statuses'][number], string> = {
  unread: '未対応',
  in_progress: '対応中',
  on_hold: '保留',
  resolved: '完了',
}

const CHANNEL_LABELS: Record<SavedViewConditions['channels'][number], string> = {
  line: 'LINE',
  email: 'メール',
}

/** 担当者のidを名前へ。分からないidは「不明な担当者」。**idをそのまま出さない。** */
function assigneeLabel(id: string, operators: Array<{ id: string; name: string }>): string {
  if (id === 'unassigned') return '未割り当て'
  return operators.find((operator) => operator.id === id)?.name ?? '不明な担当者'
}

/**
 * 条件の要約。**何も絞っていなければ「すべての会話」**と言う。
 * 空文字を返すと、名前の下に何も無い行ができて「読み込み中」に見える。
 */
export function savedViewSummary(
  conditions: SavedViewConditions,
  operators: Array<{ id: string; name: string }>,
): string {
  const parts: string[] = []
  if (conditions.statuses.length > 0) {
    parts.push(conditions.statuses.map((s) => STATUS_LABELS[s]).join('・'))
  }
  if (conditions.assignees.length > 0) {
    parts.push(`担当 ${conditions.assignees.map((id) => assigneeLabel(id, operators)).join('・')}`)
  }
  if (conditions.unread === 'mine') parts.push('自分の未読だけ')
  if (conditions.channels.length > 0) {
    parts.push(conditions.channels.map((c) => CHANNEL_LABELS[c]).join('・'))
  }
  if (conditions.messageTypes.length > 0) {
    parts.push(`種別 ${conditions.messageTypes.length}件`)
  }
  if (conditions.receivedFrom || conditions.receivedTo) {
    parts.push(`受信 ${conditions.receivedFrom ?? ''}〜${conditions.receivedTo ?? ''}`)
  }
  if (conditions.query) parts.push(`「${conditions.query}」を含む`)
  return parts.length === 0 ? 'すべての会話' : parts.join(' ／ ')
}

/**
 * 返ってきた条件を、画面が読める形にそろえる。
 *
 * **Workerは `conditions` を `JSON.parse(...) as unknown` でそのまま返す**
 * （`apps/worker/src/routes/chats.ts:135`）。保存した検索の仕組みは
 * 受信箱より前からあり、古い行は `{ all: [], any: [] }` の形で入っている。
 * 画面はそれを `InboxSavedViewConditions` と決めつけて `statuses.length` を
 * 読んでいたので、**古い保存を開くと受信箱ごと落ちていた**（撮影で落ちた）。
 *
 * 分からない形は「何も絞っていない」として扱う。落とすより、
 * すべての会話が出るほうが直せる。
 */
export function normalizeSavedViewConditions(value: unknown): SavedViewConditions {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const strings = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : []
  const oneOf = <T extends string>(input: unknown, allowed: readonly T[]): T[] =>
    strings(input).filter((item): item is T => (allowed as readonly string[]).includes(item))

  return {
    query: typeof raw.query === 'string' ? raw.query : '',
    channels: oneOf(raw.channels, ['line', 'email'] as const),
    statuses: oneOf(raw.statuses, ['unread', 'in_progress', 'on_hold', 'resolved'] as const),
    assignees: strings(raw.assignees),
    unread: raw.unread === 'mine' ? 'mine' : 'all',
    messageTypes: strings(raw.messageTypes),
    receivedFrom: typeof raw.receivedFrom === 'string' ? raw.receivedFrom : null,
    receivedTo: typeof raw.receivedTo === 'string' ? raw.receivedTo : null,
  }
}
