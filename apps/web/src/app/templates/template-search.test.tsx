// @vitest-environment happy-dom

import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [], loading: false }),
}))

const template = (input: { id: string; name: string; messageContent: string }) => ({
  ...input,
  category: 'general',
  messageType: 'text',
  folderId: null,
  question: null,
  questionStatus: 'published' as const,
  usageCount: 0,
  tapCount: 0,
  monthlySendCount: 0,
  totalSendCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
})

const TEMPLATES = [
  template({ id: 'name', name: 'Welcome   VIP', messageContent: '名前で見つかる行です' }),
  template({ id: 'body', name: '本文の行', messageContent: '発送\n\t完了のお知らせです' }),
  template({ id: 'field', name: '差し込みの行', messageContent: '好きなペット: {{field.favorite_pet}}' }),
  template({
    id: 'long',
    name: '長文の行',
    messageContent: `${'あ'.repeat(4_800)} 長文末尾キーワード`,
  }),
  template({ id: 'other', name: '通常の行', messageContent: '検索対象外の本文です' }),
]
const DISPLAY_NAMES = ['Welcome VIP', '本文の行', '差し込みの行', '長文の行', '通常の行']

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    templates: {
      list: () => Promise.resolve({ success: true, data: TEMPLATES }),
      get: () => Promise.resolve({ success: false, error: '詳細は開かない' }),
    },
    broadcastMessageAssets: { list: () => Promise.resolve({ success: true, data: [] }) },
    folders: { list: () => Promise.resolve({ success: true, data: [] }) },
  },
}))

afterEach(cleanup)

async function renderPage() {
  const { default: TemplatesPage } = await import('./page')
  render(<TemplatesPage />)
  await screen.findByText('Welcome VIP')
  return screen.getByLabelText('名前・本文・差し込んでいる項目で検索')
}

async function search(input: HTMLElement, query: string) {
  await act(async () => {
    fireEvent.change(input, { target: { value: query } })
  })
}

describe('テンプレート一覧の検索', () => {
  test('名前・本文・差し込み項目を大小文字非依存かつ空白をそろえて検索する', async () => {
    const input = await renderPage()

    await search(input, '  welcome vip  ')
    expect(screen.queryByText('Welcome VIP')).toBeTruthy()
    expect(screen.queryByText('本文の行')).toBeNull()

    await search(input, '発送 完了')
    expect(screen.queryByText('本文の行')).toBeTruthy()
    expect(screen.queryByText('Welcome VIP')).toBeNull()

    await search(input, 'FIELD.FAVORITE_PET')
    expect(screen.queryByText('差し込みの行')).toBeTruthy()
    expect(screen.queryByText('通常の行')).toBeNull()
  })

  test('長い本文の表示外にある語も検索し、不一致と空検索を言い分ける', async () => {
    const input = await renderPage()

    await search(input, '長文末尾キーワード')
    expect(screen.queryByText('長文の行')).toBeTruthy()
    expect(screen.queryByText('通常の行')).toBeNull()

    await search(input, '存在しない検索語')
    expect(screen.queryByText('条件に合うテンプレートはありません')).toBeTruthy()
    expect(screen.queryByText('長文の行')).toBeNull()

    await search(input, ' \n\t ')
    for (const name of DISPLAY_NAMES) {
      expect(screen.queryByText(name)).toBeTruthy()
    }
  })
})
