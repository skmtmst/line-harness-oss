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
