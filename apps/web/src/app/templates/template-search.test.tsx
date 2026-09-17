// @vitest-environment happy-dom

import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const mockState = vi.hoisted(() => ({
  selectedAccountId: 'account-a',
  templates: [] as Array<Record<string, unknown>>,
  folders: [] as Array<Record<string, unknown>>,
  listCalls: [] as string[],
  listTemplates: (accountId: string) => {
    void accountId
    return Promise.resolve({ success: true, data: [] as Array<Record<string, unknown>> })
  },
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: mockState.selectedAccountId, accounts: [], loading: false }),
}))

const template = (input: {
  id: string
  name: string
  messageContent: string
  folderId?: string | null
}) => ({
  ...input,
  category: 'general',
  messageType: 'text',
  folderId: input.folderId ?? null,
  question: null,
  questionStatus: 'published' as const,
  usageCount: 0,
  tapCount: 0,
  monthlySendCount: 0,
  totalSendCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
})

const BASE_TEMPLATES = [
  template({ id: 'name', name: 'ＷＥＬＣＯＭＥ　ＶＩＰ', messageContent: '名前で見つかる行です' }),
  template({ id: 'body', name: '本文の行', messageContent: '発送\n\t完了のお知らせです' }),
  template({ id: 'field', name: '差し込みの行', messageContent: '好きなペット: {{field.favorite_pet}}' }),
  template({
    id: 'long',
    name: '長文の行',
    messageContent: `${'あ'.repeat(49_000)} 長文末尾キーワード`,
  }),
  template({ id: 'other', name: '通常の行', messageContent: '検索対象外の本文です' }),
]
const DISPLAY_NAMES = [/ＷＥＬＣＯＭＥ/, '本文の行', '差し込みの行', '長文の行', '通常の行'] as const

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    templates: {
      list: (_query: unknown, accountId: string) => {
        mockState.listCalls.push(accountId)
        return mockState.listTemplates(accountId)
      },
      get: () => Promise.resolve({ success: false, error: '詳細は開かない' }),
    },
    broadcastMessageAssets: { list: () => Promise.resolve({ success: true, data: [] }) },
    folders: { list: () => Promise.resolve({ success: true, data: mockState.folders }) },
  },
}))

beforeEach(() => {
  // N-144: 変更操作は owner/admin だけに出す。操作を試す試験は owner で立てる。
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'lh_staff_role' ? 'owner' : null),
    setItem: () => {},
    removeItem: () => {},
  })
  mockState.selectedAccountId = 'account-a'
  mockState.templates = BASE_TEMPLATES
  mockState.folders = []
  mockState.listCalls = []
  mockState.listTemplates = () => Promise.resolve({ success: true, data: mockState.templates })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function renderPage(waitForName: string | RegExp = '本文の行') {
  const { default: TemplatesPage } = await import('./page')
  const rendered = render(<TemplatesPage />)
  await screen.findByText(waitForName)
  return {
    ...rendered,
    input: screen.getByLabelText('名前・本文・差し込んでいる項目で検索'),
    TemplatesPage,
  }
}

async function search(input: HTMLElement, query: string) {
  await act(async () => {
    fireEvent.change(input, { target: { value: query } })
  })
}

