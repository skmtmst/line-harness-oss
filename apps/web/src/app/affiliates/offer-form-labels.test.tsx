// @vitest-environment happy-dom
/*
 * R286: 案件編集の9つの入力欄に読み上げの項目名がある。
 * 既存案件の編集を開くだけで確かめる（入力は変えない）。
 * 項目名・入力欄の結びつき（htmlFor・id）が切れると赤になる。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, value, onChange, options }: {
    'aria-label'?: string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => (
    <select aria-label={label} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}))
vi.mock('@/lib/api', () => ({
  api: {
    affiliateOffers: {
      list: () => Promise.resolve({ success: true, data: [OFFER] }),
      update: () => Promise.resolve({ success: true, data: OFFER }),
      create: vi.fn(),
      capStatus: () => Promise.resolve({
        success: true,
        data: {
          version: {
            id: 'ver-1', offerId: 'off-1', versionNumber: 1,
            rewardAmount: 1000, rewardMiles: 50, windowDays: 30,
            capTotal: 200, capMonthlyPerAffiliate: 10,
            receptionFrom: '2026-10-01T00:00:00.000+09:00',
            receptionTo: '2026-12-31T23:59:59.000+09:00',
            effectiveFrom: null, createdAt: '2026-09-01T00:00:00.000+09:00',
          },
          capped: false, capTotal: 200, totalUsed: 0, totalRemaining: 200,
          capMonthlyPerAffiliate: 10, monthlyUsed: 0, monthlyRemaining: 10,
        },
      }),
      versions: () => Promise.resolve({ success: true, data: [] }),
    },
    lineAccounts: { list: () => Promise.resolve({ success: true, data: [{ id: 'acc-1', name: 'アカウントA' }] }) },
    tags: { list: () => Promise.resolve({ success: true, data: [] }) },
    scenarios: { list: () => Promise.resolve({ success: true, data: [] }) },
  },
}))

const OFFER = {
  id: 'off-1', name: '案件A', description: '説明文',
  rewardAmount: 1000, rewardMiles: 50, lineAccountId: 'acc-1',
  tagId: null, scenarioId: null, isActive: true,
  createdAt: '2026-09-01T00:00:00.000Z',
}

const { OffersTab } = await import('./tabs')

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

async function openOfferEdit() {
  render(<OffersTab />)
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '編集' })).toBeTruthy()
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '編集' }))
  })
  const title = await screen.findByText('案件を編集')
  const modal = title.closest('[role="dialog"]')
  expect(modal).toBeTruthy()
  return within(modal as HTMLElement)
}

describe('R286 案件編集の入力欄は項目名で一意に特定できる', () => {
  test.each([
    ['案件名 *', 'INPUT', 'text'],
    ['説明', 'TEXTAREA', null],
    ['報酬額（円）', 'INPUT', 'number'],
    ['成果承認時の付与マイル', 'INPUT', 'number'],
    ['数える期間（日）', 'INPUT', 'number'],
    ['全体の上限（件）', 'INPUT', 'number'],
    ['1人あたり月の上限（件）', 'INPUT', 'number'],
    ['受付の始め', 'INPUT', 'date'],
    ['受付の終わり', 'INPUT', 'date'],
  ])('「%s」は項目名で入力欄を指せる', async (labelText, tagName, type) => {
    const modal = await openOfferEdit()
    // 完全一致。「？」の説明文や「？」ボタンなど別の名前を拾わない。
    const input = modal.getByLabelText(labelText, { exact: true }) as HTMLInputElement
    // 項目名が指すのは入力欄そのもの（「？」ボタンでは赤）。
    expect(input.tagName).toBe(tagName)
    if (type !== null) expect(input.getAttribute('type')).toBe(type)
    // 見えている項目名と入力欄が結びついている（読み上げ・項目名指定の操作の土台）。
    // label の control がこの入力欄であることは、実ブラウザの項目名クリック移動と同じ結びつき。
    expect(input.labels?.length).toBe(1)
    expect(input.labels?.[0].textContent).toContain(labelText)
    expect(input.labels?.[0].control).toBe(input)
  })
})
