// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * IDEA-23「この注文の状況」パネルの見張り。
 *
 * 守りたいのは:
 *  - 1注文について 届いた出来事 → 通知 → 発送後の案内 → 成果/マイル/スコア
 *    が1枚で辿れる
 *  - 失敗は「未連携／権限・認証／通信の失敗」へ分かれて出る（生の技術
 *    メッセージをそのまま出さない分類の存在）
 *  - 「もう一度やる」は一覧の retry を引き継ぎ、押した後に詳細を読み直す
 *  - 権限なしは専用の断り文、読み込み失敗は再読み込み操作つきで出す
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      ecCommerce: {
        ...actual.api.ecCommerce,
        orderDetail: vi.fn(),
      },
    },
  }
})

import { ApiError, api, type EcOrderDetail } from '@/lib/api'
import OrderDetailDrawer from './order-detail-drawer'
import { EVENT_STATUS_TEXT, FAILURE_KIND_TEXT, eventStoppedStage } from './ec-failure'

const mockOrderDetail = api.ecCommerce.orderDetail as unknown as ReturnType<typeof vi.fn>

function fixture(): EcOrderDetail {
  return {
    order: {
      id: 'order-1',
      lineAccountId: 'account-1',
      externalOrderId: '9001',
      orderNumber: 'NEN-1001',
      customerId: 'customer-1',
      friendId: null,
      customerName: null,
      status: 'current',
      providerStatus: '新規受付',
      currency: 'JPY',
      totalAmount: 2860,
      refundedAmount: null,
      orderedAt: '2026-09-16T00:00:00.000Z',
      detailUrl: 'https://ec.example/admin/order/9001',
      version: 1,
      orderLines: [{ productName: '鹿肉ミンチ', quantity: 2, unitAmount: 1430, imageUrl: null, detailUrl: null }],
    },
    events: [{
      id: 'ev-1',
      externalEventId: 'ext-1',
      eventType: 'ec.order.confirmed',
      status: 'identity_pending',
      failureKind: 'unlinked',
      receivedAt: '2026-09-16T00:00:00.000Z',
      processedAt: null,
      actions: [{
        id: 'act-1', eventId: 'ev-1', eventType: 'ec.order.confirmed',
        actionType: 'ec_process_event', ruleVersion: 'v1', status: 'skipped',
        attemptCount: 1, maxAttempts: 3,
        errorCode: 'line_identity_unmatched', errorMessage: 'LINEの友だちが見つかりません',
        lastAttemptedAt: '2026-09-16T00:01:00.000Z', nextRetryAt: null, version: 1,
        receivedAt: '2026-09-16T00:00:00.000Z', orderNumber: 'NEN-1001',
        customerName: null, friendId: null, retryAvailable: false,
        failureKind: 'unlinked',
        attempts: [{ attemptNumber: 1, triggerKind: 'automatic', toStatus: 'skipped', errorCode: 'line_identity_unmatched', errorMessage: 'LINEの友だちが見つかりません', createdAt: '2026-09-16T00:01:00.000Z' }],
      }],
      dispatches: [{ subscriber: 'v6', status: 'sent', attemptCount: 1, updatedAt: '2026-09-16T00:01:00.000Z', failureKind: null }],
      deliveries: [],
    }],
    followUps: [],
    outcomes: { conversions: [], mileage: [], scores: [] },
  }
}

let container: HTMLDivElement
let root: Root

function render(props: Partial<React.ComponentProps<typeof OrderDetailDrawer>> = {}) {
  act(() => {
    root.render(
      <OrderDetailDrawer
        orderId="order-1"
        accountId="account-1"
        onClose={() => undefined}
        onRetryAction={async () => undefined}
        retryingId={null}
        {...props}
      />,
    )
  })
}