describe('テンプレート一覧の検索', () => {
  test('名前・本文・差し込み項目をNFKC・大小文字非依存・空白正規化で検索する', async () => {
    const { input } = await renderPage()
    expect(input.getAttribute('placeholder')).toBe('テンプレート名で検索（本文・差し込んでいる項目も対象）')

    await search(input, '  welcome vip  ')
    expect(screen.queryByText(/ＷＥＬＣＯＭＥ/)).toBeTruthy()
    expect(screen.queryByText('本文の行')).toBeNull()

    await search(input, '発送 完了')
    expect(screen.queryByText('本文の行')).toBeTruthy()
    expect(screen.queryByText(/ＷＥＬＣＯＭＥ/)).toBeNull()

    await search(input, 'FIELD.FAVORITE_PET')
    expect(screen.queryByText('差し込みの行')).toBeTruthy()
    expect(screen.queryByText('通常の行')).toBeNull()
  })

  test('長い本文の表示外にある語も検索し、不一致と空検索を言い分ける', async () => {
    const { input } = await renderPage()

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

  test('1000件×約5万字の索引は取得時だけ作り、入力変更では本文を再正規化しない', async () => {
    const allowedLengthBody = `${'Ａ'.repeat(49_000)} {{field.customer_name}}`
    mockState.templates = Array.from({ length: 1_000 }, (_, index) => template({
      id: `large-${index}`,
      name: `大量テンプレート ${index}`,
      messageContent: allowedLengthBody,
    }))
    const normalizeSpy = vi.spyOn(String.prototype, 'normalize')
    const { input } = await renderPage('大量テンプレート 0')
    const callsAfterIndexBuild = normalizeSpy.mock.calls.length

    await search(input, 'customer_name')
    const callsAfterFirstQuery = normalizeSpy.mock.calls.length
    await search(input, '見つからない語')
    const callsAfterSecondQuery = normalizeSpy.mock.calls.length

    expect(callsAfterIndexBuild).toBeGreaterThanOrEqual(2_000)
    expect(callsAfterFirstQuery - callsAfterIndexBuild).toBe(1)
    expect(callsAfterSecondQuery - callsAfterFirstQuery).toBe(1)
    expect(mockState.listCalls).toEqual(['account-a'])
  }, 30_000)

  test('検索・種類・フォルダをAND条件で絞る', async () => {
    mockState.folders = [{
      id: 'sales',
      kind: 'template',
      name: '営業',
      parentId: null,
      displayOrder: 0,
      color: null,
      itemCount: 2,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }]
    mockState.templates = [
      template({ id: 'match', name: '営業の差し込み', messageContent: '対象語 {{field.name}}', folderId: 'sales' }),
      template({ id: 'wrong-type', name: '営業の通常文', messageContent: '対象語', folderId: 'sales' }),
      template({ id: 'wrong-folder', name: '別フォルダ', messageContent: '対象語 {{field.name}}' }),
      template({ id: 'wrong-query', name: '別の内容', messageContent: '{{field.name}}', folderId: 'sales' }),
    ]
    const { input } = await renderPage('営業の差し込み')

    await search(input, '対象語')
    fireEvent.click(screen.getByRole('button', { name: /^営業\s+2$/ }))
    fireEvent.click(screen.getByRole('button', { name: '差し込みあり' }))

    expect(screen.queryByText('営業の差し込み')).toBeTruthy()
    expect(screen.queryByText('営業の通常文')).toBeNull()
    expect(screen.queryByText('別フォルダ')).toBeNull()
    expect(screen.queryByText('別の内容')).toBeNull()
  })

  test('account切替時に遅れて届いた前accountの一覧を表示せず、検索でも再取得しない', async () => {
    let resolveAccountA!: (value: { success: true; data: Array<Record<string, unknown>> }) => void
    mockState.listTemplates = (accountId) => accountId === 'account-a'
      ? new Promise((resolve) => { resolveAccountA = resolve })
      : Promise.resolve({
        success: true,
        data: [template({ id: 'account-b', name: 'B社テンプレート', messageContent: '切替後の本文' })],
      })

    const { default: TemplatesPage } = await import('./page')
    const rendered = render(<TemplatesPage />)
    mockState.selectedAccountId = 'account-b'
    rendered.rerender(<TemplatesPage />)
    await screen.findByText('B社テンプレート')

    await act(async () => {
      resolveAccountA({
        success: true,
        data: [template({ id: 'account-a', name: 'A社テンプレート', messageContent: '遅い本文' })],
      })
    })
    expect(screen.queryByText('A社テンプレート')).toBeNull()

    const input = screen.getByLabelText('名前・本文・差し込んでいる項目で検索')
    await search(input, '切替後')
    expect(screen.queryByText('B社テンプレート')).toBeTruthy()
    expect(mockState.listCalls).toEqual(['account-a', 'account-b'])
  })
})
