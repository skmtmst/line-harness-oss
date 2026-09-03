/**
 * 受信箱の保存した検索の中身。
 *
 * `page.tsx` の中に置いていたが、要約を別ファイルにするために出した。
 * **友だち側の `SavedSearchConditions` とは別の形。** あちらは AND/OR の
 * 条件の並びで、こちらは軸ごとの値を持つ。同じ名前で呼ばない。
 */
export type InboxSavedViewConditions = {
  version: 1
  query: string
  channels: Array<'line' | 'email'>
  statuses: Array<'unread' | 'in_progress' | 'on_hold' | 'resolved'>
  assignees: string[]
  unread: 'all' | 'mine'
  messageTypes: string[]
  receivedFrom: string | null
  receivedTo: string | null
  sort: 'newest' | 'waiting_desc'
}

/** 何も絞っていない状態。**分からない形は、これに倒す。** */
const NOTHING_FILTERED: InboxSavedViewConditions = {
  version: 1,
  query: '',
  channels: [],
  statuses: [],
  assignees: [],
  unread: 'all',
  messageTypes: [],
  receivedFrom: null,
  receivedTo: null,
  sort: 'newest',
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

/**
 * 保存されている中身を、画面が読める形にそろえる。
 *
 * **受信箱より前に作られた行がある。** 保存した検索の仕組みは受信箱より
 * 先にあり、古い行は友だち側と同じ `{ all: [], any: [] }` の形で入っている。
 * Worker は `JSON.parse(row.conditions_json)` をそのまま返すので、
 * **画面が形を確かめずに `conditions.statuses.length` を読むと、
 * 受信箱ごと真っ白になる。**
 *
 * 知っている軸だけを拾い、分からない形は「何も絞っていない」として扱う。
 * **落とさずに開けることを、絞れることより優先する。**
 */
export function normalizeSavedViewConditions(raw: unknown): InboxSavedViewConditions {
  if (!raw || typeof raw !== 'object') return NOTHING_FILTERED
  const source = raw as Record<string, unknown>
  const pick = <T extends string>(key: string, allowed: readonly T[]): T[] => {
    const value = source[key]
    if (!isStringArray(value)) return []
    return value.filter((item): item is T => (allowed as readonly string[]).includes(item))
  }
  return {
    version: 1,
    query: typeof source.query === 'string' ? source.query : '',
    channels: pick('channels', ['line', 'email'] as const),
    statuses: pick('statuses', ['unread', 'in_progress', 'on_hold', 'resolved'] as const),
    assignees: isStringArray(source.assignees) ? source.assignees : [],
    unread: source.unread === 'mine' ? 'mine' : 'all',
    messageTypes: isStringArray(source.messageTypes) ? source.messageTypes : [],
    receivedFrom: typeof source.receivedFrom === 'string' ? source.receivedFrom : null,
    receivedTo: typeof source.receivedTo === 'string' ? source.receivedTo : null,
    sort: source.sort === 'waiting_desc' ? 'waiting_desc' : 'newest',
  }
}
