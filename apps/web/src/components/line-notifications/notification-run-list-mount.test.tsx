// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiError, api, type EcNotificationRun, type EcNotificationRunList } from '@/lib/api'
import NotificationRunList from './notification-run-list'

// createRoot/actがhappy-dom環境をReactのact対応と認識するための明示フラグ。
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

/*
 * 司令塔差し戻し: account切替のレンダーからuseEffect(load)が動くまでの窓で、
 * 前アカウントの再試行応答がnotice・retrying・reload(読み直し)をあとの
 * アカウントへ反映できていた。ここでは実コンポーネントをmountし、Promiseの
 * resolve()とレンダーの前後関係を直接組み立てて、その窓を固定する。
 */

type DeliveriesResult = Awaited<ReturnType<typeof api.lineNotifications.deliveries>>
type RetryResult = Awaited<ReturnType<typeof api.lineNotifications.retryDelivery>>
type StaffMeResult = Awaited<ReturnType<typeof api.staff.me>>

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void }

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  promise.catch(() => {})
  return { promise, resolve, reject }
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
  return { success: true, data: list(items, failed), pagination: { total: items.length, limit: 20, offset: 0 } }
}

let container: HTMLDivElement | null = null
let root: Root | null = null
const originalDeliveries = api.lineNotifications.deliveries
const originalRetryDelivery = api.lineNotifications.retryDelivery
const originalStaffMe = api.staff.me

afterEach(() => {
  api.lineNotifications.deliveries = originalDeliveries
  api.lineNotifications.retryDelivery = originalRetryDelivery
  api.staff.me = originalStaffMe
  if (root) act(() => { root!.unmount() })
  if (container) container.remove()
  root = null
  container = null
  vi.restoreAllMocks()
})

function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  return { container, root }
}

/** マイクロタスクだけを流す。useEffectで走るpassive effect(マクロタスク)は流さない。 */
async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

/*
 * Reactのpassive effect(useEffect)は、act()で包まない限りマイクロタスクより
 * 後のマクロタスクとして動く（実機のブラウザと同じ挙動。診断済み: render()
 * 直後はまだeffectが走っておらず、Promiseのマイクロタスクの方が先に処理
 * される）。account切替を`act()`で包まずに生の`root.render()`で行うと、
 * 「切替のレンダーは終わっているが、次のuseEffect(load)はまだ動いていない」
 * という司令塔差し戻しの窓を、実際のスケジューリングのまま再現できる。
 */

async function setup() {
  // 店長権限を即答にしておき、再試行ボタンを常に出す。
  api.staff.me = vi.fn(async (): Promise<StaffMeResult> => ({
    success: true,
    data: {
      id: 'staff-1',
      name: '店長',
      email: null,
      role: 'owner',
      lineLinked: false,
      twoFactorEnabled: false,
      isActive: true,
      permissionKeys: [],
      notificationPreferences: {},
      inviteStatus: 'active',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      assignedLineAccountId: null,
      canAccessDescendantAccounts: true,
    },
  })) as typeof api.staff.me

  const deliveryDeferreds = new Map<string, Deferred<DeliveriesResult>[]>()
  const deliveryCalls: Array<{ lineAccountId: string }> = []
  api.lineNotifications.deliveries = vi.fn((params: { lineAccountId: string }) => {
    deliveryCalls.push({ lineAccountId: params.lineAccountId })
    const d = deferred<DeliveriesResult>()
    const bucket = deliveryDeferreds.get(params.lineAccountId) ?? []
    bucket.push(d)
    deliveryDeferreds.set(params.lineAccountId, bucket)
    return d.promise
  }) as typeof api.lineNotifications.deliveries

  const retryDeferreds: Deferred<RetryResult>[] = []
  api.lineNotifications.retryDelivery = vi.fn(() => {
    const d = deferred<RetryResult>()
    retryDeferreds.push(d)
    return d.promise
  }) as typeof api.lineNotifications.retryDelivery

  const { container, root } = mount()

  await act(async () => {
    root.render(<NotificationRunList lineAccountId="account-a" mode="failures" />)
  })
  await act(async () => { await drainMicrotasks() })

  const nextDelivery = (accountId: string, index = 0): Deferred<DeliveriesResult> => {
    const bucket = deliveryDeferreds.get(accountId)
    const item = bucket?.[index]
    if (!item) throw new Error(`${accountId} 向けの deliveries 呼び出しが見つかりません`)
    return item
  }

  return { container, root, deliveryCalls, nextDelivery, retryDeferreds }
}

