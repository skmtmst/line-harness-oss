import { ApiError, type api, type EcNotificationRun, type EcNotificationRunList } from '@/lib/api'

const PAGE_SIZE = 20

type DeliveryAttempt = {
  number: number
  outcome: 'provider_accepted' | 'retry_wait' | 'failed'
  attemptedAt: string
  providerRequestId: string | null
  errorCode: string | null
  error: string | null
}

type NotificationRunItem = EcNotificationRun & {
  resolved?: boolean
  resolvedAt?: string | null
  resolvedBy?: string | null
  attemptHistory?: DeliveryAttempt[]
}

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden'

/**
 * 表示中のLINEアカウント・タブを指す世代。`key` はアカウントとタブの組。
 * 切り替えるたびに `generation` をレンダー中に同期して1つ進める。
 * useEffectで進めると、直前のPromiseがマイクロタスクとしてuseEffectより
 * 先にほどけたとき、古い世代のままisCurrent判定を通してしまい、
 * notice・retrying・reloadが新しい画面へ漏れる（司令塔差し戻しの実例）。
 */
export type NotificationRunScope = { key: string; generation: number }

export type ScopedLoadState = {
  generation: number
  state: LoadState
  result: EcNotificationRunList | null
  total: number
}
export type NotificationRunNotice = { tone: 'success' | 'error'; text: string } | null
export type ScopedNotice = { generation: number; notice: NotificationRunNotice }
export type ScopedRetrying = { generation: number; id: string | null }

export type RunFilter = 'all' | 'failed' | 'excluded' | 'clicked'
export type RecipientFilter = 'all' | EcNotificationRun['recipientType']
export type PeriodFilter = 'all' | '24h' | '7d' | '30d'

const PERIOD_MILLISECONDS: Record<Exclude<PeriodFilter, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

export function filterNotificationRuns(
  items: EcNotificationRun[],
  filters: {
    query: string
    status: RunFilter
    recipient: RecipientFilter
    period: PeriodFilter
  },
  now = Date.now(),
): EcNotificationRun[] {
  const normalized = filters.query.trim().toLocaleLowerCase('ja-JP')
  return items.filter((item) => {
    if (filters.status === 'clicked' && !item.clickedAt) return false
    if (filters.status === 'failed' && item.status !== 'failed') return false
    if (filters.status === 'excluded' && item.status !== 'excluded') return false
    if (filters.recipient !== 'all' && item.recipientType !== filters.recipient) return false
    if (filters.period !== 'all') {
      const receivedAt = new Date(item.receivedAt).getTime()
      if (!Number.isFinite(receivedAt) || receivedAt > now || now - receivedAt > PERIOD_MILLISECONDS[filters.period]) return false
    }
    if (!normalized) return true
    return [item.notificationName, item.friendName, item.orderNumber, item.reason, item.source]
      .some((value) => value?.toLocaleLowerCase('ja-JP').includes(normalized))
  })
}

/** 一覧が叩く口。試験では応答を保留できる偽物へ差し替える。 */
export type NotificationRunPorts = {
  deliveries: typeof api.lineNotifications.deliveries
  notificationRuns: typeof api.ecCommerce.notificationRuns
  retryDelivery: typeof api.lineNotifications.retryDelivery
  resolveDelivery: (
    id: string,
    data: { lineAccountId: string; expectedVersion: number; resolved: boolean },
  ) => Promise<{ success: true; data: { id: string; resolved: boolean; version: number } }>
}

/**
 * 読み込みと再試行が共有する足場。`scopeRef` は今どの世代を表示しているか
 * の唯一の目印で、レンダー本体で同期して更新する（コンポーネント側を
 * 参照）。待っている間に世代が進んだかどうかはここだけで判断する。
 */
export type NotificationRunEnv = {
  requestRef: { current: number }
  mutationRef: { current: { generation: number; id: string } | null }
  scopeRef: { current: NotificationRunScope }
  ports: NotificationRunPorts
  setLoaded: (next: ScopedLoadState) => void
  setNotice: (next: ScopedNotice) => void
  setRetrying: (update: (current: ScopedRetrying) => ScopedRetrying) => void
}

export type NotificationRunLoadParams = {
  generation: number
  lineAccountId: string | null
  mode: 'history' | 'failures'
  page: number
}

