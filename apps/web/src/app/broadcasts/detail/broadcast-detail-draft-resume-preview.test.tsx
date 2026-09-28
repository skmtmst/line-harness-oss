// @vitest-environment happy-dom
/*
 * 下書き詳細の編集導線と中身の見せ方（監査 R207・R211）。
 *
 * 見る筋書き:
 *   R207: 下書き・予約には「編集を続ける」（同じIDで開き直す）が出て、
 *         送信済みには出ない。
 *   R211: 位置情報は JSON ではなく見出し・住所・緯度経度で出て、
 *         ボタン付きテキストはボタンまで保存内容どおりに見える。
 *         下書きには未送信と添える。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { ApiBroadcast } from '@/lib/api'

const net = vi.hoisted(() => ({
  broadcast: {} as Record<string, unknown>,
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=bc-1'),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      broadcasts: {
        ...actual.api.broadcasts,
        get: async () => ({ success: true, data: net.broadcast }),
        getInsight: async () => ({ success: true, data: null }),
        approval: {
          get: async () => ({ success: false }),
          candidates: async () => ({ success: true, data: [] }),
        },
      },
    },
  }
})

import BroadcastDetailPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    for (let step = 0; step < 12; step += 1) await Promise.resolve()
  })
}

async function show() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<BroadcastDetailPage />)
  })
  await flush()
}

function unmount() {
  act(() => {
    root.unmount()
  })
  host.remove()
  vi.clearAllMocks()
}

function draft(over: Record<string, unknown> = {}) {
  return {
    id: 'bc-1',
    title: '監査用下書き',
    messageType: 'text',
    messageContent: '保存していた本文',
    messageBubbles: null,
    messageOptions: null,
    targetType: 'all',
    targetTagId: null,
    segmentConditions: null,
    status: 'draft',
    scheduledAt: null,
    sentAt: null,
    totalCount: 0,
    successCount: 0,
    createdAt: '2026-09-27T10:00:00.000Z',
    lineAccountId: 'acc-1',
    trackLinks: false,
    ...over,
  }
}

function resumeLink(): HTMLAnchorElement | null {
  return [...host.querySelectorAll('a')].find((a) => a.textContent === '編集を続ける') ?? null
}

describe('下書き詳細の編集導線とプレビュー（R207・R211）', () => {
  it('R207: 下書きには「編集を続ける」が出て、同じIDで開き直す', async () => {
    net.broadcast = draft()
    await show()
    try {
      const link = resumeLink()
      expect(link, '下書きに編集導線がない').not.toBeNull()
      expect(link!.getAttribute('href')).toBe('/broadcasts/new?draft=bc-1')
    } finally {
      unmount()
    }
  })

  it('R207: 送信済みには「編集を続ける」を出さない', async () => {
    net.broadcast = draft({ status: 'sent', sentAt: '2026-09-27T12:00:00.000Z', totalCount: 10, successCount: 9 })
    await show()
    try {
      expect(resumeLink(), '送信済みに編集導線がある').toBeNull()
    } finally {
      unmount()
    }
  })

  it('R211: 位置情報の下書きは見出し・住所・緯度経度で出す（JSONを出さない）', async () => {
    net.broadcast = draft({
      messageType: 'location',
      messageContent: JSON.stringify({ title: '本店', address: '東京都渋谷区1-2-3', latitude: 35.658, longitude: 139.701 }),
    })
    await show()
    try {
      expect(host.textContent).toContain('本店')
      expect(host.textContent).toContain('東京都渋谷区1-2-3')
      expect(host.textContent).not.toContain('{"latitude"')
      expect(host.textContent).not.toContain('"longitude"')
    } finally {
      unmount()
    }
  })

  it('R211: ボタン付きテキストはボタンまで出し、下書きは未送信と添える', async () => {
    net.broadcast = draft({
      messageBubbles: [{ id: 'b1', type: 'text', content: { text: '保存していた本文' } }],
      messageOptions: {
        buttons: [{ label: '資料を見る', type: 'url', value: 'https://example.com/guide' }],
      },
    })
    await show()
    try {
      expect(host.textContent).toContain('保存していた本文')
      expect(host.textContent).toContain('資料を見る')
      expect(host.textContent).toContain('まだ誰にも届いていません')
    } finally {
      unmount()
    }
  })
})
