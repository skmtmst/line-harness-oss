// @vitest-environment happy-dom
/*
 * DEEP-23: 健康日記の「30日のまとめ」で、別ペットの遅い応答が届いても
 * 選択中のペットのまとめ・印刷対象が入れ替わらないことを確かめる。
 * 監査の再現: audit-reports reproductions/audit-deep-health.test.tsx
 *
 * 修正後の期待：応答は accountId＋petId＋要求世代で照合される。
 * 閉じる・開き直す・アカウント切替で古い要求は失効し、印刷は選択ペットだけ。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ accountId: 'A' as string }))
const m = vi.hoisted(() => ({ summary: vi.fn() }))

type DrawerProps = { open: boolean; status: string; summary: { pet: { name: string } } | null; onClose: () => void }

vi.mock('@/components/shared/page-header', () => ({ default: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div> }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fixture.accountId }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/nen-pets-api', () => ({ nenPetsApi: { healthSummary: m.summary } }))
vi.mock('./health-tab', () => ({
  default: ({ onOpenSummary }: { onOpenSummary: (petId: string) => void }) => (
    <>
      <button onClick={() => onOpenSummary('pet-A')}>開くA</button>
      <button onClick={() => onOpenSummary('pet-B')}>開くB</button>
    </>
  ),
}))
vi.mock('./items-tab', () => ({ default: () => null }))
vi.mock('./summary-drawer', () => ({
  default: ({ open, status, summary, onClose }: DrawerProps) =>
    open ? (
      <div>
        <span data-testid="drawer-body">{status === 'loading' ? '読み込み中' : summary?.pet.name}</span>
        <button onClick={onClose}>閉じる</button>
      </div>
    ) : null,
  SummarySheet: ({ summary }: { summary: { pet: { name: string } } }) => <div data-testid="print-sheet">{summary.pet.name}</div>,
}))

import Page from './page'

const summaryOf = (name: string) => ({ success: true, data: { pet: { name } } })
const flush = () => act(async () => { await Promise.resolve() })
const printButton = () => screen.getByRole('button', { name: '獣医師向けPDFを書き出す' }) as HTMLButtonElement

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  fixture.accountId = 'A'
})

describe('DEEP-23 30日のまとめ', () => {
  it('閉じてから届いたAの応答は捨てる。開いているBのまとめと印刷面はBのまま', async () => {
    let resolveA!: (value: unknown) => void
    m.summary
      .mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve }))
      .mockResolvedValueOnce(summaryOf('ペットB'))
    render(<Page />)
    fireEvent.click(screen.getByText('開くA'))
    await flush()
    fireEvent.click(screen.getByText('閉じる'))
    fireEvent.click(screen.getByText('開くB'))
    await flush()

    expect(screen.getByTestId('print-sheet').textContent).toBe('ペットB')
    expect(printButton().disabled).toBe(false)

    // 閉じる前に出したAの応答が遅れて届いても、Bの面は入れ替わらない
    await act(async () => resolveA(summaryOf('ペットA')))
    expect(screen.getByTestId('print-sheet').textContent).toBe('ペットB')
    expect(screen.getByTestId('drawer-body').textContent).toBe('ペットB')
  })

  it('Aのまとめを開いたままBを開くと、Bが届くまで印刷は出せない', async () => {
    m.summary
      .mockResolvedValueOnce(summaryOf('ペットA'))
      .mockImplementationOnce(() => new Promise(() => {}))
    render(<Page />)
    fireEvent.click(screen.getByText('開くA'))
    await flush()
    expect(screen.getByTestId('print-sheet').textContent).toBe('ペットA')

    fireEvent.click(screen.getByText('開くB'))
    await flush()
    // Bの取得中はAの面を印刷対象にしない
    expect(screen.queryByTestId('print-sheet')).toBeNull()
    expect(printButton().disabled).toBe(true)
    expect(screen.getByTestId('drawer-body').textContent).toBe('読み込み中')
  })

  it('アカウントを切り替えると開いているまとめは閉じ、印刷も出せなくなる', async () => {
    m.summary.mockResolvedValueOnce(summaryOf('ペットA'))
    const v = render(<Page />)
    fireEvent.click(screen.getByText('開くA'))
    await flush()
    expect(screen.getByTestId('print-sheet').textContent).toBe('ペットA')

    fixture.accountId = 'B'
    v.rerender(<Page />)
    await flush()
    expect(screen.queryByTestId('print-sheet')).toBeNull()
    expect(printButton().disabled).toBe(true)
  })
})
