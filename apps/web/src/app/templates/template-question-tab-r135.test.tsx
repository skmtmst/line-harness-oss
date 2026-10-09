// @vitest-environment happy-dom

/*
 * R135: 種類タブ（メッセージ／質問）と絞り込み札は別の状態。
 * 質問タブで「未使用」を押しても質問タブに留まり、質問だけに絞られる。
 * メッセージタブには質問を混ぜない。タブの件数も同じ母集団で数える。
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const mockState = vi.hoisted(() => ({
  selectedAccountId: 'account-a',
  templates: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: mockState.selectedAccountId, accounts: [], loading: false }),
}))

const template = (input: {
  id: string
  name: string
  usageCount?: number
  question?: Record<string, unknown> | null
}) => ({
  ...input,
  category: 'general',
  messageType: 'text',
  messageContent: `${input.name}の本文です`,
  folderId: null,
  question: input.question ?? null,
  questionStatus: 'published' as const,
  usageCount: input.usageCount ?? 0,
  tapCount: 0,
  monthlySendCount: 0,
  totalSendCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
})

const QUESTION = {
  text: '好きなペットは？',
  tapMode: 'single' as const,
  choices: [{ label: '犬', behavior: 'none' as const }],
}

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    templates: {
      list: () => Promise.resolve({ success: true, data: mockState.templates }),
      get: () => Promise.resolve({ success: false, error: '詳細は開かない' }),
    },
    broadcastMessageAssets: {
      list: () => Promise.resolve({ success: true, data: [] }),
      counts: () => Promise.resolve({ success: true, data: { card_message: 0, rich_message: 0, coupon: 0, research: 0 } }),
    },
    folders: { list: () => Promise.resolve({ success: true, data: [] }) },
  },
}))

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'lh_staff_role' ? 'owner' : null),
    setItem: () => {},
    removeItem: () => {},
  })
  mockState.selectedAccountId = 'account-a'
  mockState.templates = [
    template({ id: 'm1', name: 'メッセージ1' }),
    template({ id: 'm2', name: 'メッセージ2', usageCount: 3 }),
    template({ id: 'q1', name: '質問1', question: QUESTION }),
  ]
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const tableText = (name: string | RegExp) => {
  const tableEl = screen.queryByRole('table')
  return tableEl ? within(tableEl).queryByText(name) : null
}

async function renderPage() {
  const { default: TemplatesPage } = await import('./page')
  render(<TemplatesPage />)
  await within(await screen.findByRole('table')).findByText('メッセージ1')
}

describe('R135 質問タブと絞り込み札の分離', () => {
  test('メッセージタブは2行・質問タブは1行で、件数も一致する', async () => {
    await renderPage()
    // メッセージタブ：質問を混ぜない2行。
    expect(tableText('メッセージ1')).toBeTruthy()
    expect(tableText('メッセージ2')).toBeTruthy()
    expect(tableText('質問1')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /質問/ }))
    })
    // 質問タブ：質問だけの1行。
    expect(tableText('質問1')).toBeTruthy()
    expect(tableText('メッセージ1')).toBeNull()
    expect(tableText('メッセージ2')).toBeNull()
  })

  test('質問タブで未使用を押しても質問タブに留まり質問だけに絞られる', async () => {
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /質問/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '未使用' }))
    })
    // タブは質問のまま。
    expect(screen.getByRole('tab', { name: /質問/ }).getAttribute('aria-selected')).toBe('true')
    // 質問（未使用）に限定される。
    expect(tableText('質問1')).toBeTruthy()
    expect(tableText('メッセージ1')).toBeNull()
    expect(tableText('メッセージ2')).toBeNull()
  })
})
