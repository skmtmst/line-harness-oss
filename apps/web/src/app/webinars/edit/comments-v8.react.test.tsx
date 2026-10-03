// @vitest-environment happy-dom
/*
 * ★V8 コメント演出（`Omqd4`）の描画。
 * 差し替えるのは通信だけ。一覧・追加・貼り付け・保存が実在する。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  comments: vi.fn(),
  saveComments: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    webinarApi: {
      comments: apiMocks.comments,
      saveComments: apiMocks.saveComments,
    },
  }
})

import CommentsV8 from './comments-v8'

function render(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  act(() => {
    root.render(<CommentsV8 webinarId="webinar-1" />)
  })
  return host
}

describe('コメント演出のV8（Omqd4）', () => {
  beforeEach(() => {
    apiMocks.comments.mockResolvedValue({
      data: [{ atSeconds: 10, authorName: '田中', body: 'こんばんは' }],
    })
    apiMocks.saveComments.mockResolvedValue({ data: { count: 1 } })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('板IDと一覧・追加・保存を描く', async () => {
    const host = render()
    await act(async () => undefined)
    await act(async () => undefined)
    expect(host.querySelector('[data-design-node="Omqd4"]')).not.toBeNull()
    expect(host.textContent).toContain('コメント演出')
    // 名前と本文は入力欄の値として描かれる（textContent には出ない）。
    const nameInput = host.querySelector('input[aria-label="1行目の名前"]') as HTMLInputElement | null
    expect(nameInput?.value).toBe('田中')
    expect(host.textContent).toContain('保存する')
  })

  it('追加して保存すると2件で送る', async () => {
    const host = render()
    await act(async () => undefined)
    const add = [...host.querySelectorAll('button')].find((el) => el.textContent === '＋ 追加')
    await act(async () => {
      add!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const save = [...host.querySelectorAll('button')].find((el) => el.textContent === '保存する')
    await act(async () => {
      save!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(apiMocks.saveComments).toHaveBeenCalledTimes(1)
    const rows = apiMocks.saveComments.mock.calls[0][1] as Array<{ atSeconds: number }>
    expect(rows).toHaveLength(2)
  })
})
