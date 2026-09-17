// @vitest-environment happy-dom
/*
 * N-140: テンプレート一覧の行をキーボードで開ける。
 *
 * 実マウントで確かめる。ソースの文字列検査では「Enter で開く」は固定できない。
 *
 * 直す前: 行は <tr onClick> だけで、Tab でフォーカスも Enter/Space での
 * 詳細表示もできなかった。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [], loading: false }),
}))

const templateGet = vi.hoisted(() => vi.fn())

const TEMPLATES = [
  {
    id: 'tpl-1', name: '来店お礼', category: 'general', messageType: 'text',
    messageContent: 'ご来店ありがとうございました。', folderId: null, question: null,
    usageCount: 3, updatedAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'tpl-2', name: '予約確認', category: 'general', messageType: 'text',
    messageContent: 'ご予約を承りました。', folderId: null, question: null,
    usageCount: 0, updatedAt: '2026-09-02T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z',
  },
]

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    templates: {
      list: () => Promise.resolve({ success: true, data: TEMPLATES }),
      get: templateGet,
    },
    broadcastMessageAssets: { list: () => Promise.resolve({ success: true, data: [] }) },
    folders: { list: () => Promise.resolve({ success: true, data: [] }) },
  },
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

import TemplatesPage from './page'

const EMPTY_USED_BY = {
  autoReplies: [], automations: [], scenarioSteps: [],
  reminderSteps: [], richMenuAreas: [], trackedLinks: [],
}

beforeEach(() => {
  templateGet.mockReset()
  templateGet.mockImplementation((id: string) => Promise.resolve({
    success: true,
    data: {
      ...(TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]),
      usedBy: EMPTY_USED_BY,
      hasDraft: false, publishedVersion: 1, publishedAt: '2026-09-01T00:00:00.000Z',
      draftVersion: 0, carouselActions: null, carouselTapLimitMode: 'none',
      carouselTapLimitText: null, questionStatus: 'draft',
    },
  }))
})

afterEach(() => cleanup())

async function renderAndWait() {
  render(<TemplatesPage />)
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
  await screen.findByText('来店お礼')
}

describe('テンプレート一覧行のキーボード操作 (N-140)', () => {
  test('行はTabでフォーカスできる', async () => {
    await renderAndWait()
    const row = screen.getByRole('link', { name: '来店お礼の詳細を開く' })
    expect(row.getAttribute('tabindex')).toBe('0')
  })

  test('行にフォーカスしてEnterで詳細を開く', async () => {
    await renderAndWait()
    const row = screen.getByRole('link', { name: '来店お礼の詳細を開く' })
    fireEvent.keyDown(row, { key: 'Enter' })
    await act(async () => { await Promise.resolve() })
    expect(templateGet).toHaveBeenCalledWith('tpl-1')
  })

  test('行にフォーカスしてSpaceでも詳細を開く', async () => {
    await renderAndWait()
    const row = screen.getByRole('link', { name: '予約確認の詳細を開く' })
    fireEvent.keyDown(row, { key: ' ' })
    await act(async () => { await Promise.resolve() })
    expect(templateGet).toHaveBeenCalledWith('tpl-2')
  })

  test('行内のリンク・ボタン上のEnterでは詳細を誤作動させない', async () => {
    await renderAndWait()
    const row = screen.getByRole('link', { name: '来店お礼の詳細を開く' })
    const innerLink = row.querySelector('a') as HTMLElement
    expect(innerLink).toBeTruthy()
    // 行内の操作にフォーカスがあるとき、キーは行へ伝搬するが行は開かない。
    fireEvent.keyDown(innerLink, { key: 'Enter' })
    await act(async () => { await Promise.resolve() })
    expect(templateGet).not.toHaveBeenCalled()
  })
})
