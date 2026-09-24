// @vitest-environment happy-dom
/*
 * 全ルート監査 A1（2026-09-25）: `/hq/banners` が `active` の読み取りで
 * 「画面を表示できませんでした」になっていた。原因は集計・プリセットの口が
 * 既定の器（`{items,…}`）で返っていたこと。画面側は形違いの応答を置かず、
 * 数値は「—」で出し、落とさない。
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  presets: vi.fn(),
  stats: vi.fn(),
  listAccounts: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/components/hq/banners/projects-section', () => ({ default: () => null }))
vi.mock('@/components/hq/banners/library-section', () => ({ default: () => null }))
vi.mock('@/lib/api', () => ({
  api: {
    hqBanners: { presets: apiMocks.presets, stats: apiMocks.stats },
    lineAccounts: { list: apiMocks.listAccounts },
  },
}))

import Page from './page'

const flush = () => act(async () => { await Promise.resolve() })

beforeEach(() => {
  apiMocks.presets.mockReset()
  apiMocks.stats.mockReset()
  apiMocks.listAccounts.mockResolvedValue({ success: true, data: [] })
})
afterEach(cleanup)

describe('hq/banners の形違い応答', () => {
  it('集計もプリセットも形違いで落ちず数値は「—」', async () => {
    // 旧偽APIの形。本物は {projects,…} と {presets,…} を返す。
    apiMocks.presets.mockResolvedValue({ success: true, data: { items: [], total: 0, page: 1, limit: 20 } })
    apiMocks.stats.mockResolvedValue({ success: true, data: { items: [], total: 0, page: 1, limit: 20 } })
    render(<Page />)
    await flush()
    expect(await screen.findByText('プロジェクト')).toBeTruthy()
    expect(screen.queryByText('画面を表示できませんでした')).toBeNull()
  })

  it('本物の形なら集計の数を出す', async () => {
    apiMocks.presets.mockResolvedValue({
      success: true,
      data: {
        presets: [],
        maxCount: 4,
        usage: { month: { used: 7, limit: 100, remaining: 93 }, today: { used: 1, limit: 4, remaining: 3 }, paused: false, pausedReason: null },
      },
    })
    apiMocks.stats.mockResolvedValue({ success: true, data: { projects: { active: 2, archived: 1 }, deliveredImages: 18, deliveredAccounts: 3 } })
    render(<Page />)
    await flush()
    expect(await screen.findByText('アーカイブ 1')).toBeTruthy()
  })
})
