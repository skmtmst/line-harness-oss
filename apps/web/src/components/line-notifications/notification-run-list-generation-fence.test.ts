import { describe, expect, it } from 'vitest'
import { ApiError, type EcNotificationRun, type EcNotificationRunList } from '@/lib/api'
import {
  loadNotificationRuns,
  retryNotificationRun,
  type NotificationRunEnv,
  type NotificationRunPorts,
  type NotificationRunScope,
  type ScopedLoadState,
  type ScopedNotice,
  type ScopedRetrying,
} from './notification-run-list'

type DeliveriesResult = Awaited<ReturnType<NotificationRunPorts['deliveries']>>
type RetryResult = Awaited<ReturnType<NotificationRunPorts['retryDelivery']>>

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  // 応答を握りつぶさない。捨てた失敗でNodeが落ちるのを防ぐ。
  promise.catch(() => {})
  return { promise, resolve, reject }
}

/** マイクロタスクを流し切り、保留していた応答の続きを最後まで動かす。 */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

function run(id: string, overrides: Partial<EcNotificationRun> = {}): EcNotificationRun {
  return {
    id,
    recipientType: 'customer',
    notificationName: '発送のお知らせ',
    source: 'EC連携',
    sourceEventId: `event-${id}`,
    friendId: `friend-${id}`,
    friendName: `顧客 ${id}`,
    orderNumber: `NEN-${id}`,
    channel: 'line',
    status: 'failed',
    reason: 'LINE APIが一時的に受け付けませんでした',
    receivedAt: '2026-09-09T11:00:00+09:00',
    acceptedAt: null,
    attemptCount: 1,
    nextRetryAt: null,
    clickedAt: null,
    version: 1,
    executionMode: 'automatic',
    retryAvailable: true,
    recordVersion: 1,
    providerStatus: null,
    ...overrides,
  }
}

function list(items: EcNotificationRun[], failed: number): EcNotificationRunList {
  return {
    items,
    summary: { accepted: 0, failed, excluded: 0, pending: 0 },
    coverage: {
      source: 'notification_delivery_ledger',
      unassignedHistoricalRowsExcluded: true,
      attemptHistoryAvailable: true,
      retryAvailable: true,
    },
  }
}

function ok(items: EcNotificationRun[], failed: number): DeliveriesResult {
  return {
    success: true,
    data: list(items, failed),
    pagination: { total: items.length, limit: 20, offset: 0 },
  }
}

function harness() {
  const requestRef = { current: 0 }
  const scopeRef: { current: NotificationRunScope } = { current: { key: '', generation: 0 } }
  const loads: ScopedLoadState[] = []
  const notices: ScopedNotice[] = []
  const retryings: ScopedRetrying[] = []
  const deliveryCalls: Array<{ lineAccountId: string; deferred: Deferred<DeliveriesResult> }> = []
  const retryCalls: Array<{ id: string; lineAccountId: string; deferred: Deferred<RetryResult> }> = []

  const env: NotificationRunEnv = {
    requestRef,
    scopeRef,
    ports: {
      deliveries: (params) => {
        const call = { lineAccountId: params.lineAccountId, deferred: deferred<DeliveriesResult>() }
        deliveryCalls.push(call)
        return call.deferred.promise
      },
      // 互換口へは落ちない形の応答だけを返すため、呼ばれたら試験の作りが誤り。
      notificationRuns: () => { throw new Error('互換口は呼ばれないはず') },
      retryDelivery: (id, data) => {
        const call = { id, lineAccountId: data.lineAccountId, deferred: deferred<RetryResult>() }
        retryCalls.push(call)
        return call.deferred.promise
      },
    },
    setLoaded: (next) => { loads.push(next) },
    setNotice: (next) => { notices.push(next) },
    setRetrying: (update) => { retryings.push(update(retryings[retryings.length - 1] ?? { generation: -1, id: null })) },
  }

  /** 実コンポーネントのレンダー本体がやる、世代の同期切替を模す。 */
  const enterGeneration = (generation: number, key: string) => {
    scopeRef.current = { key, generation }
  }

  return {
    env,
    deliveryCalls,
    retryCalls,
    loads,
    notices,
    retryings,
    enterGeneration,
    load: (generation: number, lineAccountId: string | null) =>
      loadNotificationRuns(env, { generation, lineAccountId, mode: 'failures', page: 1 }),
    retry: (generation: number, lineAccountId: string, item: EcNotificationRun, reload: () => Promise<void>) =>
      retryNotificationRun(env, { generation, lineAccountId, item, reload }),
    /** 画面が実際に見せている状態。世代が合わない結果は描かれない。 */
    visible: (generation: number) => {
      const last = loads[loads.length - 1]
      if (!last || last.generation !== generation) return { state: 'loading' as const, items: [] as EcNotificationRun[], failed: null }
      return { state: last.state, items: last.result?.items ?? [], failed: last.result?.summary.failed ?? null }
    },
    visibleNotice: (generation: number) => {
      const last = notices[notices.length - 1]
      return last && last.generation === generation ? last.notice : null
    },
  }
}