function retryButton(container: HTMLDivElement): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((el) => el.textContent === '送信を再試行')
  if (!button) throw new Error('再試行ボタンが見つかりません')
  return button as HTMLButtonElement
}

function noticeText(container: HTMLDivElement): string | null {
  const region = container.querySelector('[aria-label="送れなかったもの"]')
  const candidate = region?.querySelector('.border-success, .border-danger')
  return candidate ? candidate.textContent : null
}

describe('LINE通知一覧のReact実mount試験', () => {
  it.each([
    ['success', 200, null] as const,
    ['403', 403, '送信の再試行は店長だけができます。'] as const,
    ['409', 409, 'ほかの担当者が先に再試行しました。最新の記録を読み直してください。'] as const,
    ['500', 500, '送信を再試行できませんでした。時間をおいて読み直してください。'] as const,
  ])('B切替後にAの再試行が%sで戻っても、Bには漏れず、Aの読み直しも始めない', async (_label, status, failureText) => {
    const { container, deliveryCalls, nextDelivery, retryDeferreds } = await setup()

    await act(async () => {
      nextDelivery('account-a').resolve(ok([run('Aの通知')], 7))
      await drainMicrotasks()
    })
    expect(container.textContent).toContain('顧客 Aの通知')

    await act(async () => { retryButton(container).click() })
    expect(retryDeferreds).toHaveLength(1)
    expect(container.textContent).toContain('再試行中')

    // account切替のレンダーとuseEffect(load)まで進める。
    await act(async () => {
      root!.render(<NotificationRunList lineAccountId="account-b" mode="failures" />)
      await drainMicrotasks()
    })
    expect(container.querySelector('[data-list-state]')?.getAttribute('data-list-state')).toBe('loading')
    expect(deliveryCalls).toEqual([{ lineAccountId: 'account-a' }, { lineAccountId: 'account-b' }])

    // ここでAの再試行の応答が戻る。Bへ切り替わったあとの応答。
    await act(async () => {
      if (status === 200) {
        retryDeferreds[0].resolve({ success: true } as RetryResult)
      } else {
        retryDeferreds[0].reject(new ApiError(status, 'retry failed'))
      }
      await drainMicrotasks()
    })

    // Aの再試行は処理されたが、Bの画面には知らせが出ない。
    expect(noticeText(container)).toBeNull()
    // Aの読み直しは始めない。deliveriesはA・Bの2回のまま。
    expect(deliveryCalls).toHaveLength(2)
    if (failureText) expect(container.textContent).not.toContain(failureText)

    await act(async () => {
      nextDelivery('account-b').resolve(ok([run('Bの通知')], 2))
      await drainMicrotasks()
    })
    expect(container.textContent).toContain('顧客 Bの通知')
    expect(container.textContent).not.toContain('顧客 Aの通知')
    expect(noticeText(container)).toBeNull()
  })

  it('Aの再試行が保留中にBへ切替え、B自身のuseEffectが先に動いた後でAが成功しても、Bの遅延成功を上書きしない', async () => {
    const { container, deliveryCalls, nextDelivery, retryDeferreds } = await setup()

    await act(async () => {
      nextDelivery('account-a').resolve(ok([run('Aの通知')], 7))
      await drainMicrotasks()
    })

    await act(async () => { retryButton(container).click() })

    // 今度はBのuseEffectまで先に流し切ってから、Aの応答を戻す
    // （「B effect後のA応答」の順を試す）。
    await act(async () => {
      root!.render(<NotificationRunList lineAccountId="account-b" mode="failures" />)
      await drainMicrotasks()
    })
    expect(deliveryCalls).toEqual([{ lineAccountId: 'account-a' }, { lineAccountId: 'account-b' }])

    await act(async () => {
      retryDeferreds[0].resolve({ success: true } as RetryResult)
      await drainMicrotasks()
    })
    expect(noticeText(container)).toBeNull()
    // Aの読み直しは始めない。deliveriesはA・Bの2回のまま。
    expect(deliveryCalls).toHaveLength(2)

    // Bの本来の応答は、遅れて届いても正しく反映される。
    await act(async () => {
      nextDelivery('account-b').resolve(ok([run('B遅延成功')], 3))
      await drainMicrotasks()
    })
    expect(container.textContent).toContain('顧客 B遅延成功')
    expect(container.textContent).not.toContain('顧客 Aの通知')
  })
})
