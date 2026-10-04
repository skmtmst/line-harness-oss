// @vitest-environment happy-dom
/*
 * 板 `aINnz` 支払いタブの絵合わせ。
 * - 数の帯：今回 払う額（合計・人数・件数）、次の締め（月日・あと何日）
 * - 行：確定できる／振込先待ちの札、未登録の札、明細を見るだけ
 * - 頭：銀行用 CSV…・支払明細をまとめて出す
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const fixture = vi.hoisted(() => ({
  previewImpl: null as null | (() => Promise<unknown>),
}))

const PREVIEW = {
  lineAccountId: 'acc-1',
  periodFrom: '2026-09-01T00:00:00.000Z',
  periodTo: '2026-09-29T14:59:59.999Z',
  currency: 'JPY',
  totalAmount: 70400,
  conversionCount: 33,
  affiliates: [
    {
      affiliateId: 'aff-1',
      affiliateName: '合同会社ノース',
      code: 'north',
      amount: 31400,
      grossAmount: 31400,
      deduction: 0,
      conversionCount: 9,
      bankProfileRegistered: true,
    },
    {
      affiliateId: 'aff-2',
      affiliateName: '木村 亮',
      code: 'kimura',
      amount: 3000,
      grossAmount: 3000,
      deduction: 0,
      conversionCount: 2,
      bankProfileRegistered: false,
    },
  ],
  previewVersion: 'version-1',
}

vi.mock('@/lib/api', () => ({
  api: {
    affiliates: {
      settlementPreview: () => fixture.previewImpl!(),
      paymentSummaries: () => Promise.resolve({ success: true, data: [] }),
      settlementCurrent: () => Promise.resolve({ success: true, data: null }),
    },
  },
}))

const { default: PaymentTabV8 } = await import('./v8-payment-tab')

afterEach(() => {
  cleanup()
})

let headerNode: ReactNode = null

function renderTab() {
  fixture.previewImpl = () => Promise.resolve({ success: true, data: PREVIEW })
  headerNode = null
  const { container } = render(
    <PaymentTabV8 accountId="acc-1" canEdit registerHeaderActions={(node) => { headerNode = node }} />,
  )
  return container
}

describe('aINnz 支払いタブの絵合わせ', () => {
  test('数の帯に今回の額と締めが出る', async () => {
    renderTab()
    await waitFor(() => {
      expect(screen.getByText('今回 払う額')).toBeTruthy()
    })
    expect(screen.getAllByText('¥70,400').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2人・33件').length).toBeGreaterThan(0)
    expect(screen.getByText('次の締め')).toBeTruthy()
  })

  test('行に札と明細だけが出る', async () => {
    renderTab()
    await waitFor(() => {
      expect(screen.getByText('確定できる')).toBeTruthy()
    })
    expect(screen.getByText('振込先待ち')).toBeTruthy()
    expect(screen.getByText('未登録')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '明細を見る' }).length).toBe(2)
    expect(screen.queryByRole('button', { name: 'この人を確定' })).toBeNull()
  })

  test('頭に2つの書き出しボタンと脚注が出る', async () => {
    renderTab()
    await waitFor(() => {
      expect(headerNode).not.toBeNull()
    })
    const { container } = render(<>{headerNode}</>)
    const head = within(container as HTMLElement)
    expect(head.getByRole('button', { name: '銀行用 CSV…' })).toBeTruthy()
    expect(head.getByRole('button', { name: '支払明細をまとめて出す' })).toBeTruthy()
    expect(screen.getByText(/口座番号は本人だけに表示します/)).toBeTruthy()
  })
})
