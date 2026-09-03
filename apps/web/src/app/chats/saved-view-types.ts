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
