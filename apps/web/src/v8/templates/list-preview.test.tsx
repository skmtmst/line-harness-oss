// @vitest-environment happy-dom
/*
 * テンプレートの一覧の「LINEでの見え方」の列。
 * 種類ごとに小さな吹き出しが出る・下書きの中身を出す・壊れた行だけ「見え方を出せません」・
 * 50行でもカード型（Flex）を描かない・狭い幅では列を畳む。
 */
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listTemplates = vi.hoisted(() => vi.fn())
const flexPreview = vi.hoisted(() => vi.fn(() => null))
const narrow = vi.hoisted(() => ({ value: false }))

vi.mock('next/link', () => ({
  default: ({ children, href, className, title }: { children: React.ReactNode; href: string; className?: string; title?: string }) => (
    <a href={typeof href === 'string' ? href : '#'} className={className} title={title}>{children}</a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/templates',
  useSearchParams: () => new URLSearchParams('size=50'),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ accounts: [{ id: 'account-1', name: '本店' }], selectedAccountId: 'account-1', loading: false }),
}))
vi.mock('@/lib/staff-role', () => ({
  useStaffRole: () => 'owner',
  canManageRole: (r: string | null | undefined) => r === 'owner' || r === 'admin',
}))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))
vi.mock('@/components/flex-preview', () => ({ default: flexPreview }))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => narrow.value }))
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status = 0
  },
  fetchApi: vi.fn(),
  api: {
    templates: { list: listTemplates, usages: vi.fn(), delete: vi.fn() },
    broadcastMessageAssets: { counts: () => Promise.resolve({ success: true, data: {} }) },
    folders: { list: () => Promise.resolve({ success: true, data: [], unfiledCount: 0 }) },
  },
}))

import TemplatesListV8 from './list'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const base = {
  category: '',
  folderId: null,
  question: null,
  questionStatus: 'published',
  tapCount: 0,
  usageCount: 0,
  monthlySendCount: 0,
  totalSendCount: 0,
  publishedAt: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z',
}
const row = (id: string, messageType: string, messageContent: string, extra: Record<string, unknown> = {}) => ({ ...base, id, name: `テンプレート${id}`, messageType, messageContent, ...extra })

async function renderList() {
  await act(async () => {
    render(<TemplatesListV8 />)
  })
  await act(async () => {
    await Promise.resolve()
  })
}

async function openTab(label: string) {
  const tab = [...document.querySelectorAll<HTMLElement>('button, [role="tab"]')].find((el) => el.textContent?.trim().startsWith(label))
  if (!tab) throw new Error(`tab ${label} not found`)
  await act(async () => {
    fireEvent.click(tab)
  })
}

function thumbOf(id: string): HTMLElement | null {
  return document.querySelector(`tr[data-row-id="${id}"] [data-line-bubble-thumb]`)
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  window.history.replaceState(null, '', '/templates?size=50')
  narrow.value = false
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('テンプレートの一覧：LINEでの見え方', () => {
  it('種類ごとに小さな吹き出しが出て、壊れた行だけ「見え方を出せません」', async () => {
    listTemplates.mockResolvedValue({
      success: true,
      data: [
        row('text', 'text', '公開した本文', { draftMessageContent: '{{name}}さま 下書きの本文', hasDraft: true }),
        row('image', 'image', '{"originalContentUrl":"https://example.com/a.jpg","previewImageUrl":"https://example.com/s.jpg"}'),
        row('flex', 'flex', '{"type":"flex","altText":"秋の新メニュー","contents":{"type":"bubble"}}'),
        row('carousel', 'carousel', '[{"title":"A"},{"title":"B"},{"title":"C"}]'),
        row('question', 'flex', '{}', { question: { text: '目的は？', tapMode: 'single', choices: [{ label: 'A', behavior: 'none' }] } }),
        row('rich', 'imagemap', '{"altText":"春の告知"}'),
        row('video', 'imagemap', '{"altText":"紹介動画","video":{}}'),
        row('unknown', 'sticker', '{"packageId":"1"}'),
        row('broken', 'flex', '{"type":'),
      ],
    })
    await renderList()
    expect(screen.getByRole('columnheader', { name: 'LINEでの見え方' })).toBeTruthy()
    // 下書きがある行は下書きの中身を出す。差し込みは札。
    expect(thumbOf('text')?.textContent).toBe('名前さま 下書きの本文')
    expect(thumbOf('image')?.querySelector('img')?.getAttribute('src')).toBe('https://example.com/s.jpg')
    expect(thumbOf('flex')?.textContent).toBe('秋の新メニュー')
    expect(thumbOf('carousel')?.textContent).toBe('A3枚')
    expect(thumbOf('rich')?.dataset.lineBubbleThumb).toBe('rich_message')
    expect(thumbOf('unknown')?.textContent).toBe('見え方を出せません')
    expect(thumbOf('broken')?.textContent).toBe('見え方を出せません')
    // 壊れた行でも名前と操作は残る。
    expect(screen.getByRole('button', { name: 'テンプレート「テンプレートbroken」の操作' })).toBeTruthy()
    // 名前の読み上げを邪魔しない。
    for (const el of document.querySelectorAll('[data-line-bubble-thumb]')) expect(el.getAttribute('aria-hidden')).toBe('true')
    // 質問・リッチビデオはそれぞれのタブで同じ列に出る。
    await openTab('質問')
    expect(thumbOf('question')?.textContent).toBe('目的は？選択肢 1')
    await openTab('リッチビデオ')
    expect(thumbOf('video')?.dataset.lineBubbleThumb).toBe('rich_video')
  })

  it('50行のカード型でも Flex を描かない', async () => {
    listTemplates.mockResolvedValue({
      success: true,
      data: Array.from({ length: 50 }, (_, i) => row(`f${i}`, 'flex', `{"type":"flex","altText":"カード${i}","contents":{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[]}}}`)),
    })
    await renderList()
    expect(document.querySelectorAll('[data-line-bubble-thumb="card"]')).toHaveLength(50)
    expect(flexPreview).not.toHaveBeenCalled()
  })

  it('狭い幅では列を畳む', async () => {
    narrow.value = true
    listTemplates.mockResolvedValue({ success: true, data: [row('text', 'text', '本文')] })
    await renderList()
    expect(screen.queryByRole('columnheader', { name: 'LINEでの見え方' })).toBeNull()
    expect(thumbOf('text')).toBeNull()
    expect(screen.getByText('テンプレートtext')).toBeTruthy()
  })
})
