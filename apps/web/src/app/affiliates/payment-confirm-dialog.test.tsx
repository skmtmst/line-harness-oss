// @vitest-environment happy-dom
/*
 * 支払い確定の確認窓（NEXT-22 / NEXT-23）。
 *
 * 実物の React をマウントして操作する。ソース文字列の検査では次が固定できない。
 *   - 明細作成とLINE通知が1つのチェックで、ON/OFFがマウス操作と見た目・実状態で一致すること
 *   - プレビューが返さない却下件数を固定値で見せないこと
 *   - 無反応の「直す」が無く、本人への依頼導線だけが出ること
 *   - チェックを外して確定すると明細・通知の口を呼ばないこと
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const fixture = vi.hoisted(() => ({
  previewImpl: null as null | (() => Promise<unknown>),
  getImpl: null as null | (() => Promise<unknown>),
  confirmImpl: null as null | (() => Promise<unknown>),
  statementImpl: null as null | (() => Promise<unknown>),
  confirmCalls: 0,
  statementCalls: 0,
}))

vi.mock('@/lib/api', () => ({
  api: {
    affiliates: {
      paymentPreview: () => fixture.previewImpl!(),
      get: () => fixture.getImpl!(),
      confirmPayment: () => {
        fixture.confirmCalls += 1
        return fixture.confirmImpl!()
      },
      createStatement: () => {
        fixture.statementCalls += 1
        return fixture.statementImpl!()
      },
    },
  },
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) =>
    <a href={href} {...props}>{children}</a>,
}))

const { AffiliatePaymentConfirmDialog } = await import('./action-dialogs')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PREVIEW = {
  affiliateId: 'aff-1',
  affiliateName: '紹介者いち',
  code: 'ABC123',
  amount: 1000,
  conversionCount: 1,
  periodFrom: '2026-09-01T00:00:00.000Z',
  periodTo: '2026-09-30T23:59:59.999Z',
  closeDate: null,
  paymentDate: '2026-09-30',
  bankDestination: null,
  breakdown: [{ offerName: '案件A', conversions: 1, unitReward: 1000, subtotal: 1000 }],
}

function renderDialog(settlement: { bankProfileRegistered: boolean } | null) {
  const confirmed = vi.fn()
  render(
    <AffiliatePaymentConfirmDialog
      target={{ id: 'aff-1', name: '紹介者いち' }}
      accountId="acc-1"
      settlement={settlement as never}
      periodTo={PREVIEW.periodTo}
      onClose={() => {}}
      onConfirmed={confirmed}
    />,
  )
  return { confirmed }
}

beforeEach(() => {
  fixture.confirmCalls = 0
  fixture.statementCalls = 0
  fixture.previewImpl = async () => ({ success: true, data: PREVIEW })
  fixture.getImpl = async () => ({
    success: true,
    data: { id: 'aff-1', name: '紹介者いち', friendId: 'fr-1', email: 'partner@example.com' },
  })
  fixture.confirmImpl = async () => ({
    success: true,
    data: { kind: 'created', settlementId: 'set-1', amount: 1000, conversionCount: 1, closedAt: '2026-09-20T00:00:00.000Z' },
  })
  fixture.statementImpl = async () => ({ success: true, data: { id: 'st-1' } })
})

afterEach(() => {
  cleanup()
})

describe('NEXT-22: 明細作成とLINE通知のチェック', () => {
  test('チェックは1つだけで、ON/OFFが操作・見た目・実状態で一致する', async () => {
    renderDialog({ bankProfileRegistered: true })
    const checkbox = await screen.findByRole('checkbox')
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    const label = checkbox.closest('label')!
    // 既定はON。見た目のチェックマークも描かれている。
    expect((checkbox as HTMLInputElement).checked).toBe(true)
    expect(label.querySelector('svg.lucide-check')).toBeTruthy()
    await act(async () => {
      fireEvent.click(checkbox)
    })
    // OFFにすると見た目のチェックマークも消える。
    expect((checkbox as HTMLInputElement).checked).toBe(false)
    expect(label.querySelector('svg.lucide-check')).toBeNull()
    await act(async () => {
      fireEvent.click(checkbox)
    })
    expect((checkbox as HTMLInputElement).checked).toBe(true)
    expect(label.querySelector('svg.lucide-check')).toBeTruthy()
  })

  test('チェックを外して確定すると、明細・通知の口を呼ばない', async () => {
    const { confirmed } = renderDialog({ bankProfileRegistered: true })
    const checkbox = await screen.findByRole('checkbox')
    await act(async () => {
      fireEvent.click(checkbox)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /で確定する/ }))
    })
    await waitFor(() => expect(confirmed).toHaveBeenCalled())
    expect(fixture.confirmCalls).toBe(1)
    expect(fixture.statementCalls).toBe(0)
  })

  test('チェックを付けて確定すると、明細とLINE通知の口を1回呼ぶ', async () => {
    const { confirmed } = renderDialog({ bankProfileRegistered: true })
    await screen.findByRole('checkbox')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /で確定する/ }))
    })
    await waitFor(() => expect(fixture.statementCalls).toBe(1))
    expect(fixture.confirmCalls).toBe(1)
    expect(confirmed).toHaveBeenCalled()
  })
})

describe('NEXT-23: 精算確認の内訳と振込先', () => {
  test('プレビューが返さない却下件数・除外金額を固定値で出さない', async () => {
    renderDialog({ bankProfileRegistered: true })
    await screen.findByRole('checkbox')
    expect(screen.queryByText(/却下した\d+件/)).toBeNull()
    expect(screen.queryByText(/（却下した.*は入れていません）/)).toBeNull()
  })

  test('無反応の「直す」は無く、本人への依頼導線が出る', async () => {
    renderDialog({ bankProfileRegistered: false })
    await screen.findByRole('checkbox')
    expect(screen.queryByRole('button', { name: '直す' })).toBeNull()
    const link = await screen.findByRole('link', { name: '本人にLINEで依頼する' })
    expect(link.getAttribute('href')).toBe('/chats?friend=fr-1')
  })

  test('友だちと結び付いていない紹介者は連絡先で依頼し、手段が無ければ飾りのボタンを置かない', async () => {
    fixture.getImpl = async () => ({
      success: true,
      data: { id: 'aff-1', name: '紹介者いち', friendId: null, email: 'partner@example.com' },
    })
    renderDialog({ bankProfileRegistered: false })
    const mail = await screen.findByRole('link', { name: 'メールで依頼する' })
    expect(mail.getAttribute('href')).toContain('mailto:partner@example.com')
    cleanup()
    fixture.getImpl = async () => ({
      success: true,
      data: { id: 'aff-1', name: '紹介者いち', friendId: null, email: null },
    })
    renderDialog({ bankProfileRegistered: false })
    await screen.findByRole('checkbox')
    expect(screen.queryByRole('link', { name: /依頼する/ })).toBeNull()
    expect(screen.getByText(/連絡先がありません/)).toBeTruthy()
  })
})
