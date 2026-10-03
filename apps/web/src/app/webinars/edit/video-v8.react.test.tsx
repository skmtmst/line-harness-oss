// @vitest-environment happy-dom
/*
 * ★V8 動画と公開期間（`VWNaA`）・開催回（`LPOe7`）の描画。
 * 差し替えるのは通信だけ。段の見出し・枠の一覧・数え方が実在する。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  editor: vi.fn(),
  update: vi.fn(),
  saveEditor: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    webinarApi: {
      editor: apiMocks.editor,
      update: apiMocks.update,
      saveEditor: apiMocks.saveEditor,
    },
  }
})

vi.mock('@/components/webinars/webinar-form', () => ({ default: () => <div>詳細フォーム</div> }))

import VideoV8 from './video-v8'
import type { Webinar, WebinarEditor } from '@/lib/api'

const WEBINAR = {
  id: 'webinar-1',
  accountId: 'account-1',
  title: 'NEN活用スタートセミナー',
  slug: 'nen-start',
  status: 'draft',
  videoPrefix: 'videos/nen-start.mp4',
  durationSeconds: 872,
  schedule: [
    { type: 'daily', time: '10:00' },
    { type: 'once', at: '2026-10-08T20:00:00+09:00' },
  ],
  cta: null,
  tagOnAttend: null,
  tagOnCtaClick: null,
  publicationStartsAt: '2026-10-01T10:00:00+09:00',
  publicationEndsAt: null,
  createdAt: '2026-09-01T00:00:00+09:00',
  updatedAt: '2026-10-01T00:00:00+09:00',
} as unknown as Webinar

const EDITOR = {
  version: 3,
  actionPolicy: { templateBody: '', missingResultPolicy: 'retry_next_day' },
} as WebinarEditor

function render(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  act(() => {
    root.render(
      <VideoV8
        webinar={WEBINAR}
        editor={EDITOR}
        publicUrl={null}
        canOpenPublicPage={false}
        publicPageReason="公開すると見られます"
        completionLabel="最大視聴位置が動画の90%（12:00）以上"
        onWebinarSaved={() => undefined}
        onEditVideo={() => undefined}
      />,
    )
  })
  return host
}

describe('動画と公開期間のV8（VWNaA・LPOe7）', () => {
  beforeEach(() => {
    apiMocks.editor.mockResolvedValue({ data: { version: 3 } })
    apiMocks.update.mockImplementation(async (_id: string, input: Record<string, unknown>) => ({
      data: { ...WEBINAR, ...input },
    }))
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('板IDと4つの段を描く', () => {
    const host = render()
    expect(host.querySelector('[data-design-node="VWNaA"]')).not.toBeNull()
    for (const label of ['動画', '公開期間', '配信枠', '視聴の数え方', '公開ページでの見え方']) {
      expect(host.textContent).toContain(label)
    }
    expect(host.textContent).toContain('毎日')
    expect(host.textContent).toContain('単発')
  })

  it('枠を足すと保存の口へ枠つきで送る', async () => {
    const host = render()
    const add = [...host.querySelectorAll('button')].find((el) => el.textContent?.includes('枠を足す'))
    expect(add).toBeDefined()
    await act(async () => {
      add!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const confirm = [...host.querySelectorAll('button')].find((el) => el.textContent === '枠を足す')
    await act(async () => {
      confirm!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(apiMocks.update).toHaveBeenCalledTimes(1)
    const input = apiMocks.update.mock.calls[0][1] as { schedule: Array<{ type: string }> }
    expect(input.schedule).toHaveLength(3)
    expect(input.schedule[2]).toEqual({ type: 'daily', time: '10:00' })
  })

  it('枠を消すと枠なしで送る', async () => {
    const host = render()
    const menu = host.querySelector('button[aria-label="枠1の操作"]')
    expect(menu).not.toBeNull()
    await act(async () => {
      menu!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const remove = [...host.querySelectorAll('button')].find((el) => el.textContent === '消す')
    await act(async () => {
      remove!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(apiMocks.update).toHaveBeenCalledTimes(1)
    const input = apiMocks.update.mock.calls[0][1] as { schedule: unknown[] }
    expect(input.schedule).toHaveLength(1)
  })
})
