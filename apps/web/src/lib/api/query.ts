/** 集計の期間をクエリにする。省略時はサーバー側の既定（直近30日）に任せる。 */
export function rangeQuery(params?: { from?: string; to?: string; accountId?: string }): string {
  const q = new URLSearchParams()
  if (params?.from) q.set('from', params.from)
  if (params?.to) q.set('to', params.to)
  if (params?.accountId) q.set('account_id', params.accountId)
  const s = q.toString()
  return s ? `?${s}` : ''
}
