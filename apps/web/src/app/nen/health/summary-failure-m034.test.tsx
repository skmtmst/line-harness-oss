// @vitest-environment happy-dom
/*
 * M034：「30日のまとめ」の取得失敗を、原因どおりに言い分ける。
 * 本物の React で確かめる試験。
 *
 * - 403 は権限の案内にし、押しても直らない「もう一度読み込む」は出さない
 * - 429 は待ち案内にし、再試行の口は残す
 * - 生の `API error: 403` は出さない
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'

const fixture = vi.hoisted(() => ({ accountId: 'A' as string }))
const m = vi.hoisted(() => ({ summary: vi.fn() }))

vi.mock('@/components/shared/page-header', () => ({ default: () => null }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fixture.accountId }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/nen-pets-api', () => ({ nenPetsApi: { healthSummary: m.summary } }))
vi.mock('./health-tab', () => ({
  default: ({ onOpenSummary }: { onOpenSummary: (petId: string) => void }) => (
    <button onClick={() => onOpenSummary('pet-A')}>開くA</button>
  ),
}))
vi.mock('./items-tab', () => ({ default: () => null }))

import Page from './page'

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  fixture.accountId = 'A'
})

describe('M034 30日のまとめの取得失敗', () => {
  it('403は権限の案内になり、再試行の口は出ない', async () => {
    m.summary.mockRejectedValueOnce(new ApiError(403, 'API error: 403'))
    render(<Page />)
    fireEvent.click(screen.getByText('開くA'))
    await flush()

    expect(document.body.textContent).toContain('権限')
    expect(document.body.textContent).not.toContain('API error: 403')
    expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).toBeNull()
  })

  it('429は待ち案内になり、再試行の口は残る', async () => {
    m.summary.mockRejectedValueOnce(new ApiError(429, 'API error: 429'))
    render(<Page />)
    fireEvent.click(screen.getByText('開くA'))
    await flush()

    expect(document.body.textContent).toMatch(/混み合っています|待って/)
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeTruthy()
  })
})
