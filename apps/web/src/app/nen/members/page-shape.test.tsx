// @vitest-environment happy-dom
/*
 * 全ルート監査 A1（2026-09-25）: `/nen/members` が `members` の読み取りで
 * 「画面を表示できませんでした」になっていた。原因はランク設定の口が
 * 既定の器（`{items,…}`）で返っていたこと。画面側は形違いの応答を置かず、
 * 読み込み失敗として出す。タブの件数が出せないときも落とさない。
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ settings: vi.fn(), members: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/api', () => ({ ApiError: class extends Error { status?: number } }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a' }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/components/shared/page-header', () => ({ default: () => null }))
vi.mock('@/lib/nen-ranks-api', () => ({ nenRanksApi: api }))

import Page from './page'

const flush = () => act(async () => { await Promise.resolve() })

beforeEach(() => {
  api.settings.mockReset()
  api.members.mockReset()
})
afterEach(cleanup)

describe('nen/members の形違い応答', () => {
  it('設定が形違いでも落ちず読み込み失敗を出す', async () => {
    // 旧偽APIの形。本物は {ranks,rules,milestones,kpis} を返す。
    api.settings.mockResolvedValue({ success: true, data: { items: [], total: 0, page: 1, limit: 20 } })
    api.members.mockResolvedValue({ success: false, error: 'x' })
    render(<Page />)
    await flush()
    expect(await screen.findByText('会員を読み込めませんでした')).toBeTruthy()
    expect(screen.queryByText('画面を表示できませんでした')).toBeNull()
  })
})
