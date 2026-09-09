import { describe, expect, it } from 'vitest'
import { ApiError, type EcNotificationRun, type EcNotificationRunList } from '@/lib/api'
import {
  loadNotificationRuns,
  retryNotificationRun,
  type NotificationRunEnv,
  type NotificationRunNotice,
  type NotificationRunPorts,
  type ScopedLoadState,
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
  const scopeRef = { current: '' }
  const loads: ScopedLoadState[] = []
  const notices: NotificationRunNotice[] = []
  let retryingId: string | null = null
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
    setRetrying: (update) => { retryingId = update(retryingId) },
  }

  const start = (scope: string, lineAccountId: string | null) =>
    loadNotificationRuns(env, { scope, lineAccountId, mode: 'failures', page: 1 })

  return {
    env,
    deliveryCalls,
    retryCalls,
    loads,
    notices,
    start,
    retry: (scope: string, lineAccountId: string, item: EcNotificationRun) =>
      retryNotificationRun(env, { scope, lineAccountId, item, reload: () => start(scope, lineAccountId) }),
    retryingId: () => retryingId,
    /** 画面が実際に見せている状態。scopeが合わない結果は描かれない。 */
    visible: (scope: string) => {
      const last = loads[loads.length - 1]
      if (!last || last.scope !== scope) return { state: 'loading' as const, items: [] as EcNotificationRun[], failed: null }
      return { state: last.state, items: last.result?.items ?? [], failed: last.result?.summary.failed ?? null }
    },
  }
}

const A = 'account-a:failures'
const B = 'account-b:failures'