describe('LINE通知一覧の世代フェンス（純粋関数レベル）', () => {
  it('Aの表示後にBへ切り替えると、Bの応答が来るまでAの行と集計を出さない', async () => {
    const h = harness()
    h.enterGeneration(0, 'account-a:failures')
    void h.load(0, 'account-a')
    h.deliveryCalls[0].deferred.resolve(ok([run('Aの通知')], 7))
    await settle()
    expect(h.visible(0)).toMatchObject({ state: 'ready', failed: 7 })

    h.enterGeneration(1, 'account-b:failures')
    void h.load(1, 'account-b')
    await settle()
    expect(h.visible(1).state).toBe('loading')

    h.deliveryCalls[1].deferred.resolve(ok([run('Bの通知')], 2))
    await settle()
    expect(h.visible(1)).toMatchObject({ state: 'ready', failed: 2 })
  })

  it('Aの遅い応答はB成功後の行と集計を上書きしない', async () => {
    const h = harness()
    h.enterGeneration(0, 'account-a:failures')
    void h.load(0, 'account-a')
    h.enterGeneration(1, 'account-b:failures')
    void h.load(1, 'account-b')
    h.deliveryCalls[1].deferred.resolve(ok([run('B成功通知')], 2))
    await settle()
    expect(h.visible(1)).toMatchObject({ state: 'ready', failed: 2 })

    h.deliveryCalls[0].deferred.resolve(ok([run('A遅延通知')], 9))
    await settle()
    expect(h.visible(1)).toMatchObject({ state: 'ready', failed: 2 })
  })

  it('レンダー本体で世代を同期して進めていれば、世代切替後の再試行は読み直しを始めない', async () => {
    const h = harness()
    h.enterGeneration(0, 'account-a:failures')
    void h.load(0, 'account-a')
    h.deliveryCalls[0].deferred.resolve(ok([run('Aの通知')], 7))
    await settle()

    let reloadCalls = 0
    const reloadA = async () => { reloadCalls += 1; await h.load(0, 'account-a') }
    void h.retry(0, 'account-a', run('Aの通知'), reloadA)
    // レンダー本体は、次のuseEffectが動く前に同期して世代を進める。
    h.enterGeneration(1, 'account-b:failures')
    void h.load(1, 'account-b')
    await settle()

    h.retryCalls[0].deferred.resolve({ success: true } as RetryResult)
    await settle()
    // 世代がすでに進んでいるため、Aの成功はAの読み直しを一度も呼ばない。
    expect(reloadCalls).toBe(0)
    expect(h.deliveryCalls).toHaveLength(2)
    expect(h.visibleNotice(1)).toBeNull()

    h.deliveryCalls[1].deferred.resolve(ok([run('Bの通知')], 2))
    await settle()
    expect(h.visible(1)).toMatchObject({ state: 'ready', failed: 2 })
  })

  it('世代切替後は、Aの再試行の成功・403・409・500いずれも新しい世代へ知らせを出さない', async () => {
    for (const status of [403, 409, 500, 'success'] as const) {
      const h = harness()
      h.enterGeneration(0, 'account-a:failures')
      void h.load(0, 'account-a')
      h.deliveryCalls[0].deferred.resolve(ok([run('Aの通知')], 7))
      await settle()

      let reloadCalls = 0
      void h.retry(0, 'account-a', run('Aの通知'), async () => { reloadCalls += 1 })
      h.enterGeneration(1, 'account-b:failures')
      void h.load(1, 'account-b')
      await settle()

      if (status === 'success') {
        h.retryCalls[0].deferred.resolve({ success: true } as RetryResult)
      } else {
        h.retryCalls[0].deferred.reject(new ApiError(status, 'retry failed'))
      }
      await settle()
      expect(h.visibleNotice(1)).toBeNull()
      expect(reloadCalls).toBe(0)
    }
  })

  it('世代を進めなければ、これまでどおり再試行の成功・失敗を知らせ、読み直す', async () => {
    const h = harness()
    h.enterGeneration(0, 'account-a:failures')
    void h.load(0, 'account-a')
    h.deliveryCalls[0].deferred.resolve(ok([run('Aの通知')], 7))
    await settle()

    let reloadCalls = 0
    void h.retry(0, 'account-a', run('Aの通知'), async () => { reloadCalls += 1 })
    h.retryCalls[0].deferred.resolve({ success: true } as RetryResult)
    await settle()
    expect(h.visibleNotice(0)).toEqual({ tone: 'success', text: '同じ通知の送信を安全に再試行しました。' })
    expect(reloadCalls).toBe(1)

    for (const [status, text] of [
      [403, '送信の再試行は店長だけができます。'],
      [409, 'ほかの担当者が先に再試行しました。最新の記録を読み直してください。'],
      [500, '送信を再試行できませんでした。時間をおいて読み直してください。'],
    ] as const) {
      const failing = harness()
      failing.enterGeneration(0, 'account-a:failures')
      void failing.load(0, 'account-a')
      failing.deliveryCalls[0].deferred.resolve(ok([run('Aの通知')], 7))
      await settle()
      void failing.retry(0, 'account-a', run('Aの通知'), async () => {})
      failing.retryCalls[0].deferred.reject(new ApiError(status, 'retry failed'))
      await settle()
      expect(failing.visibleNotice(0)).toEqual({ tone: 'error', text })
    }
  })

  it('取得失敗・権限なし・実値0を別の状態として区別する', async () => {
    const failure = harness()
    failure.enterGeneration(0, 'account-a:failures')
    void failure.load(0, 'account-a')
    failure.deliveryCalls[0].deferred.reject(new ApiError(500, 'server error'))
    await settle()
    expect(failure.visible(0)).toMatchObject({ state: 'error', items: [], failed: null })

    const forbidden = harness()
    forbidden.enterGeneration(0, 'account-a:failures')
    void forbidden.load(0, 'account-a')
    forbidden.deliveryCalls[0].deferred.reject(new ApiError(403, 'forbidden'))
    await settle()
    expect(forbidden.visible(0).state).toBe('forbidden')

    const empty = harness()
    empty.enterGeneration(0, 'account-a:failures')
    void empty.load(0, 'account-a')
    empty.deliveryCalls[0].deferred.resolve(ok([], 0))
    await settle()
    expect(empty.visible(0)).toMatchObject({ state: 'ready', items: [], failed: 0 })

    const noAccount = harness()
    noAccount.enterGeneration(0, 'none:failures')
    await noAccount.load(0, null)
    expect(noAccount.deliveryCalls).toHaveLength(0)
    expect(noAccount.visible(0)).toMatchObject({ state: 'ready', items: [] })
  })
})
