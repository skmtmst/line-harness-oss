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
vi.mock('next/navigation', async () => (await import('@/test-utils/affiliate-navigation-mock')).affiliateNavigationMock())

vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof import('@/lib/api')>(),
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

const { OffersTab } = await import('@/test-utils/affiliate-tabs')

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

async function openOfferEdit() {
  render(<OffersTab />)
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '案件Aの操作' })).toBeTruthy()
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '案件Aの操作' }))
  })
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '編集する' })) })
  const title = await screen.findByText('案件を編集')
  const modal = title.closest('[role="dialog"]')
  expect(modal).toBeTruthy()
  return within(modal as HTMLElement)
}

describe('R286 案件編集の入力欄は項目名で一意に特定できる', () => {
  test.each([
    ['案件名', 'INPUT', 'text'],
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

describe('案件の未保存', () => {
  test('入力後のリンク移動を止め、編集を続けると入力が残る', async () => {
    const modal = await openOfferEdit()
    await waitFor(() => expect((modal.getByLabelText('数える期間（日）', { exact: true }) as HTMLInputElement).value).toBe('30'))
    fireEvent.change(modal.getByLabelText('案件名', { exact: true }), { target: { value: '新しい案件名' } })
    const link = document.createElement('a')
    link.href = '/templates'
    document.body.appendChild(link)
    fireEvent.click(link)
    expect(await screen.findByRole('dialog', { name: '保存していない変更があります' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
    expect((modal.getByLabelText('案件名', { exact: true }) as HTMLInputElement).value).toBe('新しい案件名')
    link.remove()
  })

  test('決まりを読み込んだだけでは確認せず、変更すると戻るを止める', async () => {
    const modal = await openOfferEdit()
    const input = modal.getByLabelText('数える期間（日）', { exact: true }) as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('30'))
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    fireEvent.change(input, { target: { value: '31' } })
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
    fireEvent.popState(window)
    expect(screen.getByRole('dialog', { name: '保存していない変更があります' })).toBeTruthy()
    expect(go).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
    expect(input.value).toBe('31')
    go.mockRestore()
  })

  test('入力を元に戻すと離脱確認は出ない', async () => {
    const modal = await openOfferEdit()
    await waitFor(() => expect((modal.getByLabelText('数える期間（日）', { exact: true }) as HTMLInputElement).value).toBe('30'))
    const input = modal.getByLabelText('案件名', { exact: true }) as HTMLInputElement
    fireEvent.change(input, { target: { value: '変更後' } })
    fireEvent.change(input, { target: { value: '案件A' } })
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })


  test('入力後に決まりの取得が終わっても入力を保護する', async () => {
    const { api } = await import('@/lib/api')
    let complete!: (value: Awaited<ReturnType<typeof api.affiliateOffers.capStatus>>) => void
    const spy = vi.spyOn(api.affiliateOffers, 'capStatus').mockReturnValue(new Promise(resolve => { complete = resolve }))
    const modal = await openOfferEdit()
    fireEvent.change(modal.getByLabelText('案件名', { exact: true }), { target: { value: '先に入力' } })
    await act(async () => { complete({ success: true, data: { version: { windowDays: 30, capTotal: null, capMonthlyPerAffiliate: null, receptionFrom: null, receptionTo: null } } } as Awaited<ReturnType<typeof api.affiliateOffers.capStatus>>) })
    const input = modal.getByLabelText('数える期間（日）', { exact: true }) as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('30'))
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect((modal.getByLabelText('案件名', { exact: true }) as HTMLInputElement).value).toBe('先に入力')
    spy.mockRestore()
  })

})