beforeAll(() => {
  // happy-dom + React19: act 環境フラグ。
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockOrderDetail.mockResolvedValue({ success: true, data: fixture() })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

async function settle() {
  await act(async () => { await Promise.resolve() })
}

describe('失敗分類の表示語', () => {
  it('完了条件の3分類（未連携・権限/認証・通信失敗）を含む7分類を持つ', () => {
    for (const kind of ['unlinked', 'not_following', 'permission', 'communication', 'rejected', 'by_setting', 'internal'] as const) {
      expect(FAILURE_KIND_TEXT[kind].label.length).toBeGreaterThan(0)
      expect(FAILURE_KIND_TEXT[kind].hint.length).toBeGreaterThan(0)
    }
    expect(FAILURE_KIND_TEXT.unlinked.label).toBe('未連携')
    expect(FAILURE_KIND_TEXT.permission.label).toBe('権限・認証')
    expect(FAILURE_KIND_TEXT.communication.label).toBe('通信の失敗')
  })

  it('出来事の状態表示は既知コードだけ訳し、未知は台帳の値を残す', () => {
    expect(EVENT_STATUS_TEXT.identity_pending.label).toBe('未連携')
    expect(EVENT_STATUS_TEXT.processed.label).toBe('処理済み')
    expect(EVENT_STATUS_TEXT.failed.tone).toBe('danger')
  })

  it('止まった段階を台帳のコードから運用の言葉へ寄せる', () => {
    const detail = fixture()
    const event = detail.events[0]
    expect(eventStoppedStage(event)).toBe('友だちとの結びつき')
    // 配送側で失敗したときは配送の段階名になる
    const failedDispatch = {
      ...event,
      actions: [{ ...event.actions[0], errorCode: null, status: 'succeeded' as const }],
      dispatches: [{ subscriber: 'notification' as const, status: 'failed' as const, attemptCount: 1, updatedAt: '', failureKind: 'permission' as const }],
    }
    expect(eventStoppedStage(failedDispatch)).toBe('お客様への通知送信')
    // 全部正常なら「止まった段階」は出さない
    const healthy = { ...failedDispatch, dispatches: [{ ...failedDispatch.dispatches[0], status: 'sent' as const }], status: 'processed' }
    expect(eventStoppedStage(healthy)).toBeNull()
  })
})

describe('注文の状況パネル', () => {
  it('注文IDとアカウントを束ねてAPIへ渡し、出来事・案内・成果を1枚で出す', async () => {
    render()
    await settle()
    expect(mockOrderDetail).toHaveBeenCalledWith('order-1', 'account-1')
    const text = document.body.textContent ?? ''
    expect(text).toContain('注文 NEN-1001')
    expect(text).toContain('この注文に届いた出来事')
    expect(text).toContain('発送後に届く案内')
    expect(text).toContain('成果・マイル・スコア')
    // 未連携の注文: 友だち詳細ではなく「会員のつき合わせ」への導線を出す
    expect(text).toContain('会員のつき合わせへ')
    // EC側への外部リンクは置くが、台帳の複製はしない
    expect(document.body.querySelector('a[href="https://ec.example/admin/order/9001"]')).not.toBeNull()
    // 「重ねない」ことを操作の隣で約束する
    expect(text).toContain('重ねません')
  })

  it('止まった段階と分類ラベルを出し、生メッセージは安全文言だけ出す', async () => {
    render()
    await settle()
    const text = document.body.textContent ?? ''
    expect(text).toContain('止まった段階：友だちとの結びつき')
    expect(text).toContain('LINEの友だちが見つかりません')
    expect(text).toContain('（未連携）')
  })

  it('「もう一度やる」は一覧の retry を呼び、終わったら詳細を読み直す', async () => {
    const retrying = fixture()
    retrying.events[0].actions[0].status = 'retryable_failed'
    retrying.events[0].actions[0].failureKind = 'communication'
    retrying.events[0].actions[0].errorCode = 'delivery_failed'
    retrying.events[0].actions[0].retryAvailable = true
    mockOrderDetail.mockResolvedValue({ success: true, data: retrying })
    const onRetryAction = vi.fn().mockResolvedValue(undefined)
    render({ onRetryAction })
    await settle()
    const button = [...document.body.querySelectorAll('button')].find((node) => node.textContent === 'もう一度やる')
    expect(button).toBeDefined()
    await act(async () => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onRetryAction).toHaveBeenCalledTimes(1)
    // やり直し後に詳細を読み直す（再読み込み＝2回目の呼び出し）
    expect(mockOrderDetail).toHaveBeenCalledTimes(2)
  })

  /*
   * IDEA-16: 注文から成果・報酬・支払い状態へ辿る表示の固定。
   * 未確定の額は「未確定」と出し、確定額と混ぜない。
   */
  it('成果の行から紹介者・確定報酬・締め・支払い結果・重複候補まで辿れる', async () => {
    const detail = fixture()
    detail.outcomes.conversions = [{
      id: 'cv-1',
      pointName: '初回購入',
      approvalStatus: 'approved',
      value: 2860,
      createdAt: '2026-09-16T00:01:00.000Z',
      orderNumber: 'NEN-1001',
      ecEventId: 'ext-1',
      affiliateName: '紹介者A',
      rewardAmount: 400,
      rewardEntryStatus: 'settled',
      reversedAmount: 400,
      settlementState: 'exported',
      payoutBatchState: 'imported',
      payoutResult: 'paid',
      duplicateCandidate: true,
    }]
    mockOrderDetail.mockResolvedValue({ success: true, data: detail })
    render()
    await settle()
    const text = document.body.textContent ?? ''
    expect(text).toContain('成果：初回購入')
    expect(text).toContain('紹介者：紹介者A')
    expect(text).toContain('報酬：¥400')
    expect(text).toContain('支払い確定：締めに入った')
    expect(text).toContain('締め：書き出し済み')
    expect(text).toContain('支払いCSV：支払い結果を取り込んだ')
    expect(text).toContain('結果：支払い完了')
    expect(text).toContain('確定後の取消：−¥400')
    expect(text).toContain('同じ注文・同じ成果地点の成果がほかにもあります')
  })

  it('承認前の成果は報酬を「未確定」と出し、支払い確定の行が無いことを示す', async () => {
    const detail = fixture()
    detail.outcomes.conversions = [{
      id: 'cv-1',
      pointName: '初回購入',
      approvalStatus: 'pending',
      value: 2860,
      createdAt: '2026-09-16T00:01:00.000Z',
      orderNumber: 'NEN-1001',
      ecEventId: 'ext-1',
      affiliateName: '紹介者A',
      rewardAmount: null,
      rewardEntryStatus: null,
      reversedAmount: null,
      settlementState: null,
      payoutBatchState: null,
      payoutResult: null,
      duplicateCandidate: false,
    }]
    mockOrderDetail.mockResolvedValue({ success: true, data: detail })
    render()
    await settle()
    const text = document.body.textContent ?? ''
    expect(text).toContain('報酬：未確定')
    expect(text).not.toContain('支払い確定：')
    expect(text).not.toContain('確定後の取消')
  })

  it('権限が無いときは専用の断り文を出す', async () => {
    mockOrderDetail.mockRejectedValue(new ApiError(403, 'forbidden'))
    render()
    await settle()
    expect(document.body.textContent).toContain('この注文の状況を見る権限がありません')
  })

  it('読み込みに失敗したら、理由つきで再読み込みできる', async () => {
    mockOrderDetail.mockRejectedValueOnce(new Error('network'))
    render()
    await settle()
    expect(document.body.textContent).toContain('注文の状況を読み込めませんでした')
    // 再読み込みで復帰できる
    mockOrderDetail.mockResolvedValue({ success: true, data: fixture() })
    const retry = [...document.body.querySelectorAll('button')].find((node) => /再読み込み|もう一度/.test(node.textContent ?? ''))
    expect(retry).toBeDefined()
    await act(async () => { retry!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(document.body.textContent).toContain('注文 NEN-1001')
  })

  it('orderId が無いときは何も描画しない', async () => {
    render({ orderId: null })
    await settle()
    expect(mockOrderDetail).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })
})
