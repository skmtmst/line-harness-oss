export interface FriendDetail {
  id: string
  displayName: string | null
  pictureUrl: string | null
  isFollowing: boolean
  metadata: Record<string, unknown>
  /** 100 で足した列。LINEの表示名とは別に、こちらで付けた名前。 */
  realName: string | null
  /** 社内での呼び名。表示名が本名と違うときに使う。 */
  systemDisplayName: string | null
  refCode: string | null
  /** N-036: 友だち詳細と同じ流入元名。無い・消えた経路は null。 */
  firstTrackedLinkName: string | null
  /** フォーム回答の総数。formSubmissions は最新10件までのため、続きの有無はこれで判別する。 */
  formSubmissionTotal?: number | null
  createdAt: string
  tags: Array<{ id: string; name: string; color: string }>
  formSubmissions: Array<{
    id: string
    formId: string
    formName: string
    fields: Array<{ name: string; label: string }>
    data: Record<string, unknown>
    createdAt: string
  }>
}


export interface ChatStatusInfo {
  status: 'unread' | 'in_progress' | 'on_hold' | 'resolved' | null
  notes: string | null
}

export interface Props {
  friendId: string | null
  /** 親 (ChatDetail) が持っている chat 側の情報 — status / notes */
  chatStatus?: ChatStatusInfo
  /** 担当者名 (ChatDetail で operatorId → name 変換済を渡す想定) */
  operatorName?: string | null
  /** A-2 その場で直すための会話 ID。無いときは表示のみ（従来どおり）。 */
  lastContactAt?: string | null
  chatId?: string | null
  /** 同時編集の見分け札（chats.revision）。無いときは送らない。 */
  revision?: number
  /** 担当の選択肢。無いときは担当の変更欄を出さない。 */
  operators?: Array<{ id: string; name: string }>
  /** 現在の担当 ID。無いときは未割り当て扱い。 */
  operatorId?: string | null
  /** 開いているLINEアカウントの ID。前払いのみの印に使う。無いときは印を出さない。 */
  accountId?: string | null
  /** 保存が通ったあとに親へ知らせる（一覧の読み直しなど）。 */
  onChatChanged?: () => void
}