describe('LINE通知一覧のアカウント切替と再試行', () => {
  it('Aの表示後にBへ切り替えると、Bの応答が来るまでAの行と集計を出さない', async () => {
    const h = harness()
    void h.start(A, 'account-a')
    h.deliveryCalls[0].deferred.resolve(ok([run('Aの通知')], 7))
    await settle()
    expect(h.visible(A)).toMatchObject({ state: 'ready', failed: 7 })

    void h.start(B, 'account-b')
    await settle()
    expect(h.visible(B).state).toBe('loading')
    expect(h.loads.filter((entry) => entry.scope === B && entry.result !== null)).toEqual([])

    h.deliveryCalls[1].deferred.resolve(ok([run('Bの通知')], 2))
    await settle()
    expect(h.visible(B)).toMatchObject({ state: 'ready', failed: 2 })
    expect(h.visible(B).items.map((item) => item.id)).toEqual(['Bの通知'])
  })

  it('Aの遅い応答はB成功後の行と集計を上書きしない', async () => {
    const h = harness()
    void h.start(A, 'account-a')
    void h.start(B, 'account-b')
    h.deliveryCalls[1].deferred.resolve(ok([run('B成功通知')], 2))
    await settle()
    expect(h.visible(B)).toMatchObject({ state: 'ready', failed: 2 })

    h.deliveryCalls[0].deferred.resolve(ok([run('A遅延通知')], 9))
    await settle()
    expect(h.visible(B)).toMatchObject({ state: 'ready', failed: 2 })
    expect(h.visible(B).items.map((item) => item.id)).toEqual(['B成功通知'])
  })

  it('再試行の待機中にBへ切り替えると、Aの成功でBを読み込み中のまま止めない', async () => {
    const h = harness()
    void h.start(A, 'account-a')
    h.deliveryCalls[0].deferred.resolve(ok([run('Aの通知')], 7))
    await settle()

    void h.retry(A, 'account-a', run('Aの通知'))
    void h.start(B, 'account-b')
    await settle()

    h.retryCalls[0].deferred.resolve({ success: true } as RetryResult)
    await settle()

    h.deliveryCalls[1].deferred.resolve(ok([run('Bの通知')], 2))
    await settle()
    // Bの応答は必ず採用する。Aの読み直しが割り込むと読み込み中のまま止まる。
    expect(h.visible(B)).toMatchObject({ state: 'ready', failed: 2 })
    expect(h.visible(B).items.map((item) => item.id)).toEqual(['Bの通知'])
    // Aの読み直しは始めない。Aの成功の知らせもBには出さない。
    expect(h.deliveryCalls).toHaveLength(2)
    expect(h.notices.filter(Boolean)).toEqual([])
  })

  it('再試行が失敗しても、切り替えた後のアカウントに前のアカウントの知らせを出さない', async () => {
    for (const status of [403, 409, 500]) {
      const h = harness()
      void h.start(A, 'account-a')
      h.deliveryCalls[0].deferred.resolve(ok([run('Aの通知')], 7))
      await settle()

      void h.retry(A, 'account-a', run('Aの通知'))
      void h.start(B, 'account-b')
      await settle()

      h.retryCalls[0].deferred.reject(new ApiError(status, 'retry failed'))
      await settle()
      expect(h.notices.filter(Boolean)).toEqual([])
      expect(h.deliveryCalls).toHaveLength(2)

      h.deliveryCalls[1].deferred.resolve(ok([run('Bの通知')], 2))
      await settle()
      expect(h.visible(B)).toMatchObject({ state: 'ready', failed: 2 })
    }
  })

  it('切り替えていなければ、再試行の成功と失敗をこれまでどおり知らせる', async () => {
    const h = harness()
    void h.start(A, 'account-a')
    h.deliveryCalls[0].deferred.resolve(ok([run('Aの通知')], 7))
    await settle()

    void h.retry(A, 'account-a', run('Aの通知'))
    h.retryCalls[0].deferred.resolve({ success: true } as RetryResult)
    await settle()
    expect(h.notices[h.notices.length - 1]).toEqual({ tone: 'success', text: '同じ通知の送信を安全に再試行しました。' })
    expect(h.deliveryCalls).toHaveLength(2)
    // 読み直しが終わるまでは再試行中のまま。二重押しを防ぐ。
    expect(h.retryingId()).toBe('Aの通知')
    h.deliveryCalls[1].deferred.resolve(ok([run('Aの通知', { attemptCount: 2 })], 7))
    await settle()
    expect(h.retryingId()).toBeNull()
    expect(h.visible(A).items.map((item) => item.attemptCount)).toEqual([2])

    for (const [status, text] of [
      [403, '送信の再試行は店長だけができます。'],
      [409, 'ほかの担当者が先に再試行しました。最新の記録を読み直してください。'],
      [500, '送信を再試行できませんでした。時間をおいて読み直してください。'],
    ] as const) {
      const failing = harness()
      void failing.start(A, 'account-a')
      failing.deliveryCalls[0].deferred.resolve(ok([run('Aの通知')], 7))
      await settle()
      void failing.retry(A, 'account-a', run('Aの通知'))
      failing.retryCalls[0].deferred.reject(new ApiError(status, 'retry failed'))
      await settle()
      expect(failing.notices[failing.notices.length - 1]).toEqual({ tone: 'error', text })
      expect(failing.retryingId()).toBeNull()
    }
  })

  it('切替後に別の行で始めた再試行の表示を、前のアカウントの応答で消さない', async () => {
    const h = harness()
    void h.start(A, 'account-a')
    h.deliveryCalls[0].deferred.resolve(ok([run('Aの通知')], 7))
    await settle()

    void h.retry(A, 'account-a', run('Aの通知'))
    void h.start(B, 'account-b')
    h.deliveryCalls[1].deferred.resolve(ok([run('Bの通知')], 2))
    await settle()
    void h.retry(B, 'account-b', run('Bの通知'))
    expect(h.retryingId()).toBe('Bの通知')

    h.retryCalls[0].deferred.resolve({ success: true } as RetryResult)
    await settle()
    expect(h.retryingId()).toBe('Bの通知')
  })

  it('取得失敗・権限なし・実値0を別の状態として区別する', async () => {
    const failure = harness()
    void failure.start(A, 'account-a')
    failure.deliveryCalls[0].deferred.reject(new ApiError(500, 'server error'))
    await settle()
    expect(failure.visible(A)).toMatchObject({ state: 'error', items: [], failed: null })

    const forbidden = harness()
    void forbidden.start(A, 'account-a')
    forbidden.deliveryCalls[0].deferred.reject(new ApiError(403, 'forbidden'))
    await settle()
    expect(forbidden.visible(A).state).toBe('forbidden')

    const empty = harness()
    void empty.start(A, 'account-a')
    empty.deliveryCalls[0].deferred.resolve(ok([], 0))
    await settle()
    expect(empty.visible(A)).toMatchObject({ state: 'ready', items: [], failed: 0 })

    const noAccount = harness()
    await noAccount.start('none:failures', null)
    expect(noAccount.deliveryCalls).toHaveLength(0)
    expect(noAccount.visible('none:failures')).toMatchObject({ state: 'ready', items: [] })
  })
})

describe('一覧の配線', () => {
  it('読み込みと再試行に、今見ているアカウントとタブを渡している', async () => {
    const { readFileSync } = await import('node:fs')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'notification-run-list.tsx'), 'utf8')

    expect(source).toContain('loadNotificationRuns(env, { scope: currentScope, lineAccountId, mode, page })')
    expect(source).toContain('retryNotificationRun(env, {')
    expect(source).toContain('scope: currentScope,')
    // 足場は作り直さない。作り直すと開始時と応答時で目印がずれる。
    expect(source).toContain('useMemo<NotificationRunEnv>(() => ({')
    expect(source).toContain('}), [])')
  })
})