export async function loadNotificationRuns(env: NotificationRunEnv, params: NotificationRunLoadParams): Promise<void> {
  const { generation } = params
  const request = ++env.requestRef.current
  // 同じ世代の中でも、後から始めた読み込みだけを採用する（ページ送りなど）。
  const isCurrentRequest = () => request === env.requestRef.current
  if (!params.lineAccountId) {
    env.setLoaded({ generation, state: 'ready', result: null, total: 0 })
    return
  }
  // 世代・状態・結果を1つの更新で切り替え、前世代の成功結果を再表示しない。
  env.setLoaded({ generation, state: 'loading', result: null, total: 0 })
  try {
    const query = {
      lineAccountId: params.lineAccountId,
      view: params.mode === 'failures' ? 'failures' as const : 'all' as const,
      limit: PAGE_SIZE,
      offset: (params.page - 1) * PAGE_SIZE,
    }
    // 古い検証用モックと段階移行中の環境だけ、互換口へ戻す（404のとき1回だけ）。
    let fellBack = false
    const primary = await env.ports.deliveries(query).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) {
        fellBack = true
        return env.ports.notificationRuns(query)
      }
      throw error
    })
    if (!primary.success) throw new Error('load failed')
    // 互換口の結果をもう一度取り直さない。毎回2要求になるのを防ぐ。
    const response = !fellBack && (!primary.pagination || primary.data.coverage?.source !== 'notification_delivery_ledger')
      ? await env.ports.notificationRuns(query)
      : primary
    if (!isCurrentRequest()) return
    if (!response.success) throw new Error('load failed')
    env.setLoaded({
      generation,
      state: 'ready',
      result: response.data,
      total: response.pagination.total,
    })
  } catch (error) {
    if (!isCurrentRequest()) return
    env.setLoaded({
      generation,
      state: error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error',
      result: null,
      total: 0,
    })
  }
}

export type NotificationRunRetryParams = {
  generation: number
  lineAccountId: string | null
  item: NotificationRunItem
  reload: () => Promise<void>
}

export function retryNotificationErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return '送信を再試行できませんでした。時間をおいて読み直してください。'
  if (error.status === 403) return '送信の再試行は店長だけができます。'
  if (error.code === 'quota_insufficient') return '今月の送信枠が足りないため、再試行を止めました。'
  if (error.code === 'quota_unavailable') return '送信枠を確認できないため、再試行を止めました。'
  if (error.code === 'retry_unavailable' || error.code === 'invalid_template') return error.message
  if (error.status === 409) return 'ほかの担当者が先に再試行しました。最新の記録を読み直してください。'
  return '送信を再試行できませんでした。時間をおいて読み直してください。'
}

export async function retryNotificationRun(env: NotificationRunEnv, params: NotificationRunRetryParams): Promise<void> {
  const { item, lineAccountId, generation } = params
  if (!lineAccountId || !item.retryAvailable) return
  if (env.mutationRef.current?.generation === generation) return
  env.mutationRef.current = { generation, id: item.id }
  /*
   * 再試行の応答は、押した時の世代へだけ返す。待っている間に世代が
   * 進んでいたら、知らせも読み直しも捨てる。env.scopeRef.current は
   * コンポーネントのレンダー本体で世代切替と同期して更新されるため、
   * useEffectの発火を待たずに正しい判定ができる。
   */
  const isCurrent = () => env.scopeRef.current.generation === generation
  env.setRetrying(() => ({ generation, id: item.id }))
  env.setNotice({ generation, notice: null })
  try {
    await env.ports.retryDelivery(item.id, {
      lineAccountId,
      expectedVersion: item.recordVersion,
    })
    if (!isCurrent()) return
    env.setNotice({ generation, notice: { tone: 'success', text: '同じ通知の送信を安全に再試行しました。' } })
    await params.reload()
  } catch (error) {
    if (!isCurrent()) return
    const text = retryNotificationErrorMessage(error)
    env.setNotice({ generation, notice: { tone: 'error', text } })
  } finally {
    if (env.mutationRef.current?.generation === generation && env.mutationRef.current.id === item.id) {
      env.mutationRef.current = null
    }
    // 切替後に別の行で始まった再試行の表示までは消さない。
    env.setRetrying((current) => (current.generation === generation && current.id === item.id ? { generation, id: null } : current))
  }
}

export async function resolveNotificationRun(
  env: NotificationRunEnv,
  params: NotificationRunRetryParams & { resolved: boolean },
): Promise<void> {
  const { item, lineAccountId, generation, resolved } = params
  if (!lineAccountId || (item.status !== 'failed' && item.status !== 'excluded')) return
  if (env.mutationRef.current?.generation === generation) return
  env.mutationRef.current = { generation, id: item.id }
  const isCurrent = () => env.scopeRef.current.generation === generation
  env.setRetrying(() => ({ generation, id: item.id }))
  env.setNotice({ generation, notice: null })
  try {
    await env.ports.resolveDelivery(item.id, {
      lineAccountId,
      expectedVersion: item.recordVersion,
      resolved,
    })
    if (!isCurrent()) return
    env.setNotice({
      generation,
      notice: {
        tone: 'success',
        text: resolved ? 'この失敗を対応済みにしました。' : 'この失敗を未対応に戻しました。',
      },
    })
    await params.reload()
  } catch (error) {
    if (!isCurrent()) return
    const text = error instanceof ApiError && error.status === 403
      ? '対応状況を変更する権限がありません。'
      : error instanceof ApiError && error.status === 409
        ? 'ほかの担当者が先に変更しました。最新の記録を読み直してください。'
        : '対応状況を変更できませんでした。時間をおいて読み直してください。'
    env.setNotice({ generation, notice: { tone: 'error', text } })
  } finally {
    if (env.mutationRef.current?.generation === generation && env.mutationRef.current.id === item.id) {
      env.mutationRef.current = null
    }
    env.setRetrying((current) => (current.generation === generation && current.id === item.id
      ? { generation, id: null }
      : current))
  }
}

