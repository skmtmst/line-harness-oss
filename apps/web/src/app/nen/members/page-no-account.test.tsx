// @vitest-environment happy-dom
/*
 * 監査 Issue #1058: 会員ページでLINEアカウントが未選択のとき、
 * タブの下が真っ白にならず「選んでください」の案内を出すことを確かめる。
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ accountId: null as string | null }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/api', () => ({ ApiError: class extends Error { status?: number } }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: state.accountId }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/components/shared/page-header', () => ({ default: () => null }))
vi.mock('@/components/layout/scrollable-tabs', () => ({ default: () => null }))
vi.mock('@/lib/nen-ranks-api', () => ({ nenRanksApi: { settings: vi.fn() } }))
vi.mock('./rank-settings-tab', () => ({ default: () => <div data-testid="rank-tab" /> }))
vi.mock('./lifetime-tab', () => ({ default: () => <div data-testid="lifetime-tab" /> }))
vi.mock('./members-tab', () => ({ default: () => <div data-testid="members-tab" /> }))

import Page from './page'

const flush = () => act(async () => { await Promise.resolve() })

afterEach(cleanup)

describe('#1058 会員ページのアカウント未選択', () => {
  it('未選択ではタブ内容を出さず「LINEアカウントを選んでください」を案内する', async () => {
    state.accountId = null
    render(<Page />)
    await flush()
    expect(screen.getByText('LINEアカウントを選んでください')).toBeTruthy()
    expect(screen.queryByTestId('members-tab')).toBeNull()
    expect(screen.queryByTestId('rank-tab')).toBeNull()
    expect(screen.queryByTestId('lifetime-tab')).toBeNull()
  })

  it('選択済みなら案内ではなく会員一覧タブを出す', async () => {
    state.accountId = 'account-1'
    render(<Page />)
    await flush()
    expect(screen.queryByText('LINEアカウントを選んでください')).toBeNull()
    expect(screen.getByTestId('members-tab')).toBeTruthy()
  })
})
